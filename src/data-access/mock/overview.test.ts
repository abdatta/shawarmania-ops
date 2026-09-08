import { expect, it } from 'vitest'
import {
  createDemoData,
  createMockAdapters,
  OUTLET_KALYANI_ID as KAL,
  OUTLET_KANCHRAPARA_ID as KPA,
} from './index'
import { overviewPeriod } from '@/domain/overview'

it('demo Overview equals the underlying Ledger days and Drawer state', async () => {
  const data = createDemoData()
  const adapters = createMockAdapters('super_admin', data)
  const date = data.store.today
  const day = await adapters.ledgerStatement.getDay(KAL, date)
  expect(await adapters.overview.sales(KAL, date)).toEqual({
    cashPaise: day.revenue.cashPaise,
    upiPaise: day.revenue.upiPaise,
  })
  const drawer = await adapters.cashDrawer.getState(KAL)
  expect(await adapters.overview.drawer(KAL)).toEqual({
    expectedPaise: drawer.expectedNowPaise,
    leftPaise: drawer.leftInDrawerPaise,
    spentPaise: drawer.cashExpensesSincePaise,
  })
  const period = overviewPeriod(date)
  const full = await adapters.ledgerStatement.getMonth(KAL, period.month)
  const todayRevenue = period.fullMonth ? 0 : day.revenue.totalPaise
  const revenue = await adapters.overview.revenue(KAL, period.from, period.through)
  expect(revenue.revenuePaise).toBe(full.reading.netRevenuePaise - todayRevenue)
})

it('demo manager refuses another outlet', async () => {
  const adapters = createMockAdapters('franchise_admin')
  await expect(adapters.overview.revenue(KPA, '2026-09-01', '2026-09-07')).rejects.toThrow(
    'not available',
  )
})

it.each(['biller', 'employee'] as const)('demo %s cannot read financial Overview', async (role) => {
  const adapters = createMockAdapters(role)
  await expect(adapters.overview.sales(KAL, '2026-09-08')).rejects.toThrow('not available')
})
