import {
  expectedClosingPaise,
  isLowStock,
  profitEstimate,
  shiftBusinessDate,
  type ExpenseAmount,
  type ProfitBasis,
} from '@/domain'

import type {
  AppRole,
  AttendanceAdapter,
  CategoryTotal,
  InsightsAdapter,
  InsightsPeriod,
  MethodTotal,
  OutletComparisonRow,
  OutletDaySummary,
  PaymentMethod,
  PeriodDay,
  PeriodSummary,
} from '../adapters'
import type { Tables } from '../database.types'
import { outletFixtures } from './fixtures/outlets'
import type { DemoStore } from './store'

/**
 * The mock insights adapter — the owner's figures, derived from the rows the
 * other surfaces write.
 *
 * **Nothing here is authored.** Counter sales are settled bills, channel sales
 * are their net recorded figures, expenses are the canonical expense rows, and
 * a counted day's cash figures come from its drawer observation. That is why the
 * demo dataset reconciles: there is no second place for a figure to come from
 * (design D4).
 *
 * Two contracts from `docs/DATA_MODEL.md` are mirrored deliberately:
 *
 *  - **a counted drawer is not recomputed.** Its expected figure and difference
 *    remain the observation's; later writes continue in the next interval.
 *
 * The cross-outlet boundary mirrors the policy #13 relies on: only the Super
 * Admin reads more than one outlet, and asking for somebody else's returns
 * nothing rather than throwing — an excluded row is what RLS produces.
 */

const METHOD_ORDER: PaymentMethod[] = ['cash', 'upi']

function outletNameOf(outletId: string): string {
  return outletFixtures.find((outlet) => outlet.id === outletId)?.name ?? 'Unknown outlet'
}

/** Business dates from `from` to `to` inclusive. Dates, never timestamps. */
function datesInPeriod(period: InsightsPeriod): string[] {
  const dates: string[] = []
  let cursor = period.from
  // A period is a handful of days in this product; a bounded walk is clearer
  // than date arithmetic and cannot drift across a cutover.
  for (let guard = 0; guard < 400 && cursor <= period.to; guard += 1) {
    dates.push(cursor)
    cursor = shiftBusinessDate(cursor, 1)
  }
  return dates
}

export function createMockInsightsAdapter(
  store: DemoStore,
  attendance: AttendanceAdapter,
  role: AppRole,
  session: { outletId: string | null },
): InsightsAdapter {
  function mayRead(outletId: string): boolean {
    if (role === 'super_admin') return true
    return session.outletId === outletId
  }

  const settledBills = (outletId: string, businessDate: string) =>
    store.bills.filter(
      (bill) =>
        bill.outlet_id === outletId &&
        bill.business_date === businessDate &&
        bill.status === 'settled',
    )

  const expensesOn = (outletId: string, businessDate: string) =>
    store.expenses.filter(
      (expense) =>
        expense.outlet_id === outletId &&
        expense.business_date === businessDate &&
        expense.voided_at === null,
    )

  /**
   * The drawer's own verdict for a business date, from the observation that
   * falls inside it.
   *
   * **This used to read `daily_cash_records`, and `cash-is-counted-not-closed`
   * (#11) stopped anything writing that table.** Left pointed at it, the demo
   * console would report a cash difference sourced from a model the product no
   * longer has — which is exactly the second place for a figure to come from that
   * this file's own contract says must not exist.
   *
   * `counted` stands in for what `dayClosed` used to mean. There is no close, and
   * the honest question a console can ask of a date is whether anybody counted
   * the drawer in it. A date with no observation is not "unclosed", it is
   * `carried`.
   */
  const countedOn = (outletId: string, businessDate: string) => {
    const from = new Date(`${businessDate}T04:00:00+05:30`).toISOString()
    const to = new Date(`${shiftBusinessDate(businessDate, 1)}T04:00:00+05:30`).toISOString()
    return (
      store.drawerObservations.find(
        (observation) =>
          observation.outlet_id === outletId &&
          observation.counted_at >= from &&
          observation.counted_at < to &&
          // An anchor carries no difference at all, so it answers this question
          // with silence rather than with nought.
          !observation.is_anchor,
      ) ?? null
    )
  }

  function salesByMethod(bills: readonly Tables<'bills'>[]): MethodTotal[] {
    return METHOD_ORDER.map((method) => ({
      method,
      amountPaise: bills.reduce(
        (running, bill) =>
          running +
          (
            store.billPayments.get(bill.id) ?? [
              { method: bill.payment_method, amountPaise: bill.total_paise },
            ]
          )
            .filter((payment) => payment.method === method)
            .reduce((sum, payment) => sum + payment.amountPaise, 0),
        0,
      ),
    })).filter((total) => total.amountPaise > 0)
  }

  function expensesByCategory(expenses: readonly Tables<'expenses'>[]): CategoryTotal[] {
    const totals = new Map<Tables<'expenses'>['category'], number>()
    for (const expense of expenses) {
      totals.set(expense.category, (totals.get(expense.category) ?? 0) + expense.amount_paise)
    }
    return [...totals.entries()]
      .map(([category, amountPaise]) => ({ category, amountPaise }))
      .sort((a, b) => b.amountPaise - a.amountPaise)
  }

  function toExpenseAmounts(expenses: readonly Tables<'expenses'>[]): ExpenseAmount[] {
    return expenses.map((expense) => ({
      category: expense.category,
      amountPaise: expense.amount_paise,
    }))
  }

  async function day(outletId: string, businessDate: string): Promise<OutletDaySummary> {
    const bills = settledBills(outletId, businessDate)
    const expenses = expensesOn(outletId, businessDate)
    const counted = countedOn(outletId, businessDate)

    // A counted date's expected figure is the one the observation was measured
    // against — computed at the instant of the count and never recomputed. A date
    // nobody counted derives one from what has been recorded so far, which is the
    // same arithmetic the drawer shows, through the same domain function.
    const expectedCashPaise = counted?.expected_paise
      ? counted.expected_paise
      : expectedClosingPaise({
          openingCashPaise: store.openingCashPaise,
          cashSalesPaise: bills.reduce(
            (running, bill) =>
              running +
              (
                store.billPayments.get(bill.id) ?? [
                  { method: bill.payment_method, amountPaise: bill.total_paise },
                ]
              )
                .filter((payment) => payment.method === 'cash')
                .reduce((sum, payment) => sum + payment.amountPaise, 0),
            0,
          ),
          cashExpensesPaise: expenses
            .filter((expense) => expense.is_cash && expense.voided_at === null)
            .reduce((running, expense) => running + expense.amount_paise, 0),
          cashWithdrawnPaise: 0,
        })

    const roster = await attendance.listOutletDay([outletId], businessDate)

    return {
      outletId,
      businessDate,
      // Sales are the bills, including one that arrived late: nobody signed a
      // revenue figure, and a bill that exists was rung. Only the drawer is a
      // snapshot.
      salesPaise: bills.reduce((running, bill) => running + bill.total_paise, 0),
      billCount: bills.length,
      salesByMethod: salesByMethod(bills),
      expectedCashPaise,
      dayClosed: counted !== null,
      cashDifferencePaise: counted ? counted.difference_paise : null,
      lowStockCount: store.inventoryItems.filter(
        (item) =>
          item.outlet_id === outletId &&
          item.is_active &&
          isLowStock({
            currentQuantity: item.current_quantity,
            lowStockThreshold: item.low_stock_threshold,
          }),
      ).length,
      openAlertCount: store.alerts.filter(
        (alert) => alert.outlet_id === outletId && alert.status === 'open',
      ).length,
      checkedInCount: roster.filter((record) => record.checkIn !== null).length,
      // The same derivation the surfaces use: an arrival with no approval, held
      // at `absent` by the trigger, is a day waiting for a manager.
      waitingApprovalCount: roster.filter(
        (record) =>
          record.checkIn !== null && record.approval === null && record.status === 'absent',
      ).length,
    }
  }

  async function period(
    outletId: string,
    range: InsightsPeriod,
    basis: ProfitBasis,
  ): Promise<PeriodSummary> {
    const dates = datesInPeriod(range)

    const bills = dates.flatMap((date) => settledBills(outletId, date))
    const expenses = dates.flatMap((date) => expensesOn(outletId, date))
    const channels = store.aggregatorChannelDays.filter(
      (row) => row.outlet_id === outletId && dates.includes(row.business_date),
    )
    const salesPaise =
      bills.reduce((running, bill) => running + bill.total_paise, 0) +
      channels.reduce(
        (running, row) => running + row.revenue_paise - (row.commission_paise ?? 0),
        0,
      )

    const days: PeriodDay[] = dates.map((date) => {
      const counted = countedOn(outletId, date)
      const channelNet = channels
        .filter((row) => row.business_date === date)
        .reduce((running, row) => running + row.revenue_paise - (row.commission_paise ?? 0), 0)
      return {
        businessDate: date,
        salesPaise:
          settledBills(outletId, date).reduce((running, bill) => running + bill.total_paise, 0) +
          channelNet,
        dayClosed: counted !== null,
        cashDifferencePaise: counted ? counted.difference_paise : null,
      }
    })

    return {
      outletId,
      period: range,
      salesPaise,
      billCount: bills.length,
      salesByMethod: salesByMethod(bills),
      expensesByCategory: expensesByCategory(expenses),
      expensesPaise: expenses.reduce((running, expense) => running + expense.amount_paise, 0),
      profit: profitEstimate(basis, {
        salesPaise,
        expenses: toExpenseAmounts(expenses),
        isCeiling: channels.some((row) => row.revenue_paise !== 0 && row.commission_paise === null),
      }),
      days,
    }
  }

  return {
    async outletDay(outletId, businessDate) {
      if (!mayRead(outletId)) return null
      return day(outletId, businessDate)
    },

    async periodSummary(outletId, range, basis) {
      if (!mayRead(outletId)) return null
      return period(outletId, range, basis)
    },

    async comparison(outletIds, range, basis): Promise<OutletComparisonRow[]> {
      const readable = outletIds.filter(mayRead)

      return Promise.all(
        readable.map(async (outletId) => {
          const summary = await period(outletId, range, basis)
          const closedDays = summary.days.filter((entry) => entry.dayClosed)

          return {
            outletId,
            outletName: outletNameOf(outletId),
            salesPaise: summary.salesPaise,
            expensesPaise: summary.expensesPaise,
            profitPaise: summary.profit.profitPaise,
            // Only closed days have a counted drawer to differ from. A period
            // with none has no answer, which is different from an answer of nil.
            cashDifferencePaise: closedDays.length
              ? closedDays.reduce((running, entry) => running + (entry.cashDifferencePaise ?? 0), 0)
              : null,
          }
        }),
      )
    },
  }
}
