import type { SupabaseClient } from '@supabase/supabase-js'
import { expect, it, vi } from 'vitest'

import type { Database } from '@/data-access/database.types'
import { createSupabaseExpensesAdapter } from '@/data-access/supabase-adapters/expenses'

/**
 * Each staff check goes to its `_v2`, which asks which roles include which
 * (staff-roles-include-other-roles, design D7), with the arguments the original
 * took. A check-in goes to `attendance_submit_attempt_v3`, which keeps that
 * rule (attendance-at-the-shop.test.ts).
 */
function recordingClient() {
  const calls: { fn: string; args: unknown }[] = []
  // A query builder that answers every chained call with itself and resolves
  // to no rows, so an adapter reading a table beside its RPC reaches the RPC.
  const builder: Record<string, unknown> = new Proxy(
    {},
    {
      get: (_target, prop) =>
        prop === 'then'
          ? (resolve: (value: unknown) => void) => resolve({ data: [], error: null })
          : () => builder,
    },
  )
  const client = {
    from: () => builder,
    rpc: vi.fn((fn: string, args?: unknown) => {
      calls.push({ fn, args })
      return Promise.resolve({ data: [], error: { message: 'stop here', code: 'XX000' } })
    }),
  } as unknown as SupabaseClient<Database>
  return { client, calls }
}

it('names expense recorders through expense_people_v2', async () => {
  const { client, calls } = recordingClient()
  const adapter = createSupabaseExpensesAdapter(client)
  await adapter.listExpenses('o', '2026-10-21').catch(() => undefined)
  const people = calls.find((call) => call.fn.startsWith('expense_people'))
  expect(people?.fn).toBe('expense_people_v2')
})
