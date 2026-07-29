import {
  expectedClosingPaise,
  isLowStock,
  profitEstimate,
  shiftBusinessDate,
  type ConsumedMovement,
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
 * **Nothing here is authored.** Sales are the bills, expenses are the expense
 * rows, consumption is the ledger, and a closed day's cash figures are the
 * snapshot taken when somebody counted the drawer. That is the whole reason the
 * demo dataset reconciles: there is no second place for a figure to come from
 * (design D4).
 *
 * Two contracts from `docs/DATA_MODEL.md` are mirrored deliberately:
 *
 *  - **a closed day is not recomputed.** Its cash sales, cash expenses and
 *    difference come off `daily_cash_records`, so the bill that arrived after
 *    the close does not silently move a signed-off number. Sales, which nobody
 *    signed, are the bills — and the gap between the two is the reconciliation
 *    exception, not a bug.
 *  - **raw materials are counted once**, which is `src/domain/pnl.ts`'s job and
 *    is why the profit here is always computed on a basis the caller named.
 *
 * The cross-outlet boundary mirrors the policy #13 relies on: only the Super
 * Admin reads more than one outlet, and asking for somebody else's returns
 * nothing rather than throwing — an excluded row is what RLS produces.
 */

const METHOD_ORDER: PaymentMethod[] = ['cash', 'upi', 'card', 'swiggy', 'zomato', 'other']

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
      (expense) => expense.outlet_id === outletId && expense.business_date === businessDate,
    )

  const closedRecord = (outletId: string, businessDate: string) =>
    store.dailyCashRecords.find(
      (record) => record.outlet_id === outletId && record.business_date === businessDate,
    ) ?? null

  function salesByMethod(bills: readonly Tables<'bills'>[]): MethodTotal[] {
    return METHOD_ORDER.map((method) => ({
      method,
      amountPaise: bills
        .filter((bill) => bill.payment_method === method)
        .reduce((running, bill) => running + bill.total_paise, 0),
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

  /** The stock that left the kitchen in a period, priced from its own item. */
  function consumedMovements(outletId: string, dates: readonly string[]): ConsumedMovement[] {
    return store.inventoryMovements
      .filter(
        (movement) =>
          movement.outlet_id === outletId && dates.includes(movement.business_date),
      )
      .map((movement) => {
        const item = store.inventoryItems.find(
          (candidate) => candidate.id === movement.inventory_item_id,
        )
        return {
          movementType: movement.movement_type,
          quantityDelta: movement.quantity_delta,
          purchaseCostPaise: item?.purchase_cost_paise ?? 0,
        }
      })
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
    const closed = closedRecord(outletId, businessDate)

    // A closed day's drawer figures are the snapshot. An open day's are derived
    // from what has been recorded so far — the same arithmetic the cash screen
    // shows, through the same domain function.
    const expectedCashPaise = closed
      ? closed.expected_closing_paise
      : expectedClosingPaise({
          openingCashPaise: store.openingCashPaise,
          cashSalesPaise: bills
            .filter((bill) => bill.payment_method === 'cash')
            .reduce((running, bill) => running + bill.total_paise, 0),
          cashExpensesPaise: expenses
            .filter((expense) => expense.payment_method === 'cash')
            .reduce((running, expense) => running + expense.amount_paise, 0),
          cashWithdrawnPaise: store.withdrawals
            .filter(
              (withdrawal) =>
                withdrawal.outlet_id === outletId && withdrawal.business_date === businessDate,
            )
            .reduce((running, withdrawal) => running + withdrawal.amount_paise, 0),
        })

    const roster = await attendance.listOutletDay(outletId, businessDate)

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
      dayClosed: closed !== null,
      cashDifferencePaise: closed ? closed.difference_paise : null,
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

    const days: PeriodDay[] = dates.map((date) => {
      const closed = closedRecord(outletId, date)
      return {
        businessDate: date,
        salesPaise: settledBills(outletId, date).reduce(
          (running, bill) => running + bill.total_paise,
          0,
        ),
        dayClosed: closed !== null,
        cashDifferencePaise: closed ? closed.difference_paise : null,
      }
    })

    return {
      outletId,
      period: range,
      salesPaise: bills.reduce((running, bill) => running + bill.total_paise, 0),
      billCount: bills.length,
      salesByMethod: salesByMethod(bills),
      expensesByCategory: expensesByCategory(expenses),
      expensesPaise: expenses.reduce((running, expense) => running + expense.amount_paise, 0),
      profit: profitEstimate(basis, {
        salesPaise: bills.reduce((running, bill) => running + bill.total_paise, 0),
        expenses: toExpenseAmounts(expenses),
        movements: consumedMovements(outletId, dates),
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
