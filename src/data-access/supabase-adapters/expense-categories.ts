import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'

import {
  DataActionError,
  type ExpenseCategoriesAdapter,
  type ExpenseCategoryMoveResult,
  type ExpenseCategoryOperation,
  type ExpenseCategorySuggestion,
} from '../adapters'
import type { Database, Tables } from '../database.types'

function toOperation(row: Tables<'expense_category_operations'>): ExpenseCategoryOperation {
  return {
    id: row.id,
    operation: row.operation as 'rename' | 'merge',
    nameBefore: row.name_before,
    nameAfter: row.name_after,
    ledgerRowsMoved: row.ledger_rows_moved,
    expenseRowsMoved: row.expense_rows_moved,
    performedBy: row.performed_by,
    performedAt: row.performed_at,
  }
}

function toMoveResult(
  row: { ledger_rows_moved: number; expense_rows_moved: number } | undefined,
): ExpenseCategoryMoveResult {
  if (!row) throw new DataActionError('failed', 'The category changed, but its row count was lost.')
  return {
    ledgerRowsMoved: row.ledger_rows_moved,
    expenseRowsMoved: row.expense_rows_moved,
  }
}

function categoryError(error: PostgrestError): DataActionError {
  if (error.code === '42501') {
    return new DataActionError('not_permitted', 'Only an owner can curate expense categories.')
  }
  if (error.code === '23505') {
    return new DataActionError(
      'already_exists',
      'That category already exists. Merge into it instead.',
    )
  }
  if (error.code === '23514') {
    return new DataActionError('bad_category', 'A category needs a word, with no extra spacing.')
  }
  return new DataActionError(
    'failed',
    'That category change did not finish. Try again in a moment.',
  )
}

export function createSupabaseExpenseCategoriesAdapter(
  client: SupabaseClient<Database>,
): ExpenseCategoriesAdapter {
  return {
    async list() {
      const { data, error } = await client
        .from('expense_categories')
        .select('*')
        .order('name', { ascending: true })
      if (error) throw categoryError(error)

      return Promise.all(
        (data ?? []).map(async (row): Promise<ExpenseCategorySuggestion> => {
          const [ledger, expenses] = await Promise.all([
            client
              .from('manual_ledger_expenses')
              .select('*', { count: 'exact', head: true })
              .eq('category', row.name),
            client
              .from('expenses')
              .select('*', { count: 'exact', head: true })
              .eq('category', row.name),
          ])
          if (ledger.error) throw categoryError(ledger.error)
          if (expenses.error) throw categoryError(expenses.error)
          return {
            id: row.id,
            name: row.name,
            ledgerUsageCount: ledger.count ?? 0,
            expenseUsageCount: expenses.count ?? 0,
            createdAt: row.created_at,
          }
        }),
      )
    },

    async rename(from, to, rewriteHistory) {
      const { data, error } = await client.rpc('rename_expense_category', {
        p_from: from,
        p_to: to,
        p_rewrite_history: rewriteHistory,
      })
      if (error) throw categoryError(error)
      return toMoveResult(data?.[0])
    },

    async merge(from, into) {
      const { data, error } = await client.rpc('merge_expense_category', {
        p_from: from,
        p_into: into,
      })
      if (error) throw categoryError(error)
      return toMoveResult(data?.[0])
    },

    async retire(name) {
      const { error } = await client.rpc('retire_expense_category', { p_name: name })
      if (error) throw categoryError(error)
    },

    async listOperations() {
      const { data, error } = await client
        .from('expense_category_operations')
        .select('*')
        .order('performed_at', { ascending: false })
      if (error) throw categoryError(error)
      return (data ?? []).map(toOperation)
    },
  }
}
