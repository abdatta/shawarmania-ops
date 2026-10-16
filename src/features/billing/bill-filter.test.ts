import { describe, expect, it } from 'vitest'

import type { BillingBill } from '@/data-access/adapters'

import {
  applyBillFilter,
  billFilterSummary,
  billKind,
  CUSTOMER_LABELS,
  dayTablets,
  DEFAULT_BILL_FILTER,
  isDefaultBillFilter,
  KIND_LABELS,
  matchesBillFilter,
  ORDER_WORDS,
  SERVICE_LABELS,
  SORT_LABELS,
  TENDER_LABELS,
  TRAIT_LABELS,
  type BillCustomer,
  type BillFilter,
  type BillSort,
} from './bill-filter'

let next = 100
function bill(overrides: Partial<BillingBill>): BillingBill {
  next += 1
  return {
    id: `bill-${next}`,
    outletId: 'outlet',
    billNumber: next,
    orderId: null,
    orderNumber: null,
    businessDate: '2026-10-16',
    orderedAt: '2026-10-16T07:00:00Z',
    paidAt: '2026-10-16T07:05:00Z',
    paymentBusinessDate: '2026-10-16',
    payments: [],
    paymentRevision: 0,
    paymentEditable: false,
    paymentEditableUntil: null,
    paymentMethod: 'cash',
    status: 'settled',
    billerName: 'Biller',
    tillLabel: 'Till 1',
    customerName: null,
    customerPhone: null,
    customerTier: null,
    lines: [],
    discounts: [],
    roundingPaise: 0,
    totalPaise: 10000,
    voidKind: null,
    voidReason: null,
    voidedAt: null,
    voidedBy: null,
    receiptUrl: null,
    ...overrides,
  }
}

/** A day with one of everything the filter can tell apart. */
const day: BillingBill[] = [
  bill({ totalPaise: 52000, paidAt: '2026-10-16T08:00:00Z', paymentMethod: 'upi' }),
  bill({
    status: 'void',
    voidKind: 'manager_void',
    totalPaise: 30000,
    customerPhone: '9800000001',
    customerTier: 'gold',
  }),
  // A legacy void carries no kind and reads as a manager's.
  bill({ status: 'void', voidKind: null, totalPaise: 12000 }),
  bill({ status: 'void', voidKind: 'cancelled_after_paid', paymentMethod: 'mixed' }),
  bill({ status: 'void', voidKind: 'counter_unpay', tillLabel: 'Till 2' }),
  bill({ customerName: 'Asha', serviceType: 'dine_in', tableNumber: 4 }),
  bill({ customerPhone: '9800000002', serviceType: 'takeaway', paymentRevision: 1 }),
  bill({
    discounts: [{ basis: 'percent', value: 1000 } as unknown as BillingBill['discounts'][number]],
    receiptDelivery: { state: 'failed', failureCode: 'x' },
    orderedAt: '2026-10-16T05:20:00Z',
    paidAt: '2026-10-16T06:50:00Z',
    tillLabel: null,
  }),
  // The same amount and paid time as another, to prove ties go by bill number.
  bill({ totalPaise: 52000, paidAt: '2026-10-16T08:00:00Z', paymentMethod: 'upi' }),
]

const with_ = (patch: Partial<BillFilter>): BillFilter => ({ ...DEFAULT_BILL_FILTER, ...patch })
const numbers = (bills: readonly BillingBill[]) => bills.map((b) => b.billNumber)

describe('the default', () => {
  it('lists every bill, newest payment first, and names nothing', () => {
    const shown = applyBillFilter(day, DEFAULT_BILL_FILTER)
    expect(shown).toHaveLength(day.length)
    for (let i = 1; i < shown.length; i += 1)
      expect(Date.parse(shown[i - 1]!.paidAt)).toBeGreaterThanOrEqual(Date.parse(shown[i]!.paidAt))
    expect(isDefaultBillFilter(DEFAULT_BILL_FILTER)).toBe(true)
    expect(billFilterSummary(DEFAULT_BILL_FILTER)).toBe('')
  })
})

describe('the kinds of bill', () => {
  it('reads a legacy void as a manager’s cancellation', () => {
    expect(day.map(billKind)).toEqual([
      'paid',
      'cancelled',
      'cancelled',
      'cancelled_after_paid',
      'payment_undone',
      'paid',
      'paid',
      'paid',
      'paid',
    ])
  })

  it('widens within a group and narrows across groups', () => {
    const cancelled = applyBillFilter(day, with_({ kinds: ['cancelled', 'cancelled_after_paid'] }))
    expect(cancelled.map(billKind).sort()).toEqual([
      'cancelled',
      'cancelled',
      'cancelled_after_paid',
    ])
    const cancelledCash = applyBillFilter(
      day,
      with_({ kinds: ['cancelled', 'cancelled_after_paid'], tenders: ['cash'] }),
    )
    expect(cancelledCash).toHaveLength(2)
  })
})

describe('the customer', () => {
  it('counts a bill carrying only a name as without', () => {
    const without = applyBillFilter(day, with_({ customer: 'without' }))
    expect(without.some((b) => b.customerName === 'Asha')).toBe(true)
    expect(without.every((b) => !b.customerPhone)).toBe(true)
  })

  it('finds gold among those with a number', () => {
    const gold = applyBillFilter(day, with_({ customer: 'gold' }))
    const numbered = applyBillFilter(day, with_({ customer: 'with_number' }))
    expect(gold).toHaveLength(1)
    expect(numbered.map((b) => b.id)).toContain(gold[0]!.id)
  })
})

describe('the rest of the filters', () => {
  it('reads service, the traits and the tablet', () => {
    expect(applyBillFilter(day, with_({ services: ['dine_in'] }))).toHaveLength(1)
    expect(applyBillFilter(day, with_({ traits: ['discount'] }))).toHaveLength(1)
    expect(applyBillFilter(day, with_({ traits: ['payment_changed'] }))).toHaveLength(1)
    expect(applyBillFilter(day, with_({ traits: ['receipt_failed'] }))).toHaveLength(1)
    // Within a group, choices widen.
    expect(applyBillFilter(day, with_({ traits: ['discount', 'payment_changed'] }))).toHaveLength(2)
    expect(applyBillFilter(day, with_({ tablets: ['Till 2'] }))).toHaveLength(1)
  })

  it('offers the tablets the day used, by name, and none for a bill with no label', () => {
    expect(dayTablets(day)).toEqual(['Till 1', 'Till 2'])
  })
})

describe('sorting', () => {
  it('breaks a tie by bill number in the same direction', () => {
    const tied = day.filter((b) => b.totalPaise === 52000)
    expect(numbers(applyBillFilter(tied, with_({ sort: 'amount', descending: true })))).toEqual(
      numbers(tied).sort((a, b) => b - a),
    )
    expect(numbers(applyBillFilter(tied, with_({ sort: 'amount', descending: false })))).toEqual(
      numbers(tied).sort((a, b) => a - b),
    )
  })

  it('reads wait as paid less ordered', () => {
    const [longest] = applyBillFilter(day, with_({ sort: 'wait', descending: true }))
    expect(longest!.receiptDelivery?.state).toBe('failed')
  })
})

describe('every combination is a sensible list', () => {
  /**
   * The owner asked for every permutation of sort, order and filter to make
   * sense. Taken over a day with one of everything: each choice of sort and
   * direction against each single filter choice and each pair of groups, the
   * result is a subset of the day, every bill in it matches, nothing missing
   * matches, and it is ordered by the sort — so no combination can lose a bill,
   * keep a wrong one or leave one with nothing to sort by.
   */
  const sorts = Object.keys(SORT_LABELS) as BillSort[]
  const singles: Partial<BillFilter>[] = [
    {},
    ...(Object.keys(KIND_LABELS) as BillFilter['kinds'][number][]).map((k) => ({ kinds: [k] })),
    ...(Object.keys(TENDER_LABELS) as BillFilter['tenders'][number][]).map((t) => ({
      tenders: [t],
    })),
    ...(Object.keys(CUSTOMER_LABELS) as BillCustomer[]).map((customer) => ({ customer })),
    ...(Object.keys(SERVICE_LABELS) as BillFilter['services'][number][]).map((s) => ({
      services: [s],
    })),
    ...(Object.keys(TRAIT_LABELS) as BillFilter['traits'][number][]).map((t) => ({ traits: [t] })),
    ...dayTablets(day).map((t) => ({ tablets: [t] })),
  ]
  const combinations = singles.flatMap((a) => singles.map((b) => ({ ...a, ...b })))

  it(`holds for ${sorts.length * 2 * combinations.length} of them`, () => {
    for (const sort of sorts)
      for (const descending of [true, false])
        for (const patch of combinations) {
          const filter = with_({ ...patch, sort, descending })
          const shown = applyBillFilter(day, filter)
          expect(shown.every((b) => matchesBillFilter(b, filter))).toBe(true)
          expect(day.filter((b) => matchesBillFilter(b, filter))).toHaveLength(shown.length)
          const key = (b: BillingBill) =>
            sort === 'amount'
              ? b.totalPaise
              : sort === 'ordered'
                ? Date.parse(b.orderedAt)
                : sort === 'paid'
                  ? Date.parse(b.paidAt)
                  : Date.parse(b.paidAt) - Date.parse(b.orderedAt)
          for (let i = 1; i < shown.length; i += 1) {
            const step = key(shown[i]!) - key(shown[i - 1]!)
            expect(Number.isFinite(step)).toBe(true)
            expect(descending ? step <= 0 : step >= 0).toBe(true)
          }
          expect(typeof billFilterSummary(filter)).toBe('string')
        }
  })
})

describe('the summary', () => {
  it('names the filters, then a sort that is not the default, in the sort’s own words', () => {
    expect(
      billFilterSummary(with_({ kinds: ['cancelled'], sort: 'amount', descending: true })),
    ).toBe('Cancelled · Amount, highest')
    expect(billFilterSummary(with_({ sort: 'wait', descending: false }))).toBe('Wait, shortest')
    expect(billFilterSummary(with_({ kinds: ['paid', 'cancelled'], customer: 'gold' }))).toBe(
      '2 kinds · Gold',
    )
  })

  it('has two directions for every sort', () => {
    for (const sort of Object.keys(SORT_LABELS) as BillSort[])
      expect(ORDER_WORDS[sort]).toHaveLength(2)
  })
})
