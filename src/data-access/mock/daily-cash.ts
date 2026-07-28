import { differencePaise, expectedClosingPaise } from '@/domain'

import {
  DailyCashActionError,
  type CloseDayInput,
  type DailyCashAdapter,
  type DailyCashDay,
  type NewWithdrawal,
  type ReconciliationException,
} from '../adapters'
import type { Tables } from '../database.types'
import { personaFixtures } from './fixtures/personas'
import type { DemoStore } from './store'

/**
 * The mock daily cash record — the screen this business was commissioned to get
 * right.
 *
 * Three rules from `openspec/specs/daily-cash-reconciliation/spec.md` are
 * mirrored here, and each one is load-bearing rather than decorative:
 *
 *  - **the figures are computed, never supplied.** The caller sends the counted
 *    amount and a note. Cash sales, cash expenses and withdrawals are read from
 *    the outlet's own rows for that date, exactly as `close_business_day` will;
 *  - **only cash moves them.** A UPI sale raises revenue and not the drawer;
 *  - **a closed day is a snapshot.** Nothing recomputes it, and a bill that
 *    arrives for a date already closed raises a visible exception instead of
 *    quietly rewriting a number somebody signed their name to.
 */

const CLOSED_BY = personaFixtures.franchise_admin.profile.id

export function createMockDailyCashAdapter(store: DemoStore): DailyCashAdapter {
  let nextWithdrawal = 1

  const closedRecord = (outletId: string, businessDate: string) =>
    store.dailyCashRecords.find(
      (record) => record.outlet_id === outletId && record.business_date === businessDate,
    ) ?? null

  const cashSales = (outletId: string, businessDate: string, before?: string) =>
    store.bills
      .filter(
        (bill) =>
          bill.outlet_id === outletId &&
          bill.business_date === businessDate &&
          bill.payment_method === 'cash' &&
          bill.status === 'settled' &&
          (before === undefined || bill.synced_at <= before),
      )
      .reduce((running, bill) => running + bill.total_paise, 0)

  const cashExpenses = (outletId: string, businessDate: string) =>
    store.expenses
      .filter(
        (expense) =>
          expense.outlet_id === outletId &&
          expense.business_date === businessDate &&
          expense.payment_method === 'cash',
      )
      .reduce((running, expense) => running + expense.amount_paise, 0)

  const withdrawalsFor = (outletId: string, businessDate: string) =>
    store.withdrawals
      .filter(
        (withdrawal) =>
          withdrawal.outlet_id === outletId && withdrawal.business_date === businessDate,
      )
      .sort((a, b) => b.created_at.localeCompare(a.created_at))

  /**
   * Bills that landed after the drawer had been counted.
   *
   * The comparison is `synced_at` against `closed_at`, not `created_at`: the
   * bill was rung during the day — that is why it belongs to this business date
   * — and it is the *arrival* that came too late. That gap is the whole reason
   * this exception exists rather than a recomputation.
   */
  const exceptionsFor = (
    outletId: string,
    businessDate: string,
    closed: Tables<'daily_cash_records'> | null,
  ): ReconciliationException[] => {
    if (!closed) return []
    return store.bills
      .filter(
        (bill) =>
          bill.outlet_id === outletId &&
          bill.business_date === businessDate &&
          bill.status === 'settled' &&
          bill.synced_at > closed.closed_at,
      )
      .map((bill) => ({
        billId: bill.id,
        billNumber: bill.bill_number,
        businessDate: bill.business_date,
        totalPaise: bill.total_paise,
        paymentMethod: bill.payment_method,
        createdAt: bill.created_at,
        syncedAt: bill.synced_at,
      }))
      .sort((a, b) => a.syncedAt.localeCompare(b.syncedAt))
  }

  function day(outletId: string, businessDate: string): DailyCashDay {
    const closed = closedRecord(outletId, businessDate)
    const withdrawals = withdrawalsFor(outletId, businessDate)
    const cashWithdrawnPaise = withdrawals.reduce(
      (running, withdrawal) => running + withdrawal.amount_paise,
      0,
    )

    // A closed day shows what was stored, not what the rows say now. That is
    // what "snapshot" means, and it is the only reason a late bill can be
    // reported rather than silently absorbed.
    const cashSalesPaise = closed ? closed.cash_sales_paise : cashSales(outletId, businessDate)
    const cashExpensesPaise = closed
      ? closed.cash_expenses_paise
      : cashExpenses(outletId, businessDate)
    const openingCashPaise = closed ? closed.opening_cash_paise : store.openingCashPaise

    return {
      outletId,
      businessDate,
      openingCashPaise,
      cashSalesPaise,
      cashExpensesPaise,
      cashWithdrawnPaise: closed ? closed.cash_withdrawn_paise : cashWithdrawnPaise,
      expectedClosingPaise: closed
        ? closed.expected_closing_paise
        : expectedClosingPaise({
            openingCashPaise,
            cashSalesPaise,
            cashExpensesPaise,
            cashWithdrawnPaise,
          }),
      withdrawals: withdrawals.map((withdrawal) => ({
        id: withdrawal.id,
        amountPaise: withdrawal.amount_paise,
        withdrawnBy: withdrawal.withdrawn_by,
        reason: withdrawal.reason,
        createdAt: withdrawal.created_at,
      })),
      closed,
      exceptions: exceptionsFor(outletId, businessDate, closed),
    }
  }

  return {
    async getDay(outletId: string, businessDate: string) {
      return day(outletId, businessDate)
    },

    async recordWithdrawal(withdrawal: NewWithdrawal) {
      if (closedRecord(withdrawal.outletId, withdrawal.businessDate)) {
        throw new DailyCashActionError(
          'day_closed',
          'That day is closed. Its figures are a snapshot and do not change.',
        )
      }
      if (!Number.isInteger(withdrawal.amountPaise) || withdrawal.amountPaise <= 0) {
        throw new DailyCashActionError(
          'bad_amount',
          'A withdrawal needs an amount above zero, as a number of rupees.',
        )
      }
      if (withdrawal.withdrawnBy.trim() === '') {
        throw new DailyCashActionError(
          'blank_value',
          'A withdrawal needs a name — who took the cash out.',
        )
      }

      store.withdrawals.push({
        id: `dc000000-0000-4000-b000-${String(nextWithdrawal++).padStart(12, '0')}`,
        outlet_id: withdrawal.outletId,
        business_date: withdrawal.businessDate,
        amount_paise: withdrawal.amountPaise,
        reason: withdrawal.reason?.trim() || null,
        withdrawn_by: withdrawal.withdrawnBy.trim(),
        recorded_by: CLOSED_BY,
        created_at: new Date().toISOString(),
      })

      return day(withdrawal.outletId, withdrawal.businessDate)
    },

    async closeDay(input: CloseDayInput) {
      if (closedRecord(input.outletId, input.businessDate)) {
        // One record per outlet per business date. A second close is not a
        // correction, it is a second signature on a different number.
        throw new DailyCashActionError(
          'already_closed',
          'That day has already been closed. Its figures are a snapshot and cannot be redone.',
        )
      }
      if (!Number.isInteger(input.actualClosingPaise) || input.actualClosingPaise < 0) {
        throw new DailyCashActionError(
          'bad_amount',
          'The counted amount must be a number of rupees, and cannot be negative.',
        )
      }

      const current = day(input.outletId, input.businessDate)
      const expected = current.expectedClosingPaise

      const record: Tables<'daily_cash_records'> = {
        id: `dd000000-0000-4000-b000-${String(store.dailyCashRecords.length + 1).padStart(12, '0')}`,
        outlet_id: input.outletId,
        business_date: input.businessDate,
        opening_cash_paise: current.openingCashPaise,
        // Computed here, from this outlet's own rows — never taken from the
        // caller, which is the clause `close_business_day` exists to enforce.
        cash_sales_paise: current.cashSalesPaise,
        cash_expenses_paise: current.cashExpensesPaise,
        cash_withdrawn_paise: current.cashWithdrawnPaise,
        expected_closing_paise: expected,
        actual_closing_paise: input.actualClosingPaise,
        difference_paise: differencePaise(input.actualClosingPaise, expected),
        notes: input.notes?.trim() || null,
        closed_at: new Date().toISOString(),
        closed_by: CLOSED_BY,
      }

      store.dailyCashRecords.push(record)
      return structuredClone(record)
    },
  }
}
