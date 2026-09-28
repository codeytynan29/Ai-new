// Scripted providers, so every test in §22 runs with no network and no keys.

import type { AIProvider, ContextTurn, GenerationOptions, ProviderEvent, ProviderId, Usage } from '../types.ts'

const USAGE: Usage = { inputTokens: 10, outputTokens: 10, costUsd: 0.01 }

export interface MockScript {
  /** Called with the context the engine built. `turn` counts calls to this
   *  provider, so a script can say something different each time. */
  reply?: (context: ContextTurn[], turn: number) => string
  usage?: Usage
  /** Emit an error event instead of text (§16). */
  failWith?: { retryable: boolean; message: string }
  /** Throw instead of yielding, to exercise the catch path. */
  throwWith?: string
  /** ms between chunks, so cancellation has something to interrupt. */
  delayMs?: number
}

export class MockProvider implements AIProvider {
  id: ProviderId
  name: string
  #turn = 0
  #script: MockScript
  /** Every context this provider was handed, for assertions. */
  readonly seen: ContextTurn[][] = []

  // Note: plain fields rather than TypeScript parameter properties. Tests run
  // under node --experimental-strip-types, which removes types but does not
  // transform syntax — parameter properties, enums and namespaces are all
  // unsupported. See docs/decisions/0002-typescript-without-a-build-step.md.
  constructor(id: ProviderId, script: MockScript = {}) {
    this.id = id
    this.name = id
    this.#script = script
  }

  get calls() { return this.#turn }

  async *send(context: ContextTurn[], options?: GenerationOptions): AsyncIterable<ProviderEvent> {
    this.seen.push(context)
    const turn = this.#turn++

    if (this.#script.throwWith) throw new Error(this.#script.throwWith)
    if (this.#script.failWith) { yield { type: 'error', ...this.#script.failWith }; return }

    const text = this.#script.reply?.(context, turn) ?? `${this.id} reply ${turn}`
    const words = text.split(' ')
    for (let i = 0; i < words.length; i++) {
      if (options?.signal?.aborted) return
      if (this.#script.delayMs) await new Promise(r => setTimeout(r, this.#script.delayMs))
      yield { type: 'delta', text: i === 0 ? words[i] : ' ' + words[i] }
    }
    yield { type: 'done', usage: this.#script.usage ?? USAGE }
  }
}
