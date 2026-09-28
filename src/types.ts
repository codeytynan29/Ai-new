// ── The canonical conversation ──────────────────────────────────────────────
// Spec §5 defines the minimum message shape. Four fields are added here, and
// each one exists because a requirement elsewhere in the spec cannot be met
// without it — see docs/decisions/0003-message-schema.md.

export type SpeakerType = 'human' | 'ai'
export type ProviderId  = 'openai' | 'anthropic'

/** Why a message is in the state it is in. §8 cancellation and §16 failure
 *  handling both need somewhere to record a turn that did not complete. */
export type MessageStatus = 'streaming' | 'complete' | 'error' | 'cancelled'

export interface Usage {
  inputTokens:  number
  outputTokens: number
  costUsd:      number
}

export interface Message {
  id:             string
  conversationId: string
  /** Monotonic within a conversation. Transcript order, and the SSE resume
   *  cursor — Last-Event-ID carries this back after a reconnect. */
  seq:            number
  speakerId:      string
  speakerType:    SpeakerType
  provider?:      ProviderId
  content:        string
  status:         MessageStatus
  inReplyTo?:     string
  usage?:         Usage
  timestamp:      string
}

export interface Conversation {
  id:        string
  createdAt: string
}

/** Spec §7. */
export type Mode = 'both' | 'openai' | 'anthropic' | 'roundtable'

// ── What an adapter emits ───────────────────────────────────────────────────
// Uniform across providers so the engine never sees a provider's response
// shape (§12). `retryable` exists so §16 has something to branch on.

export type ProviderEvent =
  | { type: 'delta';  text: string }
  | { type: 'done';   usage: Usage }
  | { type: 'error';  retryable: boolean; message: string }

export interface GenerationOptions {
  signal?: AbortSignal
  systemPrompt?: string
}

export interface AIProvider {
  id: ProviderId
  name: string
  /** Receives the already-built context. The provider formats it for its own
   *  API; it does not decide what goes in it. */
  send(context: ContextTurn[], options?: GenerationOptions): AsyncIterable<ProviderEvent>
}

/** The neutral form the engine hands an adapter. Adapters map this to their
 *  provider's message format — see docs/decisions/0004-untrusted-content.md
 *  for why `speaker` is not collapsed into a role. */
export interface ContextTurn {
  speaker:  'human' | 'openai' | 'anthropic'
  /** True when this turn was produced by a model other than the one about to
   *  read it. Such content is data, never instruction. */
  foreign:  boolean
  content:  string
}
