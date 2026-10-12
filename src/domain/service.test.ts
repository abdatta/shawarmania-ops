import { describe, expect, it } from 'vitest'

import { billTotals } from './billing'
import { NotPaiseError } from './money'
import {
  ALL_OFF_SERVICE_SETTINGS,
  busyTables,
  capturePackaging,
  initialServiceType,
  offeredServiceTypes,
  ordersOffered,
  packagingApplies,
  packagingLine,
  packagingWaived,
  serviceChoiceRequired,
  serviceChoiceShown,
  serviceSettingsProblem,
  sharedTables,
  isTableNumber,
  tablesOffered,
  withOrdersSwitched,
  withPackagingSwitched,
  type OutletServiceSettings,
} from './service'

const ALL_ON: OutletServiceSettings = {
  collectCustomerDetails: true,
  dineInOffered: true,
  takeawayOffered: true,
  tableNumbers: true,
  packagingMode: 'per_bag',
  packagingPricePaise: 500,
  packagingFreeForGold: true,
}

describe('an outlet with nothing chosen', () => {
  it('is a combination the database accepts', () => {
    expect(serviceSettingsProblem(ALL_OFF_SERVICE_SETTINGS)).toBeNull()
  })

  it('offers no chip, no table, no packaging and no waiver', () => {
    expect(ordersOffered(ALL_OFF_SERVICE_SETTINGS)).toBe(false)
    expect(offeredServiceTypes(ALL_OFF_SERVICE_SETTINGS)).toEqual([])
    expect(tablesOffered(ALL_OFF_SERVICE_SETTINGS)).toBe(false)
    expect(initialServiceType(ALL_OFF_SERVICE_SETTINGS)).toBeNull()
    expect(packagingApplies(ALL_OFF_SERVICE_SETTINGS, null)).toBe(false)
    expect(capturePackaging(ALL_OFF_SERVICE_SETTINGS)).toBeNull()
    expect(packagingWaived(ALL_OFF_SERVICE_SETTINGS, 'gold')).toBe(false)
  })
})

describe('serviceSettingsProblem', () => {
  it('accepts every switch on', () => {
    expect(serviceSettingsProblem(ALL_ON)).toBeNull()
  })

  it.each([
    [{ dineInOffered: false }, 'tables_without_dine_in'],
    [{ packagingMode: 'off' as const }, 'packaging_price_without_charge'],
    [{ takeawayOffered: false }, 'packaging_without_takeaway'],
    [{ packagingPricePaise: null }, 'packaging_price_required'],
    [{ packagingPricePaise: 550 }, 'packaging_price_not_whole_rupees'],
    [{ packagingPricePaise: 0 }, 'packaging_price_too_low'],
    [{ packagingMode: 'off' as const, packagingPricePaise: null }, 'gold_waiver_without_charge'],
  ])('refuses %o as %s', (patch, problem) => {
    expect(serviceSettingsProblem({ ...ALL_ON, ...patch })).toBe(problem)
  })

  it('accepts ₹1, and has no ceiling', () => {
    expect(serviceSettingsProblem({ ...ALL_ON, packagingPricePaise: 100 })).toBeNull()
    expect(serviceSettingsProblem({ ...ALL_ON, packagingPricePaise: 250_000 })).toBeNull()
  })
})

describe('the settings page switches', () => {
  it('turns Orders on with both types and no tables', () => {
    const on = withOrdersSwitched(ALL_OFF_SERVICE_SETTINGS, true)
    expect(on).toMatchObject({
      dineInOffered: true,
      takeawayOffered: true,
      tableNumbers: false,
    })
    expect(serviceSettingsProblem(on)).toBeNull()
  })

  it('turns Orders off clearing both types, the table count and the packaging', () => {
    const off = withOrdersSwitched(ALL_ON, false)
    expect(ordersOffered(off)).toBe(false)
    expect(off.tableNumbers).toBe(false)
    expect(off).toMatchObject({
      packagingMode: 'off',
      packagingPricePaise: null,
      packagingFreeForGold: false,
    })
    expect(serviceSettingsProblem(off)).toBeNull()
  })

  it('turns Packaging on flat per order and waits for a price the owner types', () => {
    const on = withPackagingSwitched(withOrdersSwitched(ALL_OFF_SERVICE_SETTINGS, true), true)
    expect(on.packagingMode).toBe('per_order')
    expect(serviceSettingsProblem(on)).toBe('packaging_price_required')
  })

  it('turns Packaging off clearing the price and the waiver', () => {
    const off = withPackagingSwitched(ALL_ON, false)
    expect(off).toMatchObject({
      packagingMode: 'off',
      packagingPricePaise: null,
      packagingFreeForGold: false,
    })
    expect(serviceSettingsProblem(off)).toBeNull()
  })
})

describe('what the counter asks, and what a new order starts on', () => {
  const TAKEAWAY_ONLY = { ...ALL_ON, dineInOffered: false, tableNumbers: false }
  const DINE_IN_ONLY = {
    ...ALL_OFF_SERVICE_SETTINGS,
    dineInOffered: true,
    tableNumbers: false,
  }

  it('asks where both types are offered, and preselects neither', () => {
    expect(serviceChoiceShown(ALL_ON)).toBe(true)
    expect(initialServiceType(ALL_ON)).toBeNull()
  })

  it('asks nothing at a takeaway-only shop, where every order is takeaway', () => {
    expect(serviceChoiceShown(TAKEAWAY_ONLY)).toBe(false)
    expect(initialServiceType(TAKEAWAY_ONLY)).toBe('takeaway')
    expect(serviceChoiceRequired(TAKEAWAY_ONLY, 'takeaway')).toBe(false)
  })

  it('asks nothing at a dine-in-only shop without tables', () => {
    expect(serviceChoiceShown(DINE_IN_ONLY)).toBe(false)
    expect(initialServiceType(DINE_IN_ONLY)).toBe('dine_in')
  })

  it('asks for a table at a dine-in-only shop with tables, and will not let it pass', () => {
    const withTables = { ...DINE_IN_ONLY, tableNumbers: true }
    expect(serviceChoiceShown(withTables)).toBe(true)
    expect(initialServiceType(withTables)).toBeNull()
    expect(serviceChoiceRequired(withTables, null)).toBe(true)
    // A table, or No table, is the answer.
    expect(serviceChoiceRequired(withTables, 'dine_in')).toBe(false)
  })

  it('requires an answer wherever both are offered: there is no skipping it', () => {
    expect(serviceChoiceRequired(ALL_ON, null)).toBe(true)
    expect(serviceChoiceRequired(ALL_ON, 'takeaway')).toBe(false)
    expect(serviceChoiceRequired(ALL_ON, 'dine_in')).toBe(false)
  })

  it('asks nothing and requires nothing of an outlet that has chosen nothing', () => {
    expect(serviceChoiceShown(ALL_OFF_SERVICE_SETTINGS)).toBe(false)
    expect(serviceChoiceRequired(ALL_OFF_SERVICE_SETTINGS, null)).toBe(false)
  })
})

describe('packaging', () => {
  it('applies to a takeaway order and to nothing else', () => {
    expect(packagingApplies(ALL_ON, 'takeaway')).toBe(true)
    expect(packagingApplies(ALL_ON, null)).toBe(false)
    expect(packagingApplies(ALL_ON, 'dine_in')).toBe(false)
  })

  it('captures the price in force and one bag', () => {
    expect(capturePackaging(ALL_ON)).toEqual({ unitPricePaise: 500, quantity: 1 })
    expect(
      capturePackaging({ ...ALL_ON, packagingMode: 'per_order', packagingPricePaise: 1000 }),
    ).toEqual({ unitPricePaise: 1000, quantity: 1 })
  })

  it('is a line named Packaging with no menu item and no category', () => {
    expect(packagingLine({ unitPricePaise: 500, quantity: 2 }, false)).toEqual({
      kind: 'packaging',
      menuItemId: '',
      itemName: 'Packaging',
      unitPricePaise: 500,
      quantity: 2,
      discountPaise: 0,
      discountPercentBp: null,
      categoryName: null,
    })
  })

  it('refuses a price that is not paise, as every line does', () => {
    expect(() => packagingLine({ unitPricePaise: 5.5, quantity: 1 }, false)).toThrow(NotPaiseError)
  })
})

describe('the gold waiver', () => {
  it('is free for a member where the outlet waives, and nowhere else', () => {
    expect(packagingWaived(ALL_ON, 'gold')).toBe(true)
    expect(packagingWaived(ALL_ON, null)).toBe(false)
    expect(packagingWaived({ ...ALL_ON, packagingFreeForGold: false }, 'gold')).toBe(false)
  })

  it('is the whole line as its own discount, at one hundred percent', () => {
    const line = packagingLine({ unitPricePaise: 500, quantity: 2 }, true)
    expect(line.discountPaise).toBe(1000)
    expect(line.discountPercentBp).toBe(10_000)
  })

  it('changes a total only by the packaging, which is what #57 allows', () => {
    const food = { unitPricePaise: 24_000, quantity: 1 }
    const charged = packagingLine({ unitPricePaise: 500, quantity: 2 }, false)
    const waived = packagingLine({ unitPricePaise: 500, quantity: 2 }, true)
    const stranger = billTotals([food, charged], { discountPaise: charged.discountPaise })
    const member = billTotals([food, waived], { discountPaise: waived.discountPaise })
    expect(stranger.totalPaise).toBe(25_000)
    expect(member.totalPaise).toBe(24_000)
    // Same subtotal: the waiver is a discount beside the price, never a lower price.
    expect(member.subtotalPaise).toBe(stranger.subtotalPaise)
  })
})

describe('busyTables', () => {
  const order = (
    id: string,
    status: string,
    serviceType: 'dine_in' | 'takeaway' | null,
    tableNumber: number | null,
  ) => ({ id, status, serviceType, tableNumber })

  it('holds a table only while its order is open', () => {
    const busy = busyTables([
      order('a', 'open', 'dine_in', 4),
      order('b', 'paid', 'dine_in', 5),
      order('c', 'cancelled', 'dine_in', 6),
      order('d', 'open', 'dine_in', null),
      order('e', 'open', 'takeaway', null),
    ])
    expect([...busy.keys()]).toEqual([4])
  })

  it('leaves out the order being edited, so it can keep its own table', () => {
    expect(busyTables([order('a', 'open', 'dine_in', 4)], 'a').size).toBe(0)
  })

  it('keeps the first of two orders seated at one table', () => {
    const busy = busyTables([order('a', 'open', 'dine_in', 4), order('b', 'open', 'dine_in', 4)])
    expect(busy.get(4)?.id).toBe('a')
  })
})

describe('isTableNumber', () => {
  it('takes one to three digits, 1 to 999', () => {
    expect(isTableNumber(1)).toBe(true)
    expect(isTableNumber(999)).toBe(true)
    expect(isTableNumber(0)).toBe(false)
    expect(isTableNumber(1000)).toBe(false)
    expect(isTableNumber(4.5)).toBe(false)
  })
})

describe('sharedTables', () => {
  const at = (
    id: string,
    orderedAt: string,
    tableNumber: number | null,
    status = 'open',
    serviceType: 'dine_in' | 'takeaway' = 'dine_in',
  ) => ({ id, status, orderedAt, serviceType, tableNumber })

  it('numbers the open orders sharing a table, oldest first', () => {
    const shared = sharedTables([
      at('newer', '2026-09-27T20:10:00Z', 8),
      at('older', '2026-09-27T19:40:00Z', 8),
      at('alone', '2026-09-27T19:50:00Z', 3),
    ])
    expect(shared.get('older')).toEqual({ position: 1, of: 2 })
    expect(shared.get('newer')).toEqual({ position: 2, of: 2 })
    expect(shared.has('alone')).toBe(false)
  })

  it('leaves out paid and cancelled orders, which have freed the table', () => {
    const shared = sharedTables([
      at('paid', '2026-09-27T19:40:00Z', 8, 'paid'),
      at('cancelled', '2026-09-27T19:45:00Z', 8, 'cancelled'),
      at('open', '2026-09-27T20:10:00Z', 8),
    ])
    expect(shared.size).toBe(0)
  })

  it('counts three at one table', () => {
    const shared = sharedTables([
      at('a', '2026-09-27T19:00:00Z', 4),
      at('c', '2026-09-27T21:00:00Z', 4),
      at('b', '2026-09-27T20:00:00Z', 4),
    ])
    expect([...shared.entries()].sort()).toEqual([
      ['a', { position: 1, of: 3 }],
      ['b', { position: 2, of: 3 }],
      ['c', { position: 3, of: 3 }],
    ])
  })
})
