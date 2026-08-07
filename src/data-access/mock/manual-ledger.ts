import {
  ManualLedgerActionError,
  type AppRole,
  type ManualLedgerAdapter,
  type ManualLedgerDay,
  type ManualLedgerDayInput,
  type ManualLedgerExpense,
  type ManualLedgerExpensePatch,
  type NewManualLedgerExpense,
} from '../adapters'
import type { Tables } from '../database.types'
import { personaFixtures } from './fixtures/personas'
import type { DemoStore } from './store'
import { captureMockCategory } from './expense-categories'

/**
 * The mock manual-ledger adapter (#36) — **temporary, deleted with the
 * capability**.
 *
 * It exists because the registry contract requires every surface to read through
 * an adapter with a mock behind it, and the four-role walkthrough is a standing
 * gate on every change (design D5). Shipping real-only would have meant arguing
 * around that gate rather than passing it.
 *
 * **The refusals here are the database's, restated.** Not for safety — a demo has
 * nothing to protect — but so the surface is built against the answers it will
 * actually get. A mock that accepted a blank expense description would teach the
 * screen that the field is optional, and the first real write would be refused by
 * a constraint nobody had designed for.
 *
 * What it deliberately does not do is compute anything: every figure comes from
 * `src/features/manual-ledger/ledger.ts`, in both modes.
 */

const OWNER_ID = personaFixtures.super_admin.profile.id

function toDay(row: Tables<'manual_ledger_days'>): ManualLedgerDay {
  return {
    outletId: row.outlet_id,
    businessDate: row.business_date,
    openingCashPaise: row.opening_cash_paise,
    cashRevenuePaise: row.cash_revenue_paise,
    upiRevenuePaise: row.upi_revenue_paise,
    zomatoRevenuePaise: row.zomato_revenue_paise,
    swiggyRevenuePaise: row.swiggy_revenue_paise,
    cashAddedPaise: row.cash_added_paise,
    cashAddedReason: row.cash_added_reason,
    cashRemovedPaise: row.cash_removed_paise,
    cashRemovedReason: row.cash_removed_reason,
    countedCashPaise: row.counted_cash_paise,
    zomatoCommissionBp: row.zomato_commission_bp,
    swiggyCommissionBp: row.swiggy_commission_bp,
    note: row.note,
  }
}

function toExpense(row: Tables<'manual_ledger_expenses'>): ManualLedgerExpense {
  return {
    id: row.id,
    outletId: row.outlet_id,
    businessDate: row.business_date,
    category: row.category,
    isCash: row.is_cash,
    amountPaise: row.amount_paise,
    note: row.description,
    createdAt: row.created_at,
  }
}

function trimmed(value: string | null | undefined): string | null {
  const text = value?.trim()
  return text ? text : null
}

/** Every check the migration writes as a constraint, in the order it writes them. */
function refuseImpossibleDay(day: ManualLedgerDayInput): void {
  for (const [figure, label] of [
    [day.openingCashPaise, 'opening cash'],
    [day.countedCashPaise, 'the counted amount'],
    [day.cashAddedPaise, 'cash brought in'],
    [day.cashRemovedPaise, 'cash taken out'],
  ] as const) {
    if (!Number.isInteger(figure) || figure < 0) {
      throw new ManualLedgerActionError(
        'impossible_figure',
        `A drawer cannot hold less than nothing — check ${label}.`,
      )
    }
  }

  if (day.cashAddedPaise > 0 && !trimmed(day.cashAddedReason)) {
    throw new ManualLedgerActionError(
      'reason_required',
      'Say why cash was brought in. A movement with no reason is unexplainable later.',
    )
  }
  if (day.cashRemovedPaise > 0 && !trimmed(day.cashRemovedReason)) {
    throw new ManualLedgerActionError(
      'reason_required',
      'Say why cash was taken out. A movement with no reason is unexplainable later.',
    )
  }

  for (const [bp, label] of [
    [day.zomatoCommissionBp, 'Zomato'],
    [day.swiggyCommissionBp, 'Swiggy'],
  ] as const) {
    if (!Number.isInteger(bp) || bp < 0 || bp > 10_000) {
      throw new ManualLedgerActionError(
        'impossible_figure',
        `The ${label} commission has to be between 0% and 100%.`,
      )
    }
  }
}

function refuseImpossibleExpense(expense: { amountPaise: number; category: string }): void {
  if (!Number.isInteger(expense.amountPaise) || expense.amountPaise <= 0) {
    throw new ManualLedgerActionError(
      'bad_amount',
      'An expense needs an amount above zero, as a number of rupees.',
    )
  }
  if (!expense.category.trim()) {
    throw new ManualLedgerActionError(
      'category_required',
      'Choose or type what the money was spent on.',
    )
  }
}

export function createMockManualLedgerAdapter(
  store: DemoStore,
  role: AppRole,
): ManualLedgerAdapter {
  let nextId = 1

  /**
   * The owner-only boundary, drawn here as well as by the registry.
   *
   * The registry already means no other role's shell mounts this surface, so this
   * is never reached in a walkthrough. It is here because the policies refuse
   * every verb on both tables for everybody else, and a mock that would have
   * answered is a mock the surface could be built wrongly against — the same
   * reason the alerts and insights mocks enforce the cross-outlet boundary they
   * will inherit from RLS.
   */
  function refuseUnlessOwner(): void {
    if (role !== 'super_admin') {
      throw new ManualLedgerActionError('not_permitted', 'Only an owner can use the manual ledger.')
    }
  }

  return {
    async getDay(outletId, businessDate) {
      refuseUnlessOwner()
      const row = store.manualLedgerDays.find(
        (day) => day.outlet_id === outletId && day.business_date === businessDate,
      )
      return row ? toDay(row) : null
    },

    async getPreviousDay(outletId, businessDate) {
      refuseUnlessOwner()
      // The most recent row before this date, not literally yesterday: a gap in
      // the notebook is normal and the chain runs between the rows that exist.
      const row = store.manualLedgerDays
        .filter((day) => day.outlet_id === outletId && day.business_date < businessDate)
        .sort((a, b) => b.business_date.localeCompare(a.business_date))[0]
      return row ? toDay(row) : null
    },

    async upsertDay(day: ManualLedgerDayInput) {
      refuseUnlessOwner()
      refuseImpossibleDay(day)

      const existing = store.manualLedgerDays.find(
        (row) => row.outlet_id === day.outletId && row.business_date === day.businessDate,
      )

      const written: Tables<'manual_ledger_days'> = {
        id: existing?.id ?? `dd000000-0000-4000-b000-${String(nextId++).padStart(12, '0')}`,
        outlet_id: day.outletId,
        business_date: day.businessDate,
        opening_cash_paise: day.openingCashPaise,
        cash_revenue_paise: day.cashRevenuePaise,
        upi_revenue_paise: day.upiRevenuePaise,
        zomato_revenue_paise: day.zomatoRevenuePaise,
        swiggy_revenue_paise: day.swiggyRevenuePaise,
        cash_added_paise: day.cashAddedPaise,
        cash_added_reason: trimmed(day.cashAddedReason),
        cash_removed_paise: day.cashRemovedPaise,
        cash_removed_reason: trimmed(day.cashRemovedReason),
        counted_cash_paise: day.countedCashPaise,
        zomato_commission_bp: day.zomatoCommissionBp,
        swiggy_commission_bp: day.swiggyCommissionBp,
        note: trimmed(day.note),
        // Frozen on a correction, as the guard freezes it: the other owner may fix
        // a figure without becoming the day's author.
        recorded_by: existing?.recorded_by ?? OWNER_ID,
        created_at: existing?.created_at ?? new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }

      if (existing) {
        store.manualLedgerDays[store.manualLedgerDays.indexOf(existing)] = written
      } else {
        store.manualLedgerDays.push(written)
      }
      return toDay(written)
    },

    async deleteDay(outletId, businessDate) {
      refuseUnlessOwner()
      const index = store.manualLedgerDays.findIndex(
        (day) => day.outlet_id === outletId && day.business_date === businessDate,
      )
      if (index >= 0) store.manualLedgerDays.splice(index, 1)
    },

    async listExpenses(outletId, businessDate) {
      refuseUnlessOwner()
      return store.manualLedgerExpenses
        .filter(
          (expense) => expense.outlet_id === outletId && expense.business_date === businessDate,
        )
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map(toExpense)
    },

    async createExpense(expense: NewManualLedgerExpense) {
      refuseUnlessOwner()
      refuseImpossibleExpense(expense)

      const created: Tables<'manual_ledger_expenses'> = {
        id: `de000000-0000-4000-b000-${String(nextId++).padStart(12, '0')}`,
        outlet_id: expense.outletId,
        business_date: expense.businessDate,
        category: captureMockCategory(store, expense.category),
        is_cash: expense.isCash,
        amount_paise: expense.amountPaise,
        description: trimmed(expense.note),
        recorded_by: OWNER_ID,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      store.manualLedgerExpenses.push(created)
      return toExpense(created)
    },

    async updateExpense(id, patch: ManualLedgerExpensePatch) {
      refuseUnlessOwner()
      const existing = store.manualLedgerExpenses.find((expense) => expense.id === id)
      if (!existing) {
        throw new ManualLedgerActionError('not_found', 'That expense is no longer there.')
      }

      const amountPaise = patch.amountPaise ?? existing.amount_paise
      const category = patch.category ?? existing.category
      refuseImpossibleExpense({ amountPaise, category })

      const updated: Tables<'manual_ledger_expenses'> = {
        ...existing,
        category: captureMockCategory(store, category),
        is_cash: patch.isCash ?? existing.is_cash,
        amount_paise: amountPaise,
        description: patch.note === undefined ? existing.description : trimmed(patch.note),
        updated_at: new Date().toISOString(),
      }

      store.manualLedgerExpenses[store.manualLedgerExpenses.indexOf(existing)] = updated
      return toExpense(updated)
    },

    async deleteExpense(id) {
      refuseUnlessOwner()
      const index = store.manualLedgerExpenses.findIndex((expense) => expense.id === id)
      if (index >= 0) store.manualLedgerExpenses.splice(index, 1)
    },

    async getMonth(outletId, month) {
      refuseUnlessOwner()
      const inMonth = (businessDate: string) => businessDate.startsWith(`${month}-`)

      return {
        days: store.manualLedgerDays
          .filter((day) => day.outlet_id === outletId && inMonth(day.business_date))
          .sort((a, b) => a.business_date.localeCompare(b.business_date))
          .map(toDay),
        expenses: store.manualLedgerExpenses
          .filter((expense) => expense.outlet_id === outletId && inMonth(expense.business_date))
          .sort((a, b) => a.business_date.localeCompare(b.business_date))
          .map(toExpense),
      }
    },
  }
}
