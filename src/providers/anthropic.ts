// ── Anthropic adapter ───────────────────────────────────────────────────────
// Maps ContextTurn[] → Messages API, and the API's stream → ProviderEvent.
// The engine sees neither shape (§12).

import Anthropic from '@anthropic-ai/sdk'
import type { AIProvider, ContextTurn, GenerationOptions, ProviderEvent, Usage } from '../types.ts'
import { renderTurn, hasForeign, FOREIGN_CONTENT_NOTE } from '../engine/context.ts'

const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-opus-5'

// $ per million tokens. Keep current — it is only used to enforce the
// roundtable cost ceiling (ADR 0005), so being stale makes the ceiling wrong,
// not the app broken.
const PRICE: Record<string, { input: number; output: number }> = {
  'claude-opus-5':   { input: 5, output: 25 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-haiku-4-5':{ input: 1, output: 5 },
}

function cost(model: string, inTok: number, outTok: number): number {
  const p = PRICE[model] ?? PRICE['claude-opus-5']
  return (inTok / 1e6) * p.input + (outTok / 1e6) * p.output
}

export const DEFAULT_SYSTEM =
  'You are one participant in a conversation between a human, ChatGPT, and ' +
  'yourself. Evaluate ChatGPT’s reasoning independently and say so when you ' +
  'disagree — but do not manufacture disagreement to seem useful. Agreeing ' +
  'when you agree, and saying why, is a real contribution. Address the human ' +
  'or ChatGPT directly as the conversation warrants. Be concise.'

export class AnthropicProvider implements AIProvider {
  id = 'anthropic' as const
  name = 'Claude'
  #client: Anthropic

  constructor(apiKey?: string) {
    // The SDK resolves credentials itself when none is passed.
    this.#client = apiKey ? new Anthropic({ apiKey }) : new Anthropic()
  }

  async *send(context: ContextTurn[], options?: GenerationOptions): AsyncIterable<ProviderEvent> {
    // Every turn becomes one user message. Collapsing the transcript into
    // alternating roles would force us to decide which participant counts as
    // "assistant", and that decision is exactly what ADR 0004 says not to make
    // implicitly: our own turns are ours, everyone else's are fenced data.
    const rendered = context.map(renderTurn).join('\n\n')

    const system = [
      options?.systemPrompt ?? DEFAULT_SYSTEM,
      hasForeign(context) ? FOREIGN_CONTENT_NOTE : null,
    ].filter(Boolean).join('\n\n')

    try {
      const stream = this.#client.messages.stream(
        {
          model: MODEL,
          max_tokens: 4096,
          thinking: { type: 'adaptive' },
          system,
          messages: [{ role: 'user', content: rendered }],
        },
        { signal: options?.signal },
      )

      for await (const event of stream) {
        if (options?.signal?.aborted) return
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yield { type: 'delta', text: event.delta.text }
        }
      }

      const final = await stream.finalMessage()
      // A refusal is a legitimate outcome, not a transport failure — record it
      // as an error so the transcript shows the turn did not produce content.
      if (final.stop_reason === 'refusal') {
        yield { type: 'error', retryable: false, message: 'declined by safety classifier' }
        return
      }
      const usage: Usage = {
        inputTokens:  final.usage.input_tokens,
        outputTokens: final.usage.output_tokens,
        costUsd: cost(MODEL, final.usage.input_tokens, final.usage.output_tokens),
      }
      yield { type: 'done', usage }
    } catch (err: any) {
      if (options?.signal?.aborted) return
      const status = err?.status ?? 0
      yield {
        type: 'error',
        // 429 and 5xx are worth trying again; a 400 means we built a bad request.
        retryable: status === 429 || status >= 500 || status === 0,
        message: err?.message ?? String(err),
      }
    }
  }
}
