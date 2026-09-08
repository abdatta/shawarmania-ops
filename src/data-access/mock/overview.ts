import { shiftBusinessDate } from '@/domain'
import type { OverviewAdapter } from '../overview'
import type { DemoStore } from './store'
import type { DemoCounter } from './counter'
import { createMockCashDrawerAdapter } from './cash-drawer'
import { createMockLedgerStatementAdapter } from './ledger-statement'

/** Reuses the scenario's source readers, never authored headline numbers. */
export function createMockOverviewAdapter(
  store: DemoStore,
  counter: DemoCounter,
  userId: string,
  allowed: readonly string[] | null,
): OverviewAdapter {
  const ledger = createMockLedgerStatementAdapter(store, userId)
  const drawer = createMockCashDrawerAdapter(store, userId)
  function check(outletId: string) {
    if (allowed && !allowed.includes(outletId))
      throw new Error('Overview is not available at this outlet')
  }
  return {
    async sales(outletId, date) {
      check(outletId)
      const { revenue } = await ledger.getDay(outletId, date)
      return { cashPaise: revenue.cashPaise, upiPaise: revenue.upiPaise }
    },
    async revenue(outletId, from, through) {
      check(outletId)
      let revenuePaise = 0
      let provisional = false
      let hasSales = false
      let incomplete = false
      for (let date = from; date <= through; date = shiftBusinessDate(date, 1)) {
        const { revenue } = await ledger.getDay(outletId, date)
        revenuePaise += revenue.totalPaise
        provisional ||= revenue.isCeiling
        hasSales ||=
          revenue.cashPaise + revenue.upiPaise > 0 || revenue.channels.some((c) => c.grossPaise > 0)
        incomplete ||= ['zomato', 'swiggy'].some(
          (channel) => !revenue.channels.some((c) => c.channel === channel),
        )
      }
      return { revenuePaise, provisional, hasSales, incomplete }
    },
    async expenses(outletId, from, through) {
      check(outletId)
      return store.expenses
        .filter(
          (e) =>
            e.outlet_id === outletId &&
            e.voided_at === null &&
            e.business_date >= from &&
            e.business_date <= through,
        )
        .reduce((sum, e) => sum + e.amount_paise, 0)
    },
    async drawer(outletId) {
      check(outletId)
      const state = await drawer.getState(outletId)
      return {
        expectedPaise: state.expectedNowPaise,
        leftPaise: state.leftInDrawerPaise,
        spentPaise: state.cashExpensesSincePaise,
      }
    },
    async tablets(outletId) {
      check(outletId)
      return counter.devices.filter((d) => d.outletId === outletId).map((d) => d.lastSeenAt)
    },
  }
}
