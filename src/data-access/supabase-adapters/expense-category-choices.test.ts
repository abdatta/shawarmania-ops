import type { SupabaseClient } from '@supabase/supabase-js'
import { expect, it, vi } from 'vitest'

import { DataActionError } from '@/data-access/adapters'
import type { Database } from '@/data-access/database.types'
import { createSupabaseExpenseCategoriesAdapter } from '@/data-access/supabase-adapters/expense-categories'

/**
 * The owners' category list, live (a-check-in-at-the-shop-approves-itself,
 * design D11): read in the owners' order, written through its three commands,
 * and each refusal in the owner's words.
 */
function client(answer: { data: unknown; error: unknown }) {
  const calls: { fn: string; args: unknown }[] = []
  const order = vi.fn(() => Promise.resolve(answer))
  const select = vi.fn(() => ({ order }))
  const from = vi.fn(() => ({ select }))
  const rpc = vi.fn((fn: string, args?: unknown) => {
    calls.push({ fn, args })
    return Promise.resolve(answer)
  })
  return {
    adapter: createSupabaseExpenseCategoriesAdapter({
      from,
      rpc,
    } as unknown as SupabaseClient<Database>),
    from,
    select,
    order,
    calls,
  }
}

it('reads the list in the owners’ order', async () => {
  const { adapter, from, order } = client({
    data: [
      { id: '1', name: 'Chicken', asks_note: false, managers_only: false },
      { id: '7', name: 'Other', asks_note: true, managers_only: false },
    ],
    error: null,
  })
  await expect(adapter.choices()).resolves.toEqual([
    { id: '1', name: 'Chicken', asksNote: false, managersOnly: false },
    { id: '7', name: 'Other', asksNote: true, managersOnly: false },
  ])
  expect(from).toHaveBeenCalledWith('expense_category_choices')
  expect(order).toHaveBeenCalledWith('sort_order', { ascending: true })
})

it('adds with no id, and edits, moves and removes by id', async () => {
  const { adapter, calls } = client({ data: null, error: null })
  await adapter.saveChoice({ name: 'Packaging', asksNote: false, managersOnly: false })
  await adapter.saveChoice({ id: 'x', name: 'Groceries', asksNote: true, managersOnly: true })
  await adapter.moveChoice('x', 'up')
  await adapter.removeChoice('x')
  expect(calls).toEqual([
    {
      fn: 'save_expense_category_choice',
      args: { p_id: null, p_name: 'Packaging', p_asks_note: false, p_managers_only: false },
    },
    {
      fn: 'save_expense_category_choice',
      args: { p_id: 'x', p_name: 'Groceries', p_asks_note: true, p_managers_only: true },
    },
    { fn: 'move_expense_category_choice', args: { p_id: 'x', p_direction: 'up' } },
    { fn: 'remove_expense_category_choice', args: { p_id: 'x' } },
  ])
})

it.each([
  ['42501', 'not permitted', 'Only an owner can curate expense categories.'],
  ['23505', 'duplicate key', 'That category is already on the list.'],
  [
    '23514',
    'that category is reserved',
    'That name is kept for an automatic expense. Choose another.',
  ],
  ['P0002', 'that category is no longer on the list', 'That category is no longer on the list.'],
])('says %s in the owner’s words', async (code, message, said) => {
  const { adapter } = client({ data: null, error: { code, message } })
  const refusal = adapter.saveChoice({ name: 'X', asksNote: false, managersOnly: false })
  await expect(refusal).rejects.toBeInstanceOf(DataActionError)
  await expect(refusal).rejects.toThrow(said)
})
