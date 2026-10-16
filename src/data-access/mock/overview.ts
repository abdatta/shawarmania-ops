import {
  comparisonWindow,
  cutInstant,
  monthToDate,
  readMonth,
  readMonthFigures,
  shiftBusinessDate,
  type MonthDayInput,
} from '@/domain'
import { toMonthDayInput } from '../adapters'
import type { OverviewAdapter, OverviewComparison } from '../overview'
import { outletFixtures } from './fixtures/outlets'
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
  const cutoverOf = (outletId: string) =>
    (outletFixtures.find((o) => o.id === outletId)?.business_day_cutover ?? '04:00:00').slice(0, 5)
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
    // One Revenue (revenue-reads-the-same-everywhere): the demo's own today
    // stands for the server's, and every figure is folded from the same day
    // readings the demo Ledger shows, so the two cannot disagree.
    async today(outletId) {
      check(outletId)
      const { revenue } = await ledger.getDay(outletId, store.today)
      return {
        cashPaise: revenue.cashPaise,
        upiPaise: revenue.upiPaise,
        deliveryPaise: revenue.channels.reduce((sum, c) => sum + c.grossPaise, 0),
      }
    },
    async month(outletId) {
      check(outletId)
      const today = store.today
      const period = monthToDate(today)
      const days: MonthDayInput[] = []
      for (let date = period.from; date <= period.through; date = shiftBusinessDate(date, 1))
        days.push(toMonthDayInput(await ledger.getDay(outletId, date)))
      const figures = readMonthFigures(days, readMonth(days))
      const window = comparisonWindow(period.from, period.through, today)
      const todayHasDelivery = days.at(-1)!.channels.length > 0
      const cutAt = window.cut
        ? cutInstant(window.through, today, Date.now(), cutoverOf(outletId))
        : null
      let revenuePaise = 0
      let hasSales = false
      for (let date = window.from; date <= window.through; date = shiftBusinessDate(date, 1)) {
        const { revenue } = await ledger.getDay(outletId, date)
        const matched = cutAt !== null && date === window.through
        // The matched date counts counter bills ordered before the cut, and its
        // delivery only once today's has arrived (design D3).
        const counter = matched
          ? store.bills
              .filter(
                (b) =>
                  b.outlet_id === outletId &&
                  b.status === 'settled' &&
                  b.business_date === date &&
                  b.ordered_at < cutAt,
              )
              .reduce((sum, b) => sum + b.total_paise, 0)
          : revenue.cashPaise + revenue.upiPaise
        const delivery =
          matched && !todayHasDelivery
            ? 0
            : revenue.channels.reduce((sum, c) => sum + c.grossPaise, 0)
        revenuePaise += counter + delivery
        hasSales ||= counter + delivery > 0
      }
      const previous: OverviewComparison = {
        from: window.from,
        through: window.through,
        cutAt,
        revenuePaise,
        hasSales,
      }
      return {
        ...period,
        revenuePaise: figures.revenuePaise,
        cashPaise: figures.cashPaise,
        upiPaise: figures.upiPaise,
        deliveryPaise: figures.deliveryPaise,
        commissionPaise: figures.commissionPaise,
        waitingDays: figures.waitingDays,
        recordedExpensesPaise: figures.recordedExpensesPaise,
        expensesPaise: figures.expensesPaise,
        profitPaise: figures.profitPaise,
        hasSales: figures.profitPaise !== null,
        previous,
      }
    },
  }
}
