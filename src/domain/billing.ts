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
  totalPaise: number
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
 * `total = subtotal − discount + tax`, the per-bill constraint.
 *
 * v1 sells at tax-inclusive prices with no GST breakup (`pricing_mode` is
 * `no_tax`) and offers no discount, so both default to zero — but the equation
 * is written in full because the columns exist precisely so that adding either
 * later needs no migration, and an equation that only handles today's case is
 * the one that gets it wrong tomorrow.
 */
export function billTotals(
  lines: readonly BillLineAmounts[],
  options: { discountPaise?: number; taxPaise?: number } = {},
): BillTotals {
  const discountPaise = assertPaise(options.discountPaise ?? 0)
  const taxPaise = assertPaise(options.taxPaise ?? 0)

  const subtotalPaise = lines.reduce(
    (running, line) => running + lineTotalPaise(line.unitPricePaise, line.quantity),
    0,
  )

  if (discountPaise > subtotalPaise) {
    throw new RangeError('A discount cannot be larger than the order it discounts.')
  }

  return {
    subtotalPaise,
    discountPaise,
    taxPaise,
    totalPaise: subtotalPaise - discountPaise + taxPaise,
  }
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
 * How long a settled bill is held before it is sent — the window in which the
 * biller can still undo it.
 *
 * Long enough to notice "that was the wrong payment method" while the customer
 * is still standing there; short enough that a queue is not routinely holding
 * work. Undo cancels an unsent queue entry, so nothing is ever edited.
 */
export const UNDO_WINDOW_MS = 6 * 1000

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
