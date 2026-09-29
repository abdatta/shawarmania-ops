import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { BillDiscountDraft, BillDraft } from '../adapters'
import { DEMO_OPEN_SHIFT_ID } from './fixtures/billing'
import {
  customerIdForPhone,
  DEMO_MEMBER_CUSTOMER_PHONE,
  DEMO_REGULAR_CUSTOMER_PHONE,
  DEMO_RETURNING_CUSTOMER_PHONE,
} from './fixtures/customers'
import { MENU_ITEM_CLASSIC_ID } from './fixtures/menu'
import { OUTLET_KALYANI_ID, OUTLET_KANCHRAPARA_ID } from './fixtures/outlets'
import { pointsBalance } from './customers'
import { createDemoData, createMockAdapters } from './index'

/**
 * Points and gold in the demo (a-regular-earns-points-and-gold, #62), held to
 * the rules the database will keep: earning is the server's and happens once, a
 * void reverses it, a points row is checked for shape and not for balance, and
 * a counter grants gold only to a customer eligible at its own outlet.
 */

const AFTER_SEND_MS = 2_000
const K = OUTLET_KALYANI_ID
const RITIKA = customerIdForPhone(DEMO_RETURNING_CUSTOMER_PHONE)
const MOUMITA = customerIdForPhone(DEMO_REGULAR_CUSTOMER_PHONE)

function session() {
  const data = createDemoData()
  return { data, till: createMockAdapters('biller', data) }
}

/** A pay-now bill of `quantity` Classics for a customer, with optional points. */
function bill(
  data: ReturnType<typeof createDemoData>,
  clientId: string,
  quantity: number,
  options: { phone?: string; points?: number } = {},
): BillDraft {
  const subtotal = 13_900 * quantity
  const points = options.points ?? 0
  const discounts: BillDiscountDraft[] =
    points > 0
      ? [
          {
            source: 'points',
            basis: 'amount',
            valueBp: null,
            valuePaise: points * 100,
            amountPaise: points * 100,
          },
        ]
      : []
  return {
    clientId,
    outletId: K,
    shiftId: DEMO_OPEN_SHIFT_ID,
    businessDate: data.store.today,
    payments: [{ method: 'cash', amountPaise: subtotal - points * 100 }],
    lines: [
      {
        menuItemId: MENU_ITEM_CLASSIC_ID,
        itemName: 'Classic Chicken Shawarma',
        unitPricePaise: 13_900,
        quantity,
      },
    ],
    discounts,
    customerName: 'Somebody',
    customerPhone: options.phone ?? DEMO_RETURNING_CUSTOMER_PHONE,
  }
}

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: online })
  window.dispatchEvent(new Event(online ? 'online' : 'offline'))
}

describe('points in the demo', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setOnline(true)
  })

  afterEach(() => {
    vi.useRealTimers()
    Reflect.deleteProperty(navigator, 'onLine')
  })

  it('earns in proportion, rounded down, once a settled bill lands', async () => {
    const { data, till } = session()
    const before = pointsBalance(data.customers, K, RITIKA)

    // Three Classics: ₹417 at 5 per ₹200 earns 10.
    await till.billing.settleBill(bill(data, 'aaaaaaaa-0000-4000-8000-000000000062', 3))
    await vi.advanceTimersByTimeAsync(AFTER_SEND_MS)

    expect(pointsBalance(data.customers, K, RITIKA)).toBe(before + 10)
    const earned = data.customers.pointsEntries.filter(
      (entry) => entry.billId === 'aaaaaaaa-0000-4000-8000-000000000062',
    )
    expect(earned).toMatchObject([
      { kind: 'earned', points: 10, earnBasisPaise: 41_700, earnPointsPerBlock: 5 },
    ])
  })

  it('earns on the bill before points, and records the points it used', async () => {
    const { data, till } = session()
    const before = pointsBalance(data.customers, K, RITIKA)

    await till.billing.settleBill(
      bill(data, 'bbbbbbbb-0000-4000-8000-000000000062', 3, { points: 20 }),
    )
    await vi.advanceTimersByTimeAsync(AFTER_SEND_MS)

    // ₹417 paid as ₹397 and 20 points still earns on ₹417.
    expect(pointsBalance(data.customers, K, RITIKA)).toBe(before - 20 + 10)
  })

  it('takes back what a voided bill earned and returns what it used', async () => {
    const { data, till } = session()
    const before = pointsBalance(data.customers, K, RITIKA)
    const manager = createMockAdapters('franchise_admin', data)

    await till.billing.settleBill(
      bill(data, 'cccccccc-0000-4000-8000-000000000062', 3, { points: 20 }),
    )
    await vi.advanceTimersByTimeAsync(AFTER_SEND_MS)
    await manager.billing.voidBill('cccccccc-0000-4000-8000-000000000062', 'Rung twice')

    expect(pointsBalance(data.customers, K, RITIKA)).toBe(before)
    const kinds = data.customers.pointsEntries
      .filter((entry) => entry.billId === 'cccccccc-0000-4000-8000-000000000062')
      .map((entry) => entry.kind)
    expect(kinds.sort()).toEqual(['earned', 'earned_reversed', 'used', 'used_returned'])
  })

  it('refuses a points row that is not whole rupees, or has no customer', async () => {
    const { data, till } = session()
    const fractional = bill(data, 'dddddddd-0000-4000-8000-000000000062', 3, { points: 20 })
    fractional.discounts = [{ ...fractional.discounts![0]!, amountPaise: 2_050, valuePaise: 2_050 }]
    await expect(till.billing.settleBill(fractional)).rejects.toMatchObject({ code: 'malformed' })

    const anonymous = bill(data, 'eeeeeeee-0000-4000-8000-000000000062', 3, { points: 20 })
    anonymous.customerPhone = ''
    await expect(till.billing.settleBill(anonymous)).rejects.toMatchObject({ code: 'malformed' })
  })

  it('records a use beyond the balance rather than refusing the sale', async () => {
    const { data, till } = session()
    const imran = customerIdForPhone('+919000000107')
    await till.billing.settleBill(
      bill(data, 'ffffffff-0000-4000-8000-000000000062', 3, {
        phone: '+919000000107',
        points: 50,
      }),
    )
    await vi.advanceTimersByTimeAsync(AFTER_SEND_MS)
    expect(pointsBalance(data.customers, K, imran)).toBeLessThan(0)
  })

  it('earns nothing at an outlet with points off', async () => {
    const { data, till } = session()
    data.store.loyaltySettings.delete(K)
    const before = pointsBalance(data.customers, K, RITIKA)
    await till.billing.settleBill(bill(data, '11111111-0000-4000-8000-000000000062', 3))
    await vi.advanceTimersByTimeAsync(AFTER_SEND_MS)
    expect(pointsBalance(data.customers, K, RITIKA)).toBe(before)
  })
})

describe('the till’s answers and the counter grant', () => {
  it('tells the till its own outlet’s balance and eligibility', async () => {
    const { till } = session()
    const moumita = await till.customers.lookupByPhone(DEMO_REGULAR_CUSTOMER_PHONE)
    expect(moumita).toMatchObject({ tier: null, goldEligible: true })
    expect(moumita?.pointsBalance).toBeGreaterThan(0)
  })

  it('grants gold to an eligible customer, once, recorded as the counter’s', async () => {
    const { data, till } = session()
    const granted = await till.customers.grantGoldAtCounter(MOUMITA)
    expect(granted).toMatchObject({ tier: 'gold', goldEligible: false })
    await till.customers.grantGoldAtCounter(MOUMITA)

    const spells = data.customers.memberships.filter(
      (spell) => spell.customerId === MOUMITA && spell.revokedAt === null && spell.outletId === K,
    )
    const current = spells.filter((spell) => spell.expiresAt > new Date().toISOString())
    expect(current).toHaveLength(1)
    expect(current[0]).toMatchObject({ grantedVia: 'counter' })
  })

  it('refuses gold to a customer who has not spent enough here', async () => {
    const { data, till } = session()
    const before = data.customers.memberships.length
    const unnamed = customerIdForPhone('+919000000106')
    await expect(till.customers.grantGoldAtCounter(unnamed)).rejects.toMatchObject({
      code: 'not_eligible',
    })
    expect(data.customers.memberships.length).toBe(before)
  })

  it('refuses gold at the counter while the tablet is offline', async () => {
    const { data, till } = session()
    data.store.connectivity.set('network-dropped')
    await expect(till.customers.grantGoldAtCounter(MOUMITA)).rejects.toMatchObject({
      code: 'offline',
    })
    const remembered = await till.customers.lookupByPhone(DEMO_MEMBER_CUSTOMER_PHONE)
    expect(remembered?.remembered).toBe(true)
  })

  it('keeps gold and points at the outlet that gave them', async () => {
    const { data } = session()
    expect(pointsBalance(data.customers, OUTLET_KANCHRAPARA_ID, RITIKA)).toBe(0)
  })
})
