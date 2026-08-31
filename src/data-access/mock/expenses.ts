import {
  ExpenseActionError,
  isStaffRole,
  type AppRole,
  type ExpenseActor,
  type ExpensePatch,
  type ExpenseRecord,
  type ExpensesAdapter,
  type NewExpense,
} from '../adapters'
import type { Tables } from '../database.types'
import { personaFixtures } from './fixtures/personas'
import type { DemoStore } from './store'
import { captureMockCategory } from './expense-categories'

const PEOPLE: ReadonlyMap<string, string | null> = new Map(
  Object.values(personaFixtures).map((persona) => [persona.profile.id, persona.profile.full_name]),
)

function actor(id: string | null): ExpenseActor | null {
  return id ? { id, name: PEOPLE.get(id) ?? null } : null
}

function toRecord(row: Tables<'expenses'>): ExpenseRecord {
  return {
    id: row.id,
    outletId: row.outlet_id,
    businessDate: row.business_date,
    category: row.category,
    isCash: row.is_cash,
    amountPaise: row.amount_paise,
    note: row.description,
    occurredAt: row.occurred_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    recordedBy: actor(row.recorded_by),
    source:
      row.source_system === null || row.source_ref === null
        ? null
        : { system: row.source_system, ref: row.source_ref },
    updatedBy: actor(row.updated_by),
    recordedAway: row.recorded_away,
    voidedAt: row.voided_at,
    voidedBy: actor(row.voided_by),
    voidedReason: row.voided_reason,
  }
}

function trimmed(value: string | null | undefined): string | null {
  const text = value?.trim()
  return text ? text : null
}

function validate(expense: { amountPaise: number; category: string }): void {
  if (!Number.isInteger(expense.amountPaise) || expense.amountPaise <= 0) {
    throw new ExpenseActionError(
      'bad_amount',
      'An expense needs an amount above zero, as a number of rupees.',
    )
  }
  if (!expense.category.trim()) {
    throw new ExpenseActionError('category_required', 'Choose or type what the money was spent on.')
  }
}

export function createMockExpensesAdapter(
  store: DemoStore,
  role: AppRole,
  userId: string,
  assignedOutletIds: readonly string[],
): ExpensesAdapter {
  let nextId = 1
  const isOwner = role === 'super_admin'
  const isManager = role === 'franchise_admin'
  const isStaff = isStaffRole(role)
  const assignedAt = (outletId: string) => assignedOutletIds.includes(outletId)

  function refuseAccess(outletId: string): void {
    if (isOwner || ((isManager || isStaff) && assignedAt(outletId))) return
    throw new ExpenseActionError('not_permitted', 'That outlet’s expenses are not yours to read.')
  }

  function refuseStaffWrite(row: { businessDate: string; recordedBy?: string | undefined }): void {
    if (!isStaff) return
    if (row.businessDate !== store.businessDate(0)) {
      throw new ExpenseActionError(
        'refused',
        'That day has closed. A manager or the owner can still change it.',
      )
    }
    if (row.recordedBy !== undefined && row.recordedBy !== userId) {
      throw new ExpenseActionError('not_permitted', 'That one is somebody else’s to correct.')
    }
  }

  function find(id: string): Tables<'expenses'> {
    const row = store.expenses.find((expense) => expense.id === id)
    if (!row) throw new ExpenseActionError('not_found', 'That expense is no longer there.')
    return row
  }

  function refuseVoided(row: Tables<'expenses'>): void {
    if (row.voided_at !== null) {
      throw new ExpenseActionError(
        'refused',
        'That one was withdrawn. Record a new expense instead of changing it.',
      )
    }
  }

  return {
    async listExpenses(outletId, businessDate) {
      refuseAccess(outletId)
      return store.expenses
        .filter((row) => row.outlet_id === outletId && row.business_date === businessDate)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map(toRecord)
    },

    async listRecentExpenses(outletId, businessDates) {
      refuseAccess(outletId)
      return store.expenses
        .filter((row) => row.outlet_id === outletId && businessDates.includes(row.business_date))
        .sort(
          (a, b) =>
            b.business_date.localeCompare(a.business_date) ||
            b.created_at.localeCompare(a.created_at),
        )
        .map(toRecord)
    },

    async createExpense(expense: NewExpense) {
      refuseAccess(expense.outletId)
      refuseStaffWrite({ businessDate: expense.businessDate })
      validate(expense)
      const now = new Date().toISOString()
      const row: Tables<'expenses'> = {
        id: `de000000-0000-4000-b000-${String(nextId++).padStart(12, '0')}`,
        outlet_id: expense.outletId,
        business_date: expense.businessDate,
        category: captureMockCategory(store, expense.category),
        is_cash: expense.isCash,
        amount_paise: expense.amountPaise,
        description: trimmed(expense.note),
        occurred_at: null,
        recorded_by: userId,
        source_system: null,
        source_ref: null,
        shared_cost: false,
        recorded_away: !assignedAt(expense.outletId),
        created_at: now,
        updated_at: now,
        updated_by: null,
        voided_at: null,
        voided_by: null,
        voided_reason: null,
      }
      store.expenses.push(row)
      return toRecord(row)
    },

    async updateExpense(id, patch: ExpensePatch) {
      const existing = find(id)
      refuseAccess(existing.outlet_id)
      refuseVoided(existing)
      refuseStaffWrite({
        businessDate: existing.business_date,
        recordedBy: existing.recorded_by ?? undefined,
      })
      const amountPaise = patch.amountPaise ?? existing.amount_paise
      const category = patch.category ?? existing.category
      validate({ amountPaise, category })
      const row: Tables<'expenses'> = {
        ...existing,
        category: captureMockCategory(store, category),
        is_cash: patch.isCash ?? existing.is_cash,
        amount_paise: amountPaise,
        description: patch.note === undefined ? existing.description : trimmed(patch.note),
        updated_at: new Date().toISOString(),
        updated_by: userId,
      }
      store.expenses[store.expenses.indexOf(existing)] = row
      return toRecord(row)
    },

    async voidExpense(id, reason) {
      const existing = find(id)
      refuseAccess(existing.outlet_id)
      refuseVoided(existing)
      refuseStaffWrite({
        businessDate: existing.business_date,
        recordedBy: existing.recorded_by ?? undefined,
      })
      const now = new Date().toISOString()
      const row: Tables<'expenses'> = {
        ...existing,
        voided_at: now,
        voided_by: userId,
        voided_reason: trimmed(reason),
        updated_at: now,
        updated_by: userId,
      }
      store.expenses[store.expenses.indexOf(existing)] = row
      return toRecord(row)
    },
  }
}
