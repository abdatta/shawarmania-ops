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

  const excluded = state.nearbyCashBills.filter((bill) => {
    const at = new Date(bill.paidAt).getTime()
    return at > previous && at > boundary
  })
  const excludedPaise = excluded.reduce((sum, bill) => sum + bill.cashPaise, 0)

  return {
    expectedPaise: expectedTotalPaise({
      openingPaise: state.leftInDrawerPaise,
      cashReceiptsPaise: state.cashReceiptsSincePaise - excludedPaise,
      cashExpensesPaise: state.cashExpensesSincePaise,
      cashOutPaise: state.cashOutSincePaise,
    }),
    excludedPaise,
    excludedBills: excluded.length,
  }
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
