import type { BillingBill } from '@/data-access/adapters'

/**
 * The Bills tab's sort and filter (billing-day-at-a-glance, design D4).
 *
 * Every sort key exists on every bill, cancelled ones included, so no
 * combination of a sort and a filter leaves bills with nothing to sort by —
 * which is why there is no *cancel time* sort: with Paid ticked it would sort
 * on a time none of the bills have. Within a group choices widen; across
 * groups they narrow; an empty group does not filter. Customer is one choice,
 * because its options overlap (Gold is a kind of With number) and contradict
 * (Without and Gold).
 */
export type BillSort = 'paid' | 'ordered' | 'amount' | 'wait'
export type BillKind = 'paid' | 'cancelled' | 'cancelled_after_paid' | 'payment_undone'
export type BillTender = 'cash' | 'upi' | 'mixed'
export type BillCustomer = 'all' | 'with_number' | 'without' | 'gold'
export type BillService = 'dine_in' | 'takeaway'
export type BillTrait = 'discount' | 'payment_changed' | 'receipt_failed'

export interface BillFilter {
  sort: BillSort
  /** Newest, highest or longest first: the order the reader reaches for. */
  descending: boolean
  kinds: readonly BillKind[]
  tenders: readonly BillTender[]
  customer: BillCustomer
  services: readonly BillService[]
  traits: readonly BillTrait[]
  tablets: readonly string[]
}

/** Today's list: every bill, newest payment first. */
export const DEFAULT_BILL_FILTER: BillFilter = {
  sort: 'paid',
  descending: true,
  kinds: [],
  tenders: [],
  customer: 'all',
  services: [],
  traits: [],
  tablets: [],
}

export const SORT_LABELS: Record<BillSort, string> = {
  paid: 'Paid time',
  ordered: 'Order time',
  amount: 'Amount',
  wait: 'Wait',
}

/** Each sort's two directions in its own words: [descending, ascending]. */
export const ORDER_WORDS: Record<BillSort, readonly [string, string]> = {
  paid: ['Newest first', 'Oldest first'],
  ordered: ['Newest first', 'Oldest first'],
  amount: ['Highest first', 'Lowest first'],
  wait: ['Longest first', 'Shortest first'],
}

export const KIND_LABELS: Record<BillKind, string> = {
  paid: 'Paid',
  cancelled: 'Cancelled',
  cancelled_after_paid: 'Cancelled after paid',
  payment_undone: 'Payment undone',
}

export const TENDER_LABELS: Record<BillTender, string> = {
  cash: 'Cash',
  upi: 'UPI',
  mixed: 'Split',
}

export const CUSTOMER_LABELS: Record<BillCustomer, string> = {
  all: 'All',
  with_number: 'With number',
  without: 'Without',
  gold: 'Gold',
}

export const SERVICE_LABELS: Record<BillService, string> = {
  dine_in: 'Dine-in',
  takeaway: 'Takeaway',
}

export const TRAIT_LABELS: Record<BillTrait, string> = {
  discount: 'Had a discount',
  payment_changed: 'Payment changed',
  receipt_failed: 'Receipt failed',
}

export function billKind(bill: BillingBill): BillKind {
  if (bill.status !== 'void') return 'paid'
  if (bill.voidKind === 'cancelled_after_paid') return 'cancelled_after_paid'
  if (bill.voidKind === 'counter_unpay') return 'payment_undone'
  // `manager_void`, and legacy voids with no kind, which read as a manager's.
  return 'cancelled'
}

function hasNumber(bill: BillingBill): boolean {
  return (bill.customerPhone ?? '').trim() !== ''
}

function matchesCustomer(bill: BillingBill, customer: BillCustomer): boolean {
  switch (customer) {
    case 'all':
      return true
    case 'with_number':
      return hasNumber(bill)
    // A name alone is no way to find a customer again, so it counts as without.
    case 'without':
      return !hasNumber(bill)
    case 'gold':
      return bill.customerTier === 'gold'
  }
}

function hasTrait(bill: BillingBill, trait: BillTrait): boolean {
  switch (trait) {
    case 'discount':
      return bill.discounts.length > 0
    case 'payment_changed':
      return bill.paymentRevision > 0
    case 'receipt_failed':
      return bill.receiptDelivery?.state === 'failed'
  }
}

/** A group with no choice does not filter; with choices, any of them will do. */
function within<T>(chosen: readonly T[], value: T): boolean {
  return chosen.length === 0 || chosen.includes(value)
}

export function matchesBillFilter(bill: BillingBill, filter: BillFilter): boolean {
  return (
    within(filter.kinds, billKind(bill)) &&
    within(filter.tenders, bill.paymentMethod) &&
    matchesCustomer(bill, filter.customer) &&
    (filter.services.length === 0 ||
      (bill.serviceType != null && filter.services.includes(bill.serviceType))) &&
    (filter.traits.length === 0 || filter.traits.some((trait) => hasTrait(bill, trait))) &&
    (filter.tablets.length === 0 ||
      (bill.tillLabel !== null && filter.tablets.includes(bill.tillLabel)))
  )
}

function sortKey(bill: BillingBill, sort: BillSort): number {
  switch (sort) {
    case 'paid':
      return Date.parse(bill.paidAt)
    case 'ordered':
      return Date.parse(bill.orderedAt)
    case 'amount':
      return bill.totalPaise
    case 'wait':
      return Date.parse(bill.paidAt) - Date.parse(bill.orderedAt)
  }
}

/** The bills the filter keeps, in its order. Ties go by bill number, the same way. */
export function applyBillFilter(bills: readonly BillingBill[], filter: BillFilter): BillingBill[] {
  const sign = filter.descending ? -1 : 1
  return bills
    .filter((bill) => matchesBillFilter(bill, filter))
    .sort(
      (left, right) =>
        sign * (sortKey(left, filter.sort) - sortKey(right, filter.sort)) ||
        sign * (left.billNumber - right.billNumber),
    )
}

export function isDefaultBillFilter(filter: BillFilter): boolean {
  return (
    filter.sort === DEFAULT_BILL_FILTER.sort &&
    filter.descending === DEFAULT_BILL_FILTER.descending &&
    filter.kinds.length === 0 &&
    filter.tenders.length === 0 &&
    filter.customer === 'all' &&
    filter.services.length === 0 &&
    filter.traits.length === 0 &&
    filter.tablets.length === 0
  )
}

/**
 * What the Filter button says is in force: the chosen filters, then the sort
 * when it is not the default — *Cancelled · Amount, highest*. A group of more
 * than one choice is named by its count, so the label stays one line.
 */
export function billFilterSummary(filter: BillFilter): string {
  const group = <T extends string>(
    chosen: readonly T[],
    labels: Record<T, string>,
    noun: string,
  ) =>
    chosen.length === 0
      ? []
      : chosen.length === 1
        ? [labels[chosen[0]!]]
        : [`${chosen.length} ${noun}`]
  const parts = [
    ...group(filter.kinds, KIND_LABELS, 'kinds'),
    ...group(filter.tenders, TENDER_LABELS, 'tenders'),
    ...(filter.customer === 'all' ? [] : [CUSTOMER_LABELS[filter.customer]]),
    ...group(filter.services, SERVICE_LABELS, 'services'),
    ...group(filter.traits, TRAIT_LABELS, 'traits'),
    ...(filter.tablets.length === 0
      ? []
      : filter.tablets.length === 1
        ? [filter.tablets[0]!]
        : [`${filter.tablets.length} tablets`]),
  ]
  if (
    filter.sort !== DEFAULT_BILL_FILTER.sort ||
    filter.descending !== DEFAULT_BILL_FILTER.descending
  ) {
    const [first, second] = ORDER_WORDS[filter.sort]
    const direction = (filter.descending ? first : second).replace(/ first$/, '').toLowerCase()
    parts.push(`${SORT_LABELS[filter.sort]}, ${direction}`)
  }
  return parts.join(' · ')
}

/** The billing tablets the day's bills were taken on, by name, as the Tablet group offers them. */
export function dayTablets(bills: readonly BillingBill[]): string[] {
  return [
    ...new Set(bills.map((bill) => bill.tillLabel).filter((label): label is string => !!label)),
  ].sort((left, right) => left.localeCompare(right))
}
