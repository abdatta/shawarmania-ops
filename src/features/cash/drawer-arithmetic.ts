import {
  APPROXIMATE_WINDOW_MINUTES,
  describeDrawerDifference,
  drawerDifferencePaise,
  exactCoincidence,
  expectedTotalPaise,
  toleranceThroughputPaise,
  type BillRunCoincidence,
  type NearbyCashBill,
} from '@/domain'
import type { DrawerState, NearbyCashBillRecord } from '@/data-access/adapters'

/**
 * What the count sheet can say, and — more importantly — what it must not.
 *
 * Kept out of the component so the refusal in `countAdvice` can be tested
 * directly rather than inferred from rendered text. **This is the most important
 * refusal in the change** (design D7), and a rule that lives only inside a JSX
 * branch is a rule nobody can assert the absence of.
 */

export interface CountAdvice {
  expectedPaise: number
  differencePaise: number
  direction: 'short' | 'over' | 'balanced'
  /**
   * A contiguous run of adjacent cash bills whose sum is EXACTLY the difference,
   * or null.
   *
   * Reported as a fact about bills — never as a proposed instant. An exact hit is
   * unlikely to be chance, so saying so is an observation rather than an excuse.
   */
  coincidence: BillRunCoincidence | null
  /**
   * How much cash moved inside the tolerance window, when the stated instant is
   * approximate. Lets a ₹50 gap against ₹914 of nearby cash read differently
   * from a ₹3,100 gap against the same ₹914.
   */
  timingCouldExplainPaise: number | null
  /**
   * **Always null, and it is a field rather than an omission on purpose.**
   *
   * A future change that wanted to suggest a nearby instant would have to set
   * this, and the test asserting it stays null would fail and make that decision
   * visible. A near hit is almost always available — a genuine ₹500 shortfall
   * has a reachable boundary that shrinks it to ₹222 — and the denser the trade
   * the denser that set, so the ability to explain anything away is strongest on
   * exactly the nights when a loss is easiest to hide.
   */
  suggestedInstant: null
}

function toNearby(bills: readonly NearbyCashBillRecord[]): NearbyCashBill[] {
  return bills.map((bill) => ({
    billId: bill.billId,
    paidAt: new Date(bill.paidAt),
    cashPaise: bill.cashPaise,
  }))
}

/**
 * The nearby cash bills whose payment instant falls in `(after, until]`.
 *
 * **One predicate, used by both movable boundaries.** The count sheet moves the
 * boundary of an interval that has not closed yet; the edit sheet moves the
 * boundary of one that has. They ask about different pairs of instants and must
 * not answer with two different filters — a half-open lower bound and a closed
 * upper one, on `nearbyCashBills`, is the whole of the rule.
 *
 * `nearbyCashBills` is deliberately a bounded window rather than a complete set:
 * it is evidence for a person to recognise, not an aggregate. The totals on the
 * card come from the database.
 */
function billsBetween(
  bills: readonly NearbyCashBillRecord[],
  after: number,
  until: number,
): { paise: number; bills: number } {
  const matching = bills.filter((bill) => {
    const at = new Date(bill.paidAt).getTime()
    return at > after && at <= until
  })
  return {
    paise: matching.reduce((sum, bill) => sum + bill.cashPaise, 0),
    bills: matching.length,
  }
}

/**
 * Recompute what is expected at a candidate count instant, from the same figures
 * the surface is showing.
 *
 * Moving the stated instant earlier excludes the cash rung after it, which is the
 * whole point of the movable boundary: the collector corrects the time **from
 * evidence they recognise**, and the difference is whatever that produces.
 */
export function expectedAtInstant(
  state: DrawerState,
  countedAt: Date,
): { expectedPaise: number; excludedPaise: number; excludedBills: number } {
  if (state.leftInDrawerPaise === null || state.lastObservation === null) {
    return { expectedPaise: 0, excludedPaise: 0, excludedBills: 0 }
  }

  const previous = new Date(state.lastObservation.countedAt).getTime()
  const boundary = countedAt.getTime()

  // Everything the pending interval holds after the candidate instant: the
  // interval runs to now, so `Infinity` is its upper bound.
  const excluded = billsBetween(state.nearbyCashBills, Math.max(previous, boundary), Infinity)

  return {
    expectedPaise: expectedTotalPaise({
      openingPaise: state.leftInDrawerPaise,
      cashReceiptsPaise: state.cashReceiptsSincePaise - excluded.paise,
      cashExpensesPaise: state.cashExpensesSincePaise,
      cashOutPaise: state.cashOutSincePaise,
    }),
    excludedPaise: excluded.paise,
    excludedBills: excluded.bills,
  }
}

/**
 * What moving an already-recorded count's instant does to it.
 *
 * The edit sheet's half of the movable boundary. It asks a different question
 * from `expectedAtInstant` — that one bounds the interval still running, this one
 * bounds one that closed — but through the same predicate above, so the two
 * cannot disagree about what `(a, b]` means.
 *
 * Moving the instant **earlier** puts the cash rung between the two instants
 * outside the count; moving it **later** brings that cash in. Both are worth
 * saying out loud, because the recorder is about to change what their count is
 * measured against and the sentence is the only place that shows.
 *
 * **The database is what actually recomputes the expected total**, by calling the
 * three interval readers. This is the sentence, from the bills the surface is
 * already holding as evidence, and it is deliberately not a second arithmetic.
 */
export function boundaryMove(
  state: DrawerState,
  from: Date,
  to: Date,
): { direction: 'out' | 'in' | 'none'; paise: number; bills: number } {
  const before = from.getTime()
  const after = to.getTime()
  if (!Number.isFinite(after) || before === after) {
    return { direction: 'none', paise: 0, bills: 0 }
  }

  const moved = billsBetween(
    state.nearbyCashBills,
    Math.min(before, after),
    Math.max(before, after),
  )
  if (moved.bills === 0) return { direction: 'none', paise: 0, bills: 0 }

  return { direction: after < before ? 'out' : 'in', paise: moved.paise, bills: moved.bills }
}

/**
 * Everything the sheet may say about a counted amount at a stated instant.
 *
 * `approximate` is true whenever the recorder has not asserted the instant, which
 * is the default whenever it differs from now.
 */
export function countAdvice(
  state: DrawerState,
  countedTotalPaise: number,
  countedAt: Date,
  approximate: boolean,
): CountAdvice {
  const { expectedPaise } = expectedAtInstant(state, countedAt)
  const differencePaise = drawerDifferencePaise(countedTotalPaise, expectedPaise)
  const nearby = toNearby(state.nearbyCashBills)

  return {
    expectedPaise,
    differencePaise,
    direction: describeDrawerDifference(differencePaise),
    coincidence: exactCoincidence(differencePaise, nearby),
    timingCouldExplainPaise: approximate
      ? toleranceThroughputPaise(nearby, countedAt, APPROXIMATE_WINDOW_MINUTES)
      : null,
    // Never populated. See the field's own comment.
    suggestedInstant: null,
  }
}
