import type { SupabaseClient } from '@supabase/supabase-js'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import type { Database } from '@/data-access/database.types'
import { createSupabaseAttendanceAdapter } from '@/data-access/supabase-adapters/attendance'
import { createSupabaseExpensesAdapter } from '@/data-access/supabase-adapters/expenses'
import { describeChangeGate } from '@/test/change-gates'

import { onRoleIncludes } from '@/change-gates/role-includes'
import { resetBootSnapshotForTests, writeSavedAnswers } from '@/change-gates/snapshot'

/**
 * The `role-includes` toggle point (staff-roles-include-other-roles, design D7): each
 * staff check goes to its `_v2` with the gate on, to the original with it off,
 * and with the same arguments either way.
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

afterEach(() => {
  localStorage.clear()
  resetBootSnapshotForTests()
})

describeChangeGate('role-includes', (on) => {
  beforeEach(() => {
    writeSavedAnswers(localStorage, { 'role-includes': on })
    resetBootSnapshotForTests()
  })

  it(`reads the gate as ${on ? 'on' : 'off'}`, () => {
    expect(onRoleIncludes()).toBe(on)
  })

  it(`checks in through ${on ? 'attendance_submit_attempt_v2' : 'attendance_submit_attempt'}`, async () => {
    const { client, calls } = recordingClient()
    const adapter = createSupabaseAttendanceAdapter(client)
    await adapter
      .checkIn({
        personId: 'p',
        outletId: 'o',
        businessDate: '2026-10-21',
        reading: null,
        attemptId: 'a',
      })
      .catch(() => undefined)
    expect(calls[0]?.fn).toBe(on ? 'attendance_submit_attempt_v2' : 'attendance_submit_attempt')
    expect(calls[0]?.args).toMatchObject({ p_attempt_id: 'a', p_outlet_id: 'o' })
  })

  it(`names expense recorders through ${on ? 'expense_people_v2' : 'expense_people'}`, async () => {
    const { client, calls } = recordingClient()
    const adapter = createSupabaseExpensesAdapter(client)
    await adapter.listExpenses('o', '2026-10-21').catch(() => undefined)
    const people = calls.find((call) => call.fn.startsWith('expense_people'))
    expect(people?.fn).toBe(on ? 'expense_people_v2' : 'expense_people')
  })
})
