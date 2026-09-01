/**
 * Which word one aggregator run records, and whether it attempts its writes.
 *
 * Extracted from `ingest-aggregator-cycle` for the reason `reconnect-ladder.ts`
 * was: the decision is the part worth testing, and it is the part a Deno function
 * body makes hardest to reach. Everything here is pure, so `npm test` covers it
 * without a stack, a secret or a request.
 *
 * **The rule this module exists to hold.** A run may now report figures and a
 * shortfall in the same breath. Before 2026-09-01 it could not: a declared
 * failure returned before the cycles in the same request were looked at, so a
 * runner had two sentences available to it — "I wrote this" or "I failed" — and a
 * run that read six settled weeks and could not read the open one had to pick one
 * and lie with it. The Swiggy readers spent eighteen hours picking the second.
 */

export type AggregatorOutcome =
  'ok' | 'session_lapsed' | 'awaiting_one_time_password' | 'shape_changed' | 'reconciliation_failed'

/**
 * Every word `aggregator_sync_runs_outcome_known` permits.
 *
 * Kept beside the decision that chooses between them rather than inside the one
 * function that used to be the only caller. The database constraint is the
 * authority; this list must match it, and a sixth word here without a migration
 * is a run that fails to record itself.
 */
export const AGGREGATOR_OUTCOMES: readonly AggregatorOutcome[] = [
  'ok',
  'session_lapsed',
  'awaiting_one_time_password',
  'shape_changed',
  'reconciliation_failed',
]

export function isAggregatorOutcome(value: unknown): value is AggregatorOutcome {
  return typeof value === 'string' && AGGREGATOR_OUTCOMES.includes(value as AggregatorOutcome)
}

/**
 * The degradation a caller actually declared, or null for no claim at all.
 *
 * **`ok` is not a claim.** A caller declaring success alongside cycles is treated
 * exactly as one declaring nothing, because the run's outcome is what its writes
 * did and the one word a caller must never be able to assert over them is the
 * reassuring one. Reading `ok` as a declaration would let a runner mark a run
 * healthy while the cycles inside it failed to reconcile.
 */
export function declaredDegradation(declared: unknown): AggregatorOutcome | null {
  if (!isAggregatorOutcome(declared)) return null
  return declared === 'ok' ? null : declared
}

/**
 * Whether this request reached no data at all — the case that writes nothing.
 *
 * A declared degradation carrying no cycles is the original meaning and keeps the
 * original behaviour: report the failure, write nothing for those dates, and
 * never a zero, because a zero is indistinguishable from a day with no orders.
 * A declared degradation carrying cycles is the new case, and it writes them.
 */
export function reachedNoData(declared: unknown, cycleCount: number): boolean {
  return declaredDegradation(declared) !== null && cycleCount === 0
}

/** The sentence a refused reconciliation puts on the run. */
export function reconciliationDetail(unreconciled: number): string {
  return `${unreconciled} cycle(s) did not reconcile against the payout the portal states it made.`
}

/**
 * What a run that got as far as its writes records about itself.
 *
 * **Precedence, stated once here rather than left to whichever branch runs
 * first.** A request can now carry a declared shortfall AND produce a failure of
 * its own, both true, with one word to record.
 *
 * A reconciliation failure wins. It is a question about money that does not add
 * up, which goes to whoever answers those; a short read is a changed portal,
 * which goes to a maintainer. The narrower, more expensive fault is the one worth
 * the word — and the declared reason rides along in the detail, so the run still
 * says both and neither is silently dropped.
 *
 * A refused cycle is not decided here: it aborts the loop with its own status,
 * because the write contract rejecting a payload ends the run rather than
 * colouring its summary.
 */
export function decideRunOutcome({
  degradation,
  degradationDetail,
  unreconciled,
}: {
  degradation: AggregatorOutcome | null
  degradationDetail: string | null
  unreconciled: number
}): { outcome: AggregatorOutcome; detail: string | null } {
  if (unreconciled > 0) {
    const short =
      degradation && degradationDetail ? ` The read also fell short: ${degradationDetail}` : ''
    return {
      outcome: 'reconciliation_failed',
      detail: `${reconciliationDetail(unreconciled)}${short}`,
    }
  }

  // The word names the fault; how far the run still got is carried by its
  // summary, which the write determined inside its own transaction. That pairing
  // is what makes a partial run legible without a sixth outcome word: a degraded
  // run with an empty summary saved nothing, one with movements saved that much.
  if (degradation) return { outcome: degradation, detail: degradationDetail }

  return { outcome: 'ok', detail: null }
}
