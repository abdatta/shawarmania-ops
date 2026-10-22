import { expect, it } from 'vitest'
import {
  createDemoData,
  createMockAdapters,
  OUTLET_KALYANI_ID as KAL,
  OUTLET_KANCHRAPARA_ID as KPA,
} from './index'

it('demo Overview equals the underlying Ledger days and Drawer state', async () => {
  const data = createDemoData()
  const adapters = createMockAdapters('super_admin', data)
  const date = data.store.today
  const day = await adapters.ledgerStatement.getDay(KAL, date)
  expect(await adapters.overview.today(KAL)).toMatchObject({
    cashPaise: day.revenue.cashPaise,
    upiPaise: day.revenue.upiPaise,
  })
  const drawer = await adapters.cashDrawer.getState(KAL)
  expect(await adapters.overview.drawer(KAL)).toEqual({
    expectedPaise: drawer.expectedNowPaise,
    leftPaise: drawer.leftInDrawerPaise,
    spentPaise: drawer.cashExpensesSincePaise,
  })
})

it('demo manager refuses another outlet', async () => {
  const adapters = createMockAdapters('franchise_admin')
  await expect(adapters.overview.month(KPA)).rejects.toThrow('not available')
})

it.each(['biller', 'employee'] as const)('demo %s cannot read financial Overview', async (role) => {
  const adapters = createMockAdapters(role)
  await expect(adapters.overview.today(KAL)).rejects.toThrow('not available')
})
