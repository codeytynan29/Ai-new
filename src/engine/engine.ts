// ── The conversation engine ─────────────────────────────────────────────────
// Owns routing and the canonical transcript. Contains no provider-specific
// logic (§12) — it only ever sees ContextTurn[] going out and ProviderEvent
// coming back.

import type {
  AIProvider, Message, Mode, ProviderId, Usage,
} from '../types.ts'
import type { ConversationStore } from '../store/ConversationStore.ts'
import { newId } from '../store/InMemoryStore.ts'
import { buildContext } from './context.ts'
import { checkStop, DEFAULT_STOPS, type RoundState, type StopConfig, type StopReason } from './stops.ts'

export type EngineEvent =
  | { type: 'message-start'; message: Message }
  | { type: 'message-delta'; messageId: string; text: string }
  | { type: 'message-end';   message: Message }
  | { type: 'round-end';     reason: StopReason }

const ZERO: Usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 }

/** Fixed commit order for Mode A. Requests run concurrently; the transcript
 *  is deterministic regardless of which provider answers first. */
const COMMIT_ORDER: ProviderId[] = ['openai', 'anthropic']

export class ConversationEngine {
  #store: ConversationStore
  #providers: Map<ProviderId, AIProvider>
  #onEvent: (e: EngineEvent) => void
  #stops: StopConfig
  #aborts = new Map<string, AbortController>()

  constructor(opts: {
    store: ConversationStore
    providers: AIProvider[]
    onEvent?: (e: EngineEvent) => void
    stops?: Partial<StopConfig>
  }) {
    this.#store = opts.store
    this.#providers = new Map(opts.providers.map(p => [p.id, p]))
    this.#onEvent = opts.onEvent ?? (() => {})
    this.#stops = { ...DEFAULT_STOPS, ...opts.stops }
  }

  /** §7: the user can interrupt at any point. */
  cancel(conversationId: string) {
    this.#aborts.get(conversationId)?.abort()
    this.#aborts.delete(conversationId)
  }

  async addHumanMessage(conversationId: string, content: string): Promise<Message> {
    const m = await this.#store.addMessage({
      id: newId('msg'), conversationId,
      speakerId: 'human', speakerType: 'human',
      content, status: 'complete',
      timestamp: new Date().toISOString(),
    })
    this.#onEvent({ type: 'message-end', message: m })
    return m
  }

  /** Human turn → route to whichever participants the mode names. */
  async send(conversationId: string, content: string, mode: Mode = 'both'): Promise<void> {
    const human = await this.addHumanMessage(conversationId, content)

    const ac = new AbortController()
    this.#aborts.set(conversationId, ac)
    try {
      if (mode === 'roundtable') {
        await this.#roundtable(conversationId, human.id, ac.signal)
      } else {
        const targets = mode === 'both'
          ? COMMIT_ORDER.filter(p => this.#providers.has(p))
          : [mode as ProviderId]
        await this.#respondConcurrently(conversationId, targets, human.id, ac.signal)
      }
    } finally {
      this.#aborts.delete(conversationId)
    }
  }

  // ── Mode A ────────────────────────────────────────────────────────────────
  // Placeholders are created in COMMIT_ORDER before any request is made, so
  // `seq` is fixed no matter which provider finishes first. Generation then
  // runs concurrently. The transcript is deterministic and replayable, and no
  // model ever sees another's half-written turn — in this mode they are
  // answering independently by definition.
  async #respondConcurrently(
    conversationId: string, targets: ProviderId[], inReplyTo: string, signal: AbortSignal,
  ): Promise<void> {
    const history = await this.#store.getMessages(conversationId)
    const slots: { provider: ProviderId; message: Message }[] = []

    for (const p of targets) {
      if (!this.#providers.has(p)) continue
      const message = await this.#store.addMessage({
        id: newId('msg'), conversationId,
        speakerId: p, speakerType: 'ai', provider: p,
        content: '', status: 'streaming', inReplyTo,
        timestamp: new Date().toISOString(),
      })
      this.#onEvent({ type: 'message-start', message })
      slots.push({ provider: p, message })
    }

    await Promise.all(slots.map(s => this.#generate(s.provider, s.message, history, signal)))
  }

  // ── Mode D ────────────────────────────────────────────────────────────────
  // Sequential by definition: each participant must see the previous turn.
  async #roundtable(conversationId: string, inReplyTo: string, signal: AbortSignal): Promise<void> {
    const order = COMMIT_ORDER.filter(p => this.#providers.has(p))
    if (order.length === 0) { this.#onEvent({ type: 'round-end', reason: null }); return }

    const state: RoundState = { turnsTaken: 0, costUsd: 0, startedAt: Date.now(), turns: [] }
    let reason: StopReason = null
    let i = 0

    for (;;) {
      if (signal.aborted) { reason = 'cancelled'; break }
      reason = checkStop(state, this.#stops)
      if (reason) break

      const provider = order[i % order.length]
      i++

      const history = await this.#store.getMessages(conversationId)
      const message = await this.#store.addMessage({
        id: newId('msg'), conversationId,
        speakerId: provider, speakerType: 'ai', provider,
        content: '', status: 'streaming', inReplyTo,
        timestamp: new Date().toISOString(),
      })
      this.#onEvent({ type: 'message-start', message })

      const final = await this.#generate(provider, message, history, signal)
      state.turnsTaken++
      state.costUsd += final.usage?.costUsd ?? 0
      // Only a completed turn counts toward convergence — an errored or
      // cancelled one says nothing about whether the discussion is finished.
      if (final.status === 'complete') state.turns.push(final.content)
      if (final.status === 'cancelled') { reason = 'cancelled'; break }
    }

    this.#onEvent({ type: 'round-end', reason })
  }

  // ── One generation ────────────────────────────────────────────────────────
  // §16: one provider failing must not destroy the conversation. A failure is
  // recorded on its own message and the caller carries on.
  async #generate(
    providerId: ProviderId, message: Message, history: Message[], signal: AbortSignal,
  ): Promise<Message> {
    const provider = this.#providers.get(providerId)!
    const context = buildContext(history, providerId)
    let text = ''
    let usage: Usage = ZERO

    try {
      for await (const ev of provider.send(context, { signal })) {
        if (signal.aborted) {
          return this.#store.updateMessage(message.id, { content: text, status: 'cancelled' })
            .then(m => { this.#onEvent({ type: 'message-end', message: m }); return m })
        }
        if (ev.type === 'delta') {
          text += ev.text
          this.#onEvent({ type: 'message-delta', messageId: message.id, text: ev.text })
        } else if (ev.type === 'done') {
          usage = ev.usage
        } else {
          const failed = await this.#store.updateMessage(message.id, {
            content: text, status: 'error', usage,
          })
          this.#onEvent({ type: 'message-end', message: failed })
          return failed
        }
      }
    } catch (err) {
      const failed = await this.#store.updateMessage(message.id, {
        content: text,
        status: signal.aborted ? 'cancelled' : 'error',
        usage,
      })
      this.#onEvent({ type: 'message-end', message: failed })
      return failed
    }

    const done = await this.#store.updateMessage(message.id, {
      content: text,
      status: signal.aborted ? 'cancelled' : 'complete',
      usage,
    })
    this.#onEvent({ type: 'message-end', message: done })
    return done
  }
}
