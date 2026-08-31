import { describe, expect, it } from 'vitest'

import { createMockAttendanceAdapter } from './attendance'
import { createMockInsightsAdapter } from './insights'
import { createDemoStore, DEMO_OUTLET_ID, DEMO_SECOND_OUTLET_ID, type DemoStore } from './store'

/**
 * The three things the owner's figures have to be true about, because #13 will
 * have to make them true in SQL: they are summed from rows rather than supplied,
 * a closed day reports its snapshot, and only the owner reads across outlets.
 */
describe('mock insights adapter', () => {
  const asOwner = (): {
    store: DemoStore
    adapter: ReturnType<typeof createMockInsightsAdapter>
  } => {
    const store = createDemoStore()
    return {
      store,
      adapter: createMockInsightsAdapter(store, createMockAttendanceAdapter(), 'super_admin', {
        outletId: null,
      }),
    }
  }

  it('marks the cash-basis estimate as a ceiling while a commission is undetermined', async () => {
    const { store, adapter } = asOwner()
    const summary = await adapter.periodSummary(
      DEMO_OUTLET_ID,
      { from: store.businessDate(3), to: store.today },
      'cash',
    )

    expect(summary?.profit.basis).toBe('cash')
    expect(summary?.profit.isCeiling).toBe(true)
  })

  const asManagerOf = (outletId: string) => {
    const store = createDemoStore()
    return {
      store,
      adapter: createMockInsightsAdapter(store, createMockAttendanceAdapter(), 'franchise_admin', {
        outletId,
      }),
    }
  }

  it('sums today’s sales from the outlet’s own settled bills', async () => {
    const { store, adapter } = asOwner()
    const day = await adapter.outletDay(DEMO_OUTLET_ID, store.today)

    const expected = store.bills
      .filter(
        (bill) =>
          bill.outlet_id === DEMO_OUTLET_ID &&
          bill.business_date === store.today &&
          bill.status === 'settled',
      )
      .reduce((running, bill) => running + bill.total_paise, 0)

    expect(day?.salesPaise).toBe(expected)
    expect(day?.billCount).toBeGreaterThan(0)
  })

  it('does not let one outlet’s takings reach another’s figures', async () => {
    const { store, adapter } = asOwner()

    const kalyani = await adapter.outletDay(DEMO_OUTLET_ID, store.today)
    const kanchrapara = await adapter.outletDay(DEMO_SECOND_OUTLET_ID, store.today)
    const everything = store.bills
      .filter((bill) => bill.business_date === store.today && bill.status === 'settled')
      .reduce((running, bill) => running + bill.total_paise, 0)

    expect(kanchrapara?.salesPaise).toBeGreaterThan(0)
    expect((kalyani?.salesPaise ?? 0) + (kanchrapara?.salesPaise ?? 0)).toBe(everything)
  })

  it('splits sales by payment method, adding back to the total', async () => {
    const { store, adapter } = asOwner()
    const day = await adapter.outletDay(DEMO_OUTLET_ID, store.today)

    const summed = (day?.salesByMethod ?? []).reduce(
      (running, total) => running + total.amountPaise,
      0,
    )
    expect(summed).toBe(day?.salesPaise)
    // The scenario has to contain more than one method, or this proves nothing.
    expect((day?.salesByMethod ?? []).length).toBeGreaterThan(1)
  })

  /**
   * This used to read `daily_cash_records`. `cash-is-counted-not-closed` (#11)
   * stopped anything writing that table, so the console's figure now comes from
   * the drawer observation that falls inside the date — the same row the drawer
   * and the Ledger read.
   *
   * The claim is unchanged and is the one that matters: the console reports the
   * figure the count was measured against, not a recomputation of it.
   */
  it('reports a counted day’s drawer from the observation, not from a recomputation', async () => {
    const { store, adapter } = asOwner()
    const yesterday = store.businessDate(1)
    const day = await adapter.outletDay(DEMO_OUTLET_ID, yesterday)
    const observation = store.drawerObservations.find(
      (candidate) =>
        candidate.outlet_id === DEMO_OUTLET_ID &&
        !candidate.is_anchor &&
        candidate.counted_at >= new Date(`${yesterday}T04:00:00+05:30`).toISOString(),
    )

    expect(observation).toBeDefined()
    expect(day?.dayClosed).toBe(true)
    expect(day?.expectedCashPaise).toBe(observation?.expected_paise)
    expect(day?.cashDifferencePaise).toBe(observation?.difference_paise)
    expect(day?.cashDifferencePaise).not.toBe(0)
  })

  it('leaves an open day’s difference unanswered rather than calling it nil', async () => {
    const { store, adapter } = asOwner()
    const day = await adapter.outletDay(DEMO_OUTLET_ID, store.today)

    expect(day?.dayClosed).toBe(false)
    expect(day?.cashDifferencePaise).toBeNull()
  })

  it('counts the low stock and the open alerts the other surfaces show', async () => {
    const { store, adapter } = asOwner()
    const kalyani = await adapter.outletDay(DEMO_OUTLET_ID, store.today)
    const kanchrapara = await adapter.outletDay(DEMO_SECOND_OUTLET_ID, store.today)

    expect(kalyani?.lowStockCount).toBe(
      store.inventoryItems.filter(
        (item) =>
          item.outlet_id === DEMO_OUTLET_ID && item.current_quantity <= item.low_stock_threshold,
      ).length,
    )
    expect(kalyani?.lowStockCount).toBeGreaterThan(0)
    expect(kanchrapara?.lowStockCount).toBe(0)

    expect(kalyani?.openAlertCount).toBe(
      store.alerts.filter((alert) => alert.outlet_id === DEMO_OUTLET_ID && alert.status === 'open')
        .length,
    )
  })

  it('covers every day of a period, including one with no trade', async () => {
    const { store, adapter } = asOwner()
    // Wider than the days the scenario trades on, so the period genuinely
    // contains a blank one — a report that silently dropped quiet days would
    // make a week look busier than it was.
    const period = { from: store.businessDate(6), to: store.today }
    const summary = await adapter.periodSummary(DEMO_OUTLET_ID, period, 'cash')

    expect(summary?.days).toHaveLength(7)
    expect(summary?.days.map((day) => day.businessDate)).toEqual(
      Array.from({ length: 7 }, (_, index) => store.businessDate(6 - index)),
    )
    expect(summary?.days.some((day) => day.salesPaise === 0)).toBe(true)
    expect(summary?.days.some((day) => day.salesPaise > 0)).toBe(true)
    expect(summary?.days.reduce((running, day) => running + day.salesPaise, 0)).toBe(
      summary?.salesPaise,
    )
  })

  it('compares outlets, and only the ones the caller may read', async () => {
    const { store, adapter } = asOwner()
    const period = { from: store.businessDate(1), to: store.today }

    const rows = await adapter.comparison(store.tradingOutletIds, period, 'cash')
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.outletId).sort()).toEqual([...store.tradingOutletIds].sort())
    expect(rows.every((row) => row.outletName.length > 0)).toBe(true)
    // The two outlets are deliberately different sizes, so the screen that
    // compares them has something to show.
    expect(rows[0]?.salesPaise).not.toBe(rows[1]?.salesPaise)
  })

  it('refuses a manager the other outlet’s figures, by excluding them', async () => {
    const { store, adapter } = asManagerOf(DEMO_OUTLET_ID)
    const period = { from: store.businessDate(1), to: store.today }

    expect(await adapter.outletDay(DEMO_OUTLET_ID, store.today)).not.toBeNull()
    expect(await adapter.outletDay(DEMO_SECOND_OUTLET_ID, store.today)).toBeNull()
    expect(await adapter.periodSummary(DEMO_SECOND_OUTLET_ID, period, 'cash')).toBeNull()

    const rows = await adapter.comparison(store.tradingOutletIds, period, 'cash')
    expect(rows.map((row) => row.outletId)).toEqual([DEMO_OUTLET_ID])
  })
})
