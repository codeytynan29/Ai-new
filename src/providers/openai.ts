// ── OpenAI adapter ──────────────────────────────────────────────────────────
// Same contract as the Anthropic adapter; nothing provider-shaped escapes it.

import OpenAI from 'openai'
import type { AIProvider, ContextTurn, GenerationOptions, ProviderEvent, Usage } from '../types.ts'
import { renderTurn, hasForeign, FOREIGN_CONTENT_NOTE } from '../engine/context.ts'

const MODEL = process.env.OPENAI_MODEL ?? 'gpt-5.1'

// $ per million tokens, same caveat as the Anthropic adapter: only feeds the
// roundtable cost ceiling. Override per model via OPENAI_PRICE_IN/OUT.
const PRICE_IN  = Number(process.env.OPENAI_PRICE_IN  ?? 2)
const PRICE_OUT = Number(process.env.OPENAI_PRICE_OUT ?? 10)

export const DEFAULT_SYSTEM =
  'You are one participant in a conversation between a human, Claude, and ' +
  'yourself. Respond naturally and directly, and address Claude or the human ' +
  'by name when it helps. Disagree when you disagree and say why; agree when ' +
  'you agree and say what convinced you. Do not perform disagreement. Be concise.'

export class OpenAIProvider implements AIProvider {
  id = 'openai' as const
  name = 'ChatGPT'
  #client: OpenAI

  constructor(apiKey?: string) {
    this.#client = apiKey ? new OpenAI({ apiKey }) : new OpenAI()
  }

  async *send(context: ContextTurn[], options?: GenerationOptions): AsyncIterable<ProviderEvent> {
    const rendered = context.map(renderTurn).join('\n\n')
    const system = [
      options?.systemPrompt ?? DEFAULT_SYSTEM,
      hasForeign(context) ? FOREIGN_CONTENT_NOTE : null,
    ].filter(Boolean).join('\n\n')

    try {
      const stream = await this.#client.chat.completions.create(
        {
          model: MODEL,
          stream: true,
          stream_options: { include_usage: true },
          messages: [
            { role: 'system', content: system },
            { role: 'user',   content: rendered },
          ],
        },
        { signal: options?.signal },
      )

      let inTok = 0, outTok = 0
      for await (const chunk of stream) {
        if (options?.signal?.aborted) return
        const text = chunk.choices?.[0]?.delta?.content
        if (text) yield { type: 'delta', text }
        // With include_usage the final chunk carries totals and no choices.
        if (chunk.usage) {
          inTok  = chunk.usage.prompt_tokens ?? 0
          outTok = chunk.usage.completion_tokens ?? 0
        }
      }

      const usage: Usage = {
        inputTokens: inTok,
        outputTokens: outTok,
        costUsd: (inTok / 1e6) * PRICE_IN + (outTok / 1e6) * PRICE_OUT,
      }
      yield { type: 'done', usage }
    } catch (err: any) {
      if (options?.signal?.aborted) return
      const status = err?.status ?? 0
      yield {
        type: 'error',
        retryable: status === 429 || status >= 500 || status === 0,
        message: err?.message ?? String(err),
      }
    }
  }
}
