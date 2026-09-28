// ── When a roundtable ends ──────────────────────────────────────────────────
//
// Spec §8 guards against infinite loops. A turn counter does that, and it is
// the easy half. The failure that will actually cost money is CONVERGENCE:
// both models agree by turn two and spend turns three to six agreeing more
// elaborately. No loop, no error, the cap is never reached, and nothing is
// produced. See docs/decisions/0005-stop-conditions.md.
//
// Four conditions, any one of which ends the round.

export interface StopConfig {
  maxTurns:     number
  maxCostUsd:   number
  deadlineMs:   number
  /** 0 disables convergence detection. Higher = more similar before stopping. */
  convergenceThreshold: number
}

export const DEFAULT_STOPS: StopConfig = {
  maxTurns:   6,
  maxCostUsd: 1.0,
  deadlineMs: 120_000,
  convergenceThreshold: 0.75,
}

export interface RoundState {
  turnsTaken: number
  costUsd:    number
  startedAt:  number
  /** Completed turn contents, in order, for convergence comparison. */
  turns:      string[]
}

export type StopReason =
  | 'max-turns' | 'max-cost' | 'deadline' | 'converged' | 'cancelled' | null

/** Word-set overlap. Crude on purpose — it is cheap, has no dependencies, and
 *  needs no model call. Replaceable behind this function if it proves too
 *  blunt; the ADR records that it is expected to. */
export function similarity(a: string, b: string): number {
  const words = (s: string) => new Set(
    s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 3)
  )
  const A = words(a), B = words(b)
  if (A.size === 0 || B.size === 0) return 0
  let shared = 0
  for (const w of A) if (B.has(w)) shared++
  return shared / Math.min(A.size, B.size)
}

/** Agreement with nothing added. Checked separately from similarity because a
 *  short "yes, exactly" shares few words with what it agrees to. */
const BARE_AGREEMENT = /^(?:\s*(?:yes|agreed|exactly|correct|right|same|\+1|i agree|that'?s right|no notes|nothing to add|sounds good)[\s.,!—-]*)+$/i

export function checkStop(state: RoundState, cfg: StopConfig): StopReason {
  if (state.turnsTaken >= cfg.maxTurns)            return 'max-turns'
  if (state.costUsd    >= cfg.maxCostUsd)          return 'max-cost'
  if (Date.now() - state.startedAt >= cfg.deadlineMs) return 'deadline'

  if (cfg.convergenceThreshold > 0 && state.turns.length >= 2) {
    const last = state.turns[state.turns.length - 1]
    if (BARE_AGREEMENT.test(last.trim())) return 'converged'
    // Compare against the previous turn — the other participant's — since
    // restating what was just said is the signal we care about.
    const prev = state.turns[state.turns.length - 2]
    if (similarity(last, prev) >= cfg.convergenceThreshold) return 'converged'
  }

  return null
}
