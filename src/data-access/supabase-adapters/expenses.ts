import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'

import {
  ExpenseActionError,
  type ExpenseActor,
  type ExpensePatch,
  type ExpenseRecord,
  type ExpensesAdapter,
  type NewExpense,
} from '../adapters'
import type { Database, Tables } from '../database.types'

const ALL = '*'
type People = ReadonlyMap<string, string | null>

async function readPeople(client: SupabaseClient<Database>): Promise<People> {
  const { data, error } = await client.rpc('expense_people')
  if (error) throw toExpenseError(error)
  return new Map((data ?? []).map((row) => [row.id, row.full_name]))
}

function actor(id: string | null, people: People): ExpenseActor | null {
  return id ? { id, name: people.get(id) ?? null } : null
}

function toRecord(row: Tables<'expenses'>, people: People): ExpenseRecord {
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
    recordedBy: actor(row.recorded_by, people),
    source:
      row.source_system === null || row.source_ref === null
        ? null
        : { system: row.source_system, ref: row.source_ref },
    updatedBy: actor(row.updated_by, people),
    recordedAway: row.recorded_away,
    voidedAt: row.voided_at,
    voidedBy: actor(row.voided_by, people),
    voidedReason: row.voided_reason,
  }
}

function trimmed(value: string | null | undefined): string | null {
  const text = value?.trim()
  return text ? text : null
}

export function createSupabaseExpensesAdapter(client: SupabaseClient<Database>): ExpensesAdapter {
  return {
    async listExpenses(outletId, businessDate) {
      const [{ data, error }, people] = await Promise.all([
        client
          .from('expenses')
          .select(ALL)
          .eq('outlet_id', outletId)
          .eq('business_date', businessDate)
          .order('created_at', { ascending: false }),
        readPeople(client),
      ])
      if (error) throw toExpenseError(error)
      return (data ?? []).map((row) => toRecord(row, people))
    },

    async listRecentExpenses(outletId, businessDates) {
      const [{ data, error }, people] = await Promise.all([
        client
          .from('expenses')
          .select(ALL)
          .eq('outlet_id', outletId)
          .in('business_date', [...businessDates])
          .order('business_date', { ascending: false })
          .order('created_at', { ascending: false }),
        readPeople(client),
      ])
      if (error) throw toExpenseError(error)
      return (data ?? []).map((row) => toRecord(row, people))
    },

    async createExpense(expense: NewExpense) {
      const { data, error } = await client
        .from('expenses')
        .insert({
          outlet_id: expense.outletId,
          business_date: expense.businessDate,
          category: expense.category,
          is_cash: expense.isCash,
          amount_paise: expense.amountPaise,
          description: trimmed(expense.note),
        })
        .select(ALL)
        .single()
      if (error) throw toExpenseError(error)
      return toRecord(data, await readPeople(client))
    },

    async updateExpense(id, patch: ExpensePatch) {
      const { data, error } = await client
        .from('expenses')
        .update({
          ...(patch.category === undefined ? {} : { category: patch.category }),
          ...(patch.isCash === undefined ? {} : { is_cash: patch.isCash }),
          ...(patch.amountPaise === undefined ? {} : { amount_paise: patch.amountPaise }),
          ...(patch.note === undefined ? {} : { description: trimmed(patch.note) }),
        })
        .eq('id', id)
        .select(ALL)
        .single()
      if (error) throw toExpenseError(error)
      return toRecord(data, await readPeople(client))
    },

    async voidExpense(id, reason) {
      const { data, error } = await client
        .from('expenses')
        .update({ voided_at: new Date().toISOString(), voided_reason: trimmed(reason) })
        .eq('id', id)
        .select(ALL)
        .single()
      if (error) throw toExpenseError(error)
      return toRecord(data, await readPeople(client))
    },
  }
}

function toExpenseError(error: PostgrestError): ExpenseActionError {
  switch (error.code) {
    case '23514':
      return new ExpenseActionError(
        'impossible_figure',
        'An expense needs an amount above zero and a valid source or recording account.',
      )
    case '23502':
      return new ExpenseActionError('missing_field', 'An expense needs a category.')
    case '42501':
      return new ExpenseActionError('not_permitted', 'That expense is not yours to change here.')
    case 'P0001':
      return new ExpenseActionError(
        'refused',
        'That entry cannot be changed here. An older entry belongs to the manager or owner.',
      )
    default:
      return new ExpenseActionError('failed', 'That did not save. Try again in a moment.')
  }
}
