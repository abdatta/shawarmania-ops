/**
 * The drawer as a continuous balance. Pure, no I/O.
 *
 * `src/domain/cash.ts` is the same arithmetic over a business date, and it is
 * left in place: `daily_cash_records` still exists, unwritten, until #12 drops
 * it (decision 16). This module is the one the live surfaces use, and the
 * difference is the whole change — a day has a container, an observation has an
 * interval bounded by two instants.
 *
 * `openspec/specs/cash-drawer/spec.md` requires the database to enforce the
 * identical equations as check constraints on `drawer_observations`. Writing
 * them once here is what stops the screen and the schema disagreeing about
 * whether a drawer balanced.
 *
 * Integer paise throughout. A float in a cash reconciliation is not a rounding
 * question, it is a wrong answer.
 */

import { NotPaiseError } from './money'

function assertPaise(value: number): number {
  if (!Number.isInteger(value)) throw new NotPaiseError(value)
  return value
}

// ─────────────────────────────────────────────────────────────────────────────
// The interval arithmetic.

export interface DrawerIntervalInputs {
  /**
   * What the drawer held when this interval opened: the previous observation's
   * counted total less that observation's own cash out (design D3).
   *
   * Stored on the row rather than derived across rows, so correcting Tuesday
   * cannot silently move every observation after it (design D4).
   */
  openingPaise: number
  /**
   * The latest accepted effective **Cash** allocations of settled bills whose
   * payment instant falls in `(previous counted_at, this counted_at]`.
   *
   * UPI, Swiggy and Zomato never move the drawer, so they are simply not among
   * these inputs.
   */
  cashReceiptsPaise: number
  /** Cash expenses in the interval, by occurrence instant. A UPI expense is not one. */
  cashExpensesPaise: number
  /**
   * Cash movements in the interval **not belonging to this observation**, summed
   * with their signs.
   *
   * Signed and subtracted whatever the sign: positive is cash leaving the
   * drawer, negative is cash added to it (design D5). Subtracting a negative
   * adds, which is the entire argument for the sign — a top-up needs no term of
   * its own and no branch anywhere.
   */
  cashOutPaise: number
}

/**
 * `expected = opening + receipts − expenses − cashOut`.
 *
 * The observation's own collection is deliberately absent from `cashOutPaise`:
 * it is written in the same transaction, it is not in the counted total, and it
 * is not subtracted from the expected total either. It reduces the *next*
 * opening instead (see `nextOpeningPaise`).
 */
export function expectedTotalPaise(inputs: DrawerIntervalInputs): number {
  return (
    assertPaise(inputs.openingPaise) +
    assertPaise(inputs.cashReceiptsPaise) -
    assertPaise(inputs.cashExpensesPaise) -
    assertPaise(inputs.cashOutPaise)
  )
}

/**
 * `difference = counted − expected`, so a shortfall is **negative**.
 *
 * The sign convention is the one the database's constraint uses, and a screen
 * that flipped it would report a missing ₹500 as a surplus.
 */
export function drawerDifferencePaise(countedTotalPaise: number, expectedPaise: number): number {
  return assertPaise(countedTotalPaise) - assertPaise(expectedPaise)
}

/**
 * `next opening = counted − this observation's own cash out`.
 *
 * **This is the property that makes the whole design safe** (design D3): every
 * observation re-anchors the balance to physical cash, so a mistake, or a
 * correction posted three weeks late, can only ever pollute the one interval it
 * sits in. It cannot ripple through a month.
 *
 * The expected figure is never carried forward. Doing so would make the books
 * agree with themselves and disagree with the drawer, which is the wrong way
 * round, and it would compound one bad night into every night after it.
 */
export function nextOpeningPaise(countedTotalPaise: number, ownCashOutPaise: number): number {
  return assertPaise(countedTotalPaise) - assertPaise(ownCashOutPaise)
}

export type DrawerDifferenceKind = 'short' | 'over' | 'balanced'

/**
 * What the difference means, in a word.
 *
 * Shown alongside the figure rather than instead of it, because a lone signed
 * number at the end of a long day is read wrong often enough to matter — and
 * because a minus sign is the first thing a small screen loses.
 */
export function describeDrawerDifference(differenceInPaise: number): DrawerDifferenceKind {
  assertPaise(differenceInPaise)
  if (differenceInPaise < 0) return 'short'
  if (differenceInPaise > 0) return 'over'
  return 'balanced'
}

// ─────────────────────────────────────────────────────────────────────────────
// Interval membership.

/**
 * Is this instant inside `(previousCountedAt, countedAt]`?
 *
 * **Half-open at the start, closed at the end**, and the asymmetry is
 * deliberate: a payment at exactly the previous count's instant belonged to that
 * count, and one at exactly this instant belongs to this one. Without the rule a
 * payment landing on a boundary is either counted twice or by neither side.
 *
 * `previousCountedAt` is null for an outlet's anchor observation, which has no
 * interval at all (design D18) — nothing is inside it, so this returns false
 * rather than treating the interval as unbounded below.
 */
export function isInInterval(
  instant: Date,
  previousCountedAt: Date | null,
  countedAt: Date,
): boolean {
  if (previousCountedAt === null) return false
  return instant.getTime() > previousCountedAt.getTime() && instant.getTime() <= countedAt.getTime()
}

// ─────────────────────────────────────────────────────────────────────────────
// What may be said about an approximate time.

/** A cash bill near a stated count instant, for the tolerance and coincidence rules. */
export interface NearbyCashBill {
  billId: string
  paidAt: Date
  cashPaise: number
}

/** The default tolerance either side of a human-supplied instant (design D6). */
export const APPROXIMATE_WINDOW_MINUTES = 15

/**
 * How much cash moved inside the tolerance window, in paise.
 *
 * This is the figure that lets a difference be read against what the timing
 * alone could explain: ₹50 against ₹914 of nearby cash is noise, ₹3,100 against
 * the same ₹914 is not, and the two must read differently on screen.
 */
export function toleranceThroughputPaise(
  bills: readonly NearbyCashBill[],
  countedAt: Date,
  windowMinutes: number = APPROXIMATE_WINDOW_MINUTES,
): number {
  const halfWindowMs = windowMinutes * 60 * 1000
  const from = countedAt.getTime() - halfWindowMs
  const to = countedAt.getTime() + halfWindowMs
  return bills.reduce((sum, bill) => {
    const at = bill.paidAt.getTime()
    if (at < from || at > to) return sum
    return sum + assertPaise(bill.cashPaise)
  }, 0)
}

/**
 * A contiguous run of adjacent cash bills whose sum is exactly the difference.
 *
 * Returned as a **fact about bills**, never as a proposed instant. See
 * `exactCoincidence` for why that distinction is the load-bearing refusal in
 * this change.
 */
export interface BillRunCoincidence {
  bills: readonly NearbyCashBill[]
  totalPaise: number
}

/**
 * Does the difference exactly equal a contiguous run of adjacent cash bills?
 *
 * **The most important refusal in this change is what this function does not
 * return** (design D7). Moving a count boundary does not move the expected
 * figure smoothly — it jumps one bill at a time, so the reachable values are a
 * small discrete set of prefix sums. Two consequences point opposite ways:
 *
 *   * An **exact** hit is unlikely to be chance. If a difference equals a run of
 *     bills to the paise, saying so is an observation, not an excuse.
 *   * A **near** hit is almost always available. A genuine ₹500 shortfall
 *     matches no reachable value, but a nearby one would shrink it to ₹222 —
 *     and ₹222 reads as rounding noise where ₹500 reads as a missing note. The
 *     denser the trade the denser the reachable set, so the ability to explain
 *     anything away is strongest on exactly the nights when a loss is easiest
 *     to hide.
 *
 * So this returns the run **only on an exact match**, and returns `null`
 * otherwise. It never ranks candidates, never reports the nearest run, and never
 * discloses which instant would make the observation balance. The caller offers
 * a movable boundary over the bills instead, so the recorder corrects the time
 * from evidence they recognise.
 *
 * A zero difference is not a coincidence: it needs no explaining, and every
 * empty run sums to zero, so reporting one would be noise on every balanced
 * count.
 */
export function exactCoincidence(
  differenceInPaise: number,
  bills: readonly NearbyCashBill[],
): BillRunCoincidence | null {
  assertPaise(differenceInPaise)
  if (differenceInPaise === 0) return null

  // A shortfall means cash the count did not include, so the run being looked
  // for sums to the magnitude of the gap either way.
  const target = Math.abs(differenceInPaise)
  const ordered = [...bills].sort((a, b) => a.paidAt.getTime() - b.paidAt.getTime())

  // Contiguity is over adjacency in time, so this is every window of the
  // ordered list rather than every subset. That is the point: a set of bills
  // scattered across the evening is not a boundary anybody could have moved.
  for (let start = 0; start < ordered.length; start += 1) {
    let total = 0
    for (let end = start; end < ordered.length; end += 1) {
      const bill = ordered[end]
      // `noUncheckedIndexedAccess` is doing real work here rather than being
      // appeased: a sparse array would otherwise reach `assertPaise(undefined)`
      // and throw `NotPaiseError`, which would read as a float in the money path
      // when it was nothing of the kind.
      if (!bill) break
      total += assertPaise(bill.cashPaise)
      if (total === target) {
        return { bills: ordered.slice(start, end + 1), totalPaise: total }
      }
      if (total > target) break
    }
  }

  return null
}
