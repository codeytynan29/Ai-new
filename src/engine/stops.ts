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
  // OFF by default. The signal is real; this detector is not good enough to
  // decide on its own when a conversation is finished, and a false positive
  // silently truncates a useful exchange based on lexical style rather than
  // content. Turn it on deliberately. See ADR 0005 and ADR 0009.
  convergenceThreshold: 0,
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

/** Jaccard: shared words over the union.
 *
 *  This divided by the SMALLER set until review caught it. That is the overlap
 *  coefficient, and it is maximally biased toward short turns: any turn whose
 *  words are a subset of a longer one scored 1.00. "The database choice depends
 *  on workload" against "...depends on latency and workload characteristics"
 *  came out a perfect match, so a turn that ADDED a qualification read as
 *  repetition. Union in the denominator is symmetric and has no such bias. */
export function similarity(a: string, b: string): number {
  const words = (s: string) => new Set(
    s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 3)
  )
  const A = words(a), B = words(b)
  if (A.size === 0 || B.size === 0) return 0
  let shared = 0
  for (const w of A) if (B.has(w)) shared++
  return shared / (A.size + B.size - shared)
}

/** Agreement with nothing added. Checked separately from similarity because a
 *  short "yes, exactly" shares few words with what it agrees to. */
const BARE_AGREEMENT = /^(?:\s*(?:yes|agreed|exactly|correct|right|same|\+1|i agree|that'?s right|no notes|nothing to add|sounds good)[\s.,!—-]*)+$/i

export function checkStop(state: RoundState, cfg: StopConfig): StopReason {
  if (state.turnsTaken >= cfg.maxTurns)            return 'max-turns'
  if (state.costUsd    >= cfg.maxCostUsd)          return 'max-cost'
  if (Date.now() - state.startedAt >= cfg.deadlineMs) return 'deadline'

  // Two consecutive low-information turns, not one. A single "Agreed." used to
  // end a round on turn two — before the second participant had been responded
  // to at all. One flat turn is a pause; two in a row is a pattern.
  if (cfg.convergenceThreshold > 0 && state.turns.length >= 3) {
    const t = state.turns
    const flat = (i: number) => {
      const cur = t[i], prev = t[i - 1]
      if (!cur || !prev) return false
      return BARE_AGREEMENT.test(cur.trim()) || similarity(cur, prev) >= cfg.convergenceThreshold
    }
    if (flat(t.length - 1) && flat(t.length - 2)) return 'converged'
  }

  return null
}
