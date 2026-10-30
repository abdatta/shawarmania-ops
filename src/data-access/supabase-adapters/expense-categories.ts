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

/** The list's refusals, in the words the owner's page shows. */
function choiceError(error: PostgrestError): DataActionError {
  if (error.code === '23505') {
    return new DataActionError('already_exists', 'That category is already on the list.')
  }
  if (error.code === '23514' && /reserved/.test(error.message)) {
    return new DataActionError(
      'bad_category',
      'That name is kept for an automatic expense. Choose another.',
    )
  }
  if (error.code === 'P0002') {
    return new DataActionError('not_found', 'That category is no longer on the list.')
  }
  return categoryError(error)
}

export function createSupabaseExpenseCategoriesAdapter(
  client: SupabaseClient<Database>,
): ExpenseCategoriesAdapter {
  return {
    async names() {
      const { data, error } = await client
        .from('expense_categories')
        .select('name')
        .order('name', { ascending: true })
      if (error) throw categoryError(error)
      return (data ?? []).map((row) => row.name)
    },

    async list() {
      const { data, error } = await client
        .from('expense_categories')
        .select('*')
        .order('name', { ascending: true })
      if (error) throw categoryError(error)

      return Promise.all(
        (data ?? []).map(async (row): Promise<ExpenseCategorySuggestion> => {
          const expenses = await client
            .from('expenses')
            .select('*', { count: 'exact', head: true })
            .eq('category', row.name)
          if (expenses.error) throw categoryError(expenses.error)
          return {
            id: row.id,
            name: row.name,
            ledgerUsageCount: 0,
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

    // The owners' list (#81, design D11): read by every active account, written
    // only by an owner through its three commands.
    async choices() {
      const { data, error } = await client
        .from('expense_category_choices')
        .select('id, name, asks_note, managers_only')
        .order('sort_order', { ascending: true })
      if (error) throw categoryError(error)
      return (data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        asksNote: row.asks_note,
        managersOnly: row.managers_only,
      }))
    },

    async saveChoice(input) {
      const { error } = await client.rpc('save_expense_category_choice', {
        // A null id adds a choice; the generated type cannot say so.
        p_id: (input.id ?? null) as string,
        p_name: input.name,
        p_asks_note: input.asksNote,
        p_managers_only: input.managersOnly,
      })
      if (error) throw choiceError(error)
    },

    async moveChoice(id, direction) {
      const { error } = await client.rpc('move_expense_category_choice', {
        p_id: id,
        p_direction: direction,
      })
      if (error) throw choiceError(error)
    },

    async removeChoice(id) {
      const { error } = await client.rpc('remove_expense_category_choice', { p_id: id })
      if (error) throw choiceError(error)
    },
  }
}
