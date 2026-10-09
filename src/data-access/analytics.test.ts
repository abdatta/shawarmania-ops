import { describe, expect, it } from 'vitest'
import {
  bucketDays,
  csvCell,
  growth,
  salesValue,
  periodDays,
  shiftDate,
  totalDays,
} from '@/domain/sales-analytics'
import { analyticsSeries, analyticsSnapshot, type AnalyticsSnapshot } from '@/data-access/analytics'
import { createMockAdapters } from '@/data-access/mock'
import { createDemoData } from '@/data-access/mock'
import { analyticsRevenueDays, validAnalyticsDate } from '@/domain/sales-analytics'
import { DEMO_OUTLET_ID, DEMO_SECOND_OUTLET_ID } from '@/data-access/mock/store'

describe('analytics periods and bounded aggregates', () => {
  it('mature walkthrough history supports every preset and reconciles with shared bills', async () => {
    const started = performance.now()
    const fixture = createDemoData({ matureHistory: true })
    const adapter = createMockAdapters('super_admin', fixture).analytics
    expect(fixture.store.bills.length).toBeGreaterThan(7500)
    expect(fixture.store.bills.length).toBeLessThan(14000)
    expect(fixture.store.billItems.length).toBeLessThan(40000)
    const sourceDays = fixture.store.aggregatorChannelDays.map(
      (row) => `${row.outlet_id}:${row.business_date}:${row.channel}`,
    )
    expect(new Set(sourceDays).size).toBe(sourceDays.length)
    const openOrder = fixture.store.orders.find((order) => order.order_number === 104)!
    expect(fixture.store.orderItems.filter((line) => line.order_id === openOrder.id)).toEqual([
      expect.objectContaining({ item_name: 'Classic Chicken Shawarma', quantity: 2 }),
    ])
    const before = shiftDate(fixture.store.today, -1)
    for (const count of [7, 30, 90]) {
      const from = shiftDate(fixture.store.today, -count)
      const data = await adapter.read(DEMO_OUTLET_ID, from, before)
      const current = totalDays(data.days.filter((d) => d.date >= from))
      const previous = totalDays(data.days.filter((d) => d.date < from))
      const bills = fixture.store.bills.filter(
        (b) =>
          b.outlet_id === DEMO_OUTLET_ID &&
          b.status === 'settled' &&
          b.business_date >= from &&
          b.business_date <= before,
      )
      expect(current.orders).toBe(bills.length)
      expect(current.revenue).toBe(bills.reduce((sum, b) => sum + b.total_paise, 0))
      expect(data.items.reduce((sum, i) => sum + i.units, 0)).toBe(current.units)
      expect(previous.orders).toBeGreaterThan(100)
      expect(previous.revenue).toBeGreaterThan(0)
      if (count >= 30)
        expect(data.days.some((day) => day.date >= from && day.revenue === 0)).toBe(true)
      expect(data.items.some((i) => i.units > i.previousUnits && i.previousUnits > 0)).toBe(true)
      expect(data.items.some((i) => i.units < i.previousUnits && i.previousUnits > 0)).toBe(true)
      expect(data.items.some((i) => i.units === 0 && i.available)).toBe(true)
      expect(data.categories.length).toBeGreaterThan(5)
      expect(data.hours.length).toBeGreaterThan(5)
      expect(new Set(data.days.map((d) => d.revenue)).size).toBeGreaterThan(10)
      expect(data.delivery.some((d) => d.channel === 'swiggy')).toBe(true)
      expect(data.delivery.some((d) => d.channel === 'zomato')).toBe(true)
      expect(
        totalDays(
          bucketDays(
            data.days.filter((d) => d.date >= from),
            'month',
          ),
        ).revenue,
      ).toBe(current.revenue)
    }
    const from = shiftDate(fixture.store.today, -30)
    const snapshot = await adapter.read(DEMO_OUTLET_ID, from, before)
    fixture.store.menuItems.forEach((item) => {
      item.price_paise = 100
    })
    expect((await adapter.read(DEMO_OUTLET_ID, from, before)).days).toEqual(snapshot.days)
    const manager = await createMockAdapters('franchise_admin', fixture).analytics.read(
      DEMO_OUTLET_ID,
      from,
      before,
    )
    expect(manager.items).toEqual(snapshot.items)
    const older = await adapter.read(
      DEMO_OUTLET_ID,
      shiftDate(fixture.store.today, -90),
      shiftDate(fixture.store.today, -31),
    )
    expect(totalDays(older.days).orders).toBeGreaterThan(100)
    console.info(
      `Mature demo: ${fixture.store.bills.length} bills, ${fixture.store.billItems.length} lines; creation and analytics checks ${Math.round(performance.now() - started)}ms`,
    )
  })
  it('rejects impossible dates and keeps counter metrics unchanged by delivery', () => {
    expect(validAnalyticsDate('2026-02-31')).toBe(false)
    expect(validAnalyticsDate('2024-02-29')).toBe(true)
    const data: AnalyticsSnapshot = {
      categories: [],
      days: [{ date: '2026-10-01', revenue: 1000, orders: 2, units: 3, discounts: 0 }],
      items: [],
      hours: [],
      delivery: [{ date: '2026-10-01', channel: 'zomato', revenue: 500, provisional: true }],
    }
    expect(analyticsRevenueDays(data, true)[0]).toEqual({ ...data.days[0], revenue: 1500 })
    expect(analyticsRevenueDays(data, false)[0]?.revenue).toBe(1000)
    expect(data.days[0]?.revenue).toBe(1000)
  })
  it('demo totals reconcile exactly, exclude voids and packaging, and ignore current prices', async () => {
    const fixture = createDemoData()
    const from = shiftDate(fixture.store.today, -28),
      to = fixture.store.today
    const bills = fixture.store.bills.filter(
      (b) =>
        b.outlet_id === DEMO_OUTLET_ID &&
        b.business_date >= from &&
        b.business_date <= to &&
        b.status === 'settled',
    )
    expect(bills.length).toBeGreaterThan(0)
    const ids = new Set(bills.map((b) => b.id))
    const units = fixture.store.billItems
      .filter((l) => ids.has(l.bill_id) && l.kind === 'item')
      .reduce((sum, l) => sum + l.quantity, 0)
    const adapter = createMockAdapters('super_admin', fixture).analytics
    const before = await adapter.read(DEMO_OUTLET_ID, from, to)
    expect(totalDays(before.days.filter((d) => d.date >= from))).toMatchObject({
      revenue: bills.reduce((sum, b) => sum + b.total_paise, 0),
      orders: bills.length,
      units,
    })
    fixture.store.menuItems.forEach((m) => {
      m.price_paise = 100
    })
    const after = await adapter.read(DEMO_OUTLET_ID, from, to)
    expect(after.days).toEqual(before.days)
    expect(after.items.map((i) => i.revenue)).toEqual(before.items.map((i) => i.revenue))
    const first = bills[0]!
    first.status = 'void'
    first.voided_at = new Date().toISOString()
    first.void_reason = 'Test void'
    const voided = await adapter.read(DEMO_OUTLET_ID, from, to)
    expect(totalDays(voided.days.filter((d) => d.date >= from)).revenue).toBe(
      totalDays(before.days.filter((d) => d.date >= from)).revenue - first.total_paise,
    )
  })
  it('compares inclusive adjacent ranges across year and leap boundaries', () => {
    expect(periodDays('2024-02-28', '2024-03-01')).toBe(3)
    expect(shiftDate('2026-01-01', -1)).toBe('2025-12-31')
    expect(growth(4, 0)).toContain('no baseline')
    expect(growth(0, 0)).toBe('No sales in either period')
    expect(growth(75, 100)).toBe('-25.0% vs previous period')
  })
  it('keeps dish revenue distinct from packaging and bill-level discounts', async () => {
    const fixture = createDemoData()
    const base = fixture.store.bills.find(
      (b) => b.outlet_id === DEMO_OUTLET_ID && b.status === 'settled',
    )!
    const line = fixture.store.billItems.find((l) => l.bill_id === base.id && l.kind === 'item')!
    const id = '71000000-0000-4000-a000-000000000010'
    // Two ₹50 dishes, a ₹10 line discount, ₹5 packaging and another ₹10
    // bill discount: dish revenue ₹90, settled bill revenue ₹85, two dish units.
    fixture.store.bills.push({
      ...base,
      id,
      bill_number: 90001,
      business_date: '2020-01-01',
      ordered_at: '2020-01-01T07:30:00Z',
      subtotal_paise: 10500,
      discount_paise: 2000,
      tax_paise: 0,
      rounding_paise: 0,
      total_paise: 8500,
    })
    fixture.store.billItems.push(
      {
        ...line,
        id: '71000000-0000-4000-a000-000000000011',
        bill_id: id,
        quantity: 2,
        unit_price_paise: 5000,
        line_total_paise: 10000,
        discount_paise: 1000,
        discount_percent_bp: 1000,
      },
      {
        ...line,
        id: '71000000-0000-4000-a000-000000000012',
        bill_id: id,
        kind: 'packaging',
        menu_item_id: null,
        category_name: null,
        item_name: 'Bag',
        quantity: 1,
        unit_price_paise: 500,
        line_total_paise: 500,
        discount_paise: 0,
        discount_percent_bp: null,
      },
    )
    const result = await createMockAdapters('super_admin', fixture).analytics.read(
      DEMO_OUTLET_ID,
      '2020-01-01',
      '2020-01-01',
    )
    expect(totalDays(result.days)).toMatchObject({ revenue: 8500, orders: 1, units: 2 })
    expect(result.items.find((i) => i.key === line.menu_item_id)).toMatchObject({
      revenue: 9000,
      units: 2,
      discounts: 1000,
      orders: 1,
    })
    expect(result.categories.reduce((sum, c) => sum + c.revenue, 0)).toBe(9000)
  })
  it('uses Monday weeks, calendar months and preserves zero-sales days', () => {
    const days = ['2026-09-27', '2026-09-28', '2026-10-01'].map((date, i) => ({
      date,
      revenue: i * 100,
      orders: i,
      units: i,
      discounts: 0,
    }))
    expect(bucketDays(days, 'week').map((d) => d.date)).toEqual(['2026-09-21', '2026-09-28'])
    expect(bucketDays(days, 'month').map((d) => d.revenue)).toEqual([100, 200])
    expect(totalDays(bucketDays(days, 'week'))).toEqual(totalDays(days))
  })
  it('charts any dish or category from a series that reconciles to the snapshot', async () => {
    const fixture = createDemoData({ matureHistory: true })
    const adapter = createMockAdapters('super_admin', fixture).analytics
    const to = shiftDate(fixture.store.today, -1)
    const from = shiftDate(fixture.store.today, -30)
    const snapshot = await adapter.read(DEMO_OUTLET_ID, from, to, { view: 'items', periods: 2 })
    // Split a two-window series into its windows: [previous, current].
    const windows = async (subject: Parameters<typeof adapter.series>[4]) => {
      const series = await adapter.series(DEMO_OUTLET_ID, from, to, 2, subject)
      expect(series.from).toBe(shiftDate(from, -30))
      expect(series.units).toHaveLength(60)
      const sum = (rows: number[]) => rows.reduce((total, n) => total + n, 0)
      return {
        previous: {
          units: sum(series.units.slice(0, 30)),
          revenue: sum(series.revenue.slice(0, 30)),
        },
        current: { units: sum(series.units.slice(30)), revenue: sum(series.revenue.slice(30)) },
      }
    }
    const all = await windows({ kind: 'all' })
    expect(all.current.units).toBe(snapshot.items.reduce((sum, i) => sum + i.units, 0))
    for (const item of snapshot.items.filter((i) => i.units).slice(0, 5)) {
      const dish = await windows({ kind: 'item', key: item.key })
      expect(dish.current).toEqual({ units: item.units, revenue: item.revenue })
      expect(dish.previous.units).toBe(item.previousUnits)
    }
    expect(snapshot.categories.some((c) => c.previousUnits > 0)).toBe(true)
    for (const category of snapshot.categories) {
      const chart = await windows({ kind: 'category', name: category.name })
      expect(chart.current).toEqual({ units: category.units, revenue: category.revenue })
      expect(chart.previous).toEqual({
        units: category.previousUnits,
        revenue: category.previousRevenue,
      })
    }
    await expect(
      createMockAdapters('franchise_admin', fixture).analytics.series(
        DEMO_SECOND_OUTLET_ID,
        from,
        to,
        2,
        { kind: 'all' },
      ),
    ).rejects.toThrow()
    await expect(adapter.series(DEMO_OUTLET_ID, from, to, 5, { kind: 'all' })).rejects.toThrow()
  })
  it('fails closed on malformed aggregates and makes CSV names inert', () => {
    expect(() => analyticsSnapshot({ days: [] })).toThrow()
    expect(analyticsSeries({ from: '2026-10-01', units: [1, 0], revenue: [100, 0] })).toEqual({
      from: '2026-10-01',
      units: [1, 0],
      revenue: [100, 0],
    })
    for (const bad of [
      null,
      { from: '2026-02-31', units: [], revenue: [] },
      { from: '2026-10-01', units: [1], revenue: [] },
      { from: '2026-10-01', units: [-1], revenue: [0] },
      { from: '2026-10-01', units: [1.5], revenue: [0] },
      { from: '2026-10-01', units: Array(369).fill(0), revenue: Array(369).fill(0) },
    ])
      expect(() => analyticsSeries(bad)).toThrow()
    expect(csvCell('=HYPERLINK("bad")')).toBe('"\'=HYPERLINK(""bad"")"')
  })
  it('uses weighted counter AOV and leaves missing values unknown', () => {
    expect(salesValue(10500, 10, 'aov')).toBe(1050)
    expect(salesValue(10000, 0, 'aov')).toBeNull()
    expect(salesValue(10000, 0, 'orders')).toBe(0)
    expect(salesValue(10000, 0, 'revenue')).toBe(10000)
    const total = totalDays([
      { date: '2026-10-01', revenue: 1000, orders: 1, units: 1, discounts: 0 },
      { date: '2026-10-02', revenue: 9500, orders: 9, units: 9, discounts: 0 },
    ])
    expect(salesValue(total.revenue, total.orders, 'aov')).toBe(1050)
  })
  it('returns only view aggregates and reconciles four hourly windows', async () => {
    const fixture = createDemoData({ matureHistory: true })
    const adapter = createMockAdapters('super_admin', fixture).analytics
    const to = shiftDate(fixture.store.today, -1),
      from = shiftDate(to, -29)
    const sales = await adapter.read(DEMO_OUTLET_ID, from, to, { view: 'sales', periods: 4 })
    expect(sales.days).toHaveLength(120)
    expect(sales.items).toEqual([])
    expect(sales.categories).toEqual([])
    expect(sales.hours.length).toBeLessThanOrEqual(96)
    for (let period = 0; period < 4; period++) {
      const first = shiftDate(from, -period * 30),
        last = shiftDate(to, -period * 30)
      const bills = fixture.store.bills.filter(
        (b) =>
          b.outlet_id === DEMO_OUTLET_ID &&
          b.status === 'settled' &&
          b.business_date >= first &&
          b.business_date <= last,
      )
      const hourly = sales.hours.filter((h) => h.period === period)
      expect(hourly.reduce((sum, h) => sum + h.orders, 0)).toBe(bills.length)
      expect(hourly.reduce((sum, h) => sum + h.revenue, 0)).toBe(
        bills.reduce((sum, b) => sum + b.total_paise, 0),
      )
    }
    const items = await adapter.read(DEMO_OUTLET_ID, from, to, { view: 'items', periods: 2 })
    const all = await adapter.read(DEMO_OUTLET_ID, from, to)
    expect(items.days).toHaveLength(2)
    expect(items.hours).toEqual([])
    expect(items.delivery).toEqual([])
    expect(items.items).toEqual(all.items)
    expect(totalDays(items.days)).toEqual(totalDays(all.days))
    expect(JSON.stringify(items).length).toBeLessThan(JSON.stringify(all).length)
    console.info(
      `Mature aggregate JSON bytes: Items/30d/2=${new TextEncoder().encode(JSON.stringify(items)).length}; Sales/30d/4=${new TextEncoder().encode(JSON.stringify(sales)).length}`,
    )
    await expect(
      adapter.read(DEMO_OUTLET_ID, from, to, { view: 'sales', periods: 5 }),
    ).rejects.toThrow()
  })
  it('demo reads scoped snapshots and refuses another outlet or staff', async () => {
    const from = '2026-01-01',
      to = '2026-03-31'
    const data = await createMockAdapters('super_admin').analytics.read(DEMO_OUTLET_ID, from, to)
    expect(data.days.length).toBe(periodDays(from, to) * 2)
    expect(data.items.some((i) => i.active && i.units === 0)).toBe(true)
    await expect(
      createMockAdapters('franchise_admin').analytics.read(DEMO_SECOND_OUTLET_ID, from, to),
    ).rejects.toThrow()
    await expect(
      createMockAdapters('employee').analytics.read(DEMO_OUTLET_ID, from, to),
    ).rejects.toThrow()
  })
})
