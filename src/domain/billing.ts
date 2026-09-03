/**
 * Billing arithmetic and the counter's small vocabulary. Pure, no I/O.
 *
 * The totals below are not a convenience for the screen: they are the same
 * equations the database enforces as check constraints on `bills` and
 * `bill_items` (`openspec/specs/counter-billing/spec.md`). Stating them once,
 * here, is what stops the counter and the schema disagreeing about what an
 * order came to — and it is what `billing-live` inherits instead of writing
 * again.
 *
 * Money is integer paise throughout. A fractional value means a float leaked
 * into the money path, and it throws rather than rounding.
 */

import { NotPaiseError } from './money'

/** Permanent and retryable outcomes the counter can handle without SQL details. */
export type BillingCommandRefusal =
  | 'order_not_open'
  | 'retryable_failure'
  | 'authorization_refused'
  | 'removed_tablet'
  | 'unsupported_schema'
  | 'malformed_payload'
  | 'arithmetic_invalid'
  | 'unresolved_operations'
  | 'identity_conflict'
  | 'stale_revision'
  | 'payment_edit_expired'

/**
 * Which refusals a corrected resend could still satisfy.
 *
 * `correctAttention` rebuilds a refused command with a new identity and the
 * *same* payload. That can only help where the refusal was about the world
 * having moved rather than about the payload itself: a revision that went
 * stale, an identity that collided. Everything else is terminal — an order that
 * is paid will not become open, an edit window will not reopen, a malformed
 * payload is still malformed on the second send — and resending it produces the
 * identical refusal plus one more permanent row in the manager's diagnostics.
 *
 * Production ran that experiment on 2026-08-26: two corrections of one
 * `order_not_open`, both refused, three rows where there had been one.
 *
 * Unknown statuses are treated as terminal. Withholding a correction still
 * leaves discard, whereas offering one that cannot work is the failure this
 * exists to prevent.
 */
const CORRECTABLE_REFUSALS = new Set<string>(['stale_revision', 'identity_conflict'])

export function isCorrectableRefusal(status: string): boolean {
  return CORRECTABLE_REFUSALS.has(status)
}

export interface AcceptedBillingCommandResult {
  readonly status: 'accepted' | 'replay'
  readonly commandId: string
  readonly delayed?: boolean
  readonly orderId?: string
  readonly orderNumber?: number
  readonly billId?: string
  readonly billNumber?: number
  readonly paymentRevision?: number
  readonly businessDate?: string
  readonly watermark?: number
}

export interface RefusedBillingCommandResult {
  readonly status: BillingCommandRefusal
  readonly commandId?: string
  readonly orderStatus?: 'paid' | 'cancelled'
  /**
   * The order the refusal was about, where the refusing operation had one.
   * Optional because several refusals happen before any order is identified,
   * and because rows written before the naming migration carry neither.
   */
  readonly orderId?: string
  readonly orderNumber?: number
}

export type BillingCommandResult = AcceptedBillingCommandResult | RefusedBillingCommandResult

function assertPaise(value: number): number {
  if (!Number.isInteger(value)) throw new NotPaiseError(value)
  return value
}

/** One line of an order, at the price it is being charged at. */
export interface BillLineAmounts {
  unitPricePaise: number
  quantity: number
}

export interface BillTotals {
  subtotalPaise: number
  discountPaise: number
  taxPaise: number
  /** What the bill was rounded up by to reach a whole rupee. Never negative. */
  roundingPaise: number
  totalPaise: number
}

/**
 * The smallest a bill with anything on it may come to.
 *
 * A fully discounted order is allowed, and its discount records the whole
 * giveaway rather than being trimmed to leave a rupee behind — see
 * `billTotals`. The floor is reached by the rounding line instead, which keeps
 * the month's "given away" figure exactly true and makes a free meal visible in
 * the day's takings: ₹14,001 says one went out.
 *
 * It is also what keeps the existing tender path unchanged. `bill_payments`
 * requires at least one allocation of more than nought paise, so a ₹0 bill
 * could not be settled at all without a zero-tender branch nobody wants.
 */
export const MINIMUM_BILL_PAISE = 100

/** How a discount arrives at its amount. */
export type DiscountBasis = 'percent' | 'amount'

/**
 * One discount as it is configured, before it meets anything to discount.
 *
 * A percentage is basis points — `1500` is 15% — because integers are the only
 * representation that keeps 12.5% expressible without a float entering the
 * money path. An amount is paise **per unit**, which is why quantity reaches
 * `discountAmountPaise` at all: ₹20 off an item with three on the bill is ₹60,
 * because a percentage would have scaled with the quantity and an amount that
 * did not would be the odd one out [owner, 2026-09-03].
 */
export interface DiscountRule {
  basis: DiscountBasis
  /** Basis points, when the basis is a percentage. */
  percentBp?: number
  /** Paise per unit, when the basis is an amount. */
  amountPaise?: number
}

/**
 * What one rule takes off one base.
 *
 * **Every rule reads the gross base of its own scope**, and the results are
 * summed rather than applied in turn. So 15% and 10% is 25% off the original
 * and not 23.5%, and — the property that actually matters at a counter — the
 * order the biller taps them in cannot change the total.
 *
 * A percentage that does not divide evenly rounds half up, toward the customer.
 * The result is still not a whole rupee, and is not meant to be: the discount
 * stays exactly what it was worth, and the *bill* is what rounds. Rounding here
 * instead would push rounding noise into the figure the owner reads as the cost
 * of a promotion.
 *
 * Capped at the base, so a rule mis-configured above the price of what it
 * reduces cannot drive a line negative. The database refuses that configuration
 * outright; this is the arithmetic refusing to produce nonsense from it anyway.
 */
export function discountAmountPaise(
  rule: DiscountRule,
  basePaise: number,
  quantity: number,
): number {
  assertPaise(basePaise)
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new TypeError(`Expected a whole quantity of at least one, got ${String(quantity)}`)
  }

  let amount: number
  if (rule.basis === 'percent') {
    const percentBp = rule.percentBp ?? 0
    if (!Number.isInteger(percentBp)) {
      throw new TypeError(`Expected whole basis points, got ${String(percentBp)}`)
    }
    if (percentBp < 0) throw new RangeError('A discount cannot be a negative percentage.')
    amount = Math.round((basePaise * percentBp) / 10000)
  } else {
    const perUnit = assertPaise(rule.amountPaise ?? 0)
    if (perUnit < 0) throw new RangeError('A discount cannot be a negative amount.')
    amount = perUnit * quantity
  }

  return Math.min(amount, basePaise)
}

/**
 * `line_total = unit_price × quantity`, the per-line constraint.
 *
 * The quantity is a whole number of items: half a shawarma is not a thing this
 * counter sells, and a fractional quantity here would silently produce a
 * fractional paise total one line up.
 */
export function lineTotalPaise(unitPricePaise: number, quantity: number): number {
  assertPaise(unitPricePaise)
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new TypeError(`Expected a whole quantity of at least one, got ${String(quantity)}`)
  }
  return unitPricePaise * quantity
}

/**
 * `total = subtotal − discount + tax + rounding`, the per-bill constraint.
 *
 * v1 sells at tax-inclusive prices with no GST breakup (`pricing_mode` is
 * `no_tax`), so tax is always zero here — but the equation is written in full
 * because the column exists precisely so that adding it later needs no
 * migration, and an equation that only handles today's case is the one that
 * gets it wrong tomorrow.
 *
 * **This identity is written in three places and all three must agree**: here,
 * the check constraints on `orders` and `bills`, and `billing_validate_totals`
 * in SQL. A drift between them does not fail a test — it refuses live bills at
 * the counter. `billing-totals-agree.test.ts` is what holds them together.
 *
 * Three rules the equation does not show on its face:
 *
 * **The discount is capped, not refused.** An earlier version threw when a
 * discount exceeded its order, which was right while no discount could be
 * entered and is wrong now that two can stack: a 60% menu discount beside a 50%
 * bill discount is ordinary configuration, not a bug, and the counter must
 * produce a bill from it rather than an exception.
 *
 * **The bill rounds up, and the discount does not.** A percentage of an odd
 * subtotal produces paise nobody at this counter can be handed, so the total is
 * carried to the next whole rupee and the difference is kept as its own figure.
 * Always upward, so the paise are never the business's to lose. Rounding the
 * discount instead would have been simpler and would have contaminated the one
 * figure the owner reads to judge a promotion.
 *
 * **A bill with anything on it comes to at least ₹1**, carried there by the
 * same rounding figure. An empty composer is still nought, because an order
 * nobody has started does not cost a rupee.
 */
export function billTotals(
  lines: readonly BillLineAmounts[],
  options: { discountPaise?: number; taxPaise?: number } = {},
): BillTotals {
  const requestedDiscount = assertPaise(options.discountPaise ?? 0)
  const taxPaise = assertPaise(options.taxPaise ?? 0)

  if (requestedDiscount < 0) throw new RangeError('A discount cannot be negative.')

  const subtotalPaise = lines.reduce(
    (running, line) => running + lineTotalPaise(line.unitPricePaise, line.quantity),
    0,
  )

  const discountPaise = Math.min(requestedDiscount, subtotalPaise)
  const netPaise = subtotalPaise - discountPaise + taxPaise

  const totalPaise =
    lines.length === 0
      ? 0
      : Math.max(MINIMUM_BILL_PAISE, Math.ceil(netPaise / 100) * MINIMUM_BILL_PAISE)

  return {
    subtotalPaise,
    discountPaise,
    taxPaise,
    roundingPaise: totalPaise - netPaise,
    totalPaise,
  }
}

/** A menu discount as the counter needs it to price a line. */
export interface MenuDiscountRule extends DiscountRule {
  /** The categories it covers. A line outside all of them is untouched. */
  categoryIds: readonly string[]
}

/** What the menu's discounts take off one line, and the percentage that did it. */
export interface LineDiscount {
  discountPaise: number
  /**
   * The combined percentage, when every rule that reached this line was one.
   * Null where any of them was an amount in rupees, because there is then no
   * single percentage that describes what happened and inventing one would put
   * a number on the bill that no rule produced.
   */
  discountPercentBp: number | null
}

/**
 * What the menu's discounts take off one line.
 *
 * Every rule reads the line's **gross** total, and the results are summed — so
 * two rules covering one category are additive rather than compounding, and the
 * order they were configured in cannot change the answer.
 *
 * Capped at the line total, so a line can never give away more than it is
 * worth. The database refuses that configuration outright and the line's own
 * check constraint refuses the row; this is the arithmetic declining to produce
 * it in the first place.
 */
export function menuLineDiscount(
  line: { categoryId: string | null; unitPricePaise: number; quantity: number },
  rules: readonly MenuDiscountRule[],
): LineDiscount {
  const lineTotal = lineTotalPaise(line.unitPricePaise, line.quantity)
  const applying = line.categoryId
    ? rules.filter((rule) => rule.categoryIds.includes(line.categoryId!))
    : []

  if (applying.length === 0) return { discountPaise: 0, discountPercentBp: null }

  const discountPaise = Math.min(
    lineTotal,
    applying.reduce((sum, rule) => sum + discountAmountPaise(rule, lineTotal, line.quantity), 0),
  )

  const allPercent = applying.every((rule) => rule.basis === 'percent')
  const discountPercentBp = allPercent
    ? applying.reduce((sum, rule) => sum + (rule.percentBp ?? 0), 0)
    : null

  return { discountPaise, discountPercentBp }
}

// ─────────────────────────────────────────────────────────────────────────────
// What a bill is called before it has a number.

/**
 * Crockford base32, minus the characters that get misread aloud. The first
 * character of a reference is drawn from the letters only, so a provisional
 * reference can never be read — or parsed — as a number.
 */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const CROCKFORD_LETTERS = 'ABCDEFGHJKMNPQRSTVWXYZ'

/**
 * The short token that stands in for a bill number until the bill syncs.
 *
 * Bill numbers are the server's, assigned at insert, per outlet and sequential.
 * A queued bill has none, and showing a plausible-looking integer would be the
 * worst possible lie to tell a biller — or a customer reading over the counter.
 * So this is deliberately unlike one: four characters, the first always a
 * letter, derived from the bill's own client UUID so the same bill always
 * carries the same token.
 */
export function provisionalToken(clientId: string): string {
  const hex = clientId.replace(/[^0-9a-fA-F]/g, '')
  let hash = 0
  for (const character of hex) {
    hash = (hash * 33 + parseInt(character, 16)) % 0xffffffff
  }

  const first = CROCKFORD_LETTERS[hash % CROCKFORD_LETTERS.length]!
  let rest = ''
  let remaining = Math.floor(hash / CROCKFORD_LETTERS.length)
  for (let index = 0; index < 3; index += 1) {
    rest += CROCKFORD[remaining % CROCKFORD.length]!
    remaining = Math.floor(remaining / CROCKFORD.length)
  }
  return `${first}${rest}`
}

/** What a queued bill is called on screen. Never formatted as a bill number. */
export function provisionalReference(clientId: string): string {
  return `Queued · ${provisionalToken(clientId)}`
}

/** What a sent bill is called on screen, once the server has numbered it. */
export function billReference(billNumber: number): string {
  return `Bill ${billNumber}`
}

// ─────────────────────────────────────────────────────────────────────────────
// The queue's three visible states.

/**
 * How many unsent bills means something is wrong rather than merely busy. A
 * counter clears a bill every minute or two, so five waiting is already a
 * queue that is not moving.
 */
export const SYNC_ESCALATION_COUNT = 5

/** How long the oldest unsent bill may wait before the same conclusion. */
export const SYNC_ESCALATION_MS = 2 * 60 * 1000

/**
 * The server-authoritative tender-correction window measured from `paid_at`.
 */
export const PAYMENT_EDIT_WINDOW_MS = 5 * 60 * 1000

export type SyncStateKind = 'synced' | 'pending' | 'stalled'

/**
 * The state the counter's indicator shows. Never a dialog, at any of the three:
 * a modal in front of a queue is a modal in front of a customer.
 */
export function classifySync(input: {
  pending: number
  /** Epoch milliseconds of the oldest unsent bill, or null when nothing waits. */
  oldestQueuedAt: number | null
  now: number
}): SyncStateKind {
  if (input.pending <= 0) return 'synced'
  if (input.pending >= SYNC_ESCALATION_COUNT) return 'stalled'
  if (input.oldestQueuedAt !== null && input.now - input.oldestQueuedAt >= SYNC_ESCALATION_MS) {
    return 'stalled'
  }
  return 'pending'
}
