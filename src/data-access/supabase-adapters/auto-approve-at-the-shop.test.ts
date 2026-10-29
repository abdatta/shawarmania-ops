import type { SupabaseClient } from '@supabase/supabase-js'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { AttendanceActionError, DataActionError } from '@/data-access/adapters'
import type { Database } from '@/data-access/database.types'
import { createSupabaseAttendanceAdapter } from '@/data-access/supabase-adapters/attendance'
import { createSupabaseOutletsAdapter } from '@/data-access/supabase-adapters/outlets'
import { BLOCKED_AWAY_MESSAGE } from '@/features/attendance/at-the-shop'
import { describeChangeGate } from '@/test/change-gates'

import { onAutoApproveAtTheShop } from '@/change-gates/auto-approve-at-the-shop'
import { resetBootSnapshotForTests, writeSavedAnswers } from '@/change-gates/snapshot'

/**
 * The `auto-approve-at-the-shop` toggle point (a-check-in-at-the-shop-approves-
 * itself, design D3): a check-in goes to `attendance_submit_attempt_v3` with
 * the gate on and to today's command with it off, with the same arguments;
 * v3's refusal reads as `blocked_away`; and the outlet's rules are saved
 * through their own command.
 */
function recordingClient(answer: { data: unknown; error: unknown }) {
  const calls: { fn: string; args: unknown }[] = []
  const client = {
    auth: { getSession: async () => ({ data: { session: null } }) },
    rpc: vi.fn((fn: string, args?: unknown) => {
      calls.push({ fn, args })
      return Promise.resolve(answer)
    }),
  } as unknown as SupabaseClient<Database>
  return { client, calls }
}

const STOP = { data: null, error: { message: 'stop here', code: 'XX000' } }

function checkIn(client: SupabaseClient<Database>) {
  return createSupabaseAttendanceAdapter(client).checkIn({
    personId: 'p',
    outletId: 'o',
    businessDate: '2026-10-29',
    reading: null,
    attemptId: 'a',
  })
}

afterEach(() => {
  localStorage.clear()
  resetBootSnapshotForTests()
})

describeChangeGate('auto-approve-at-the-shop', (on) => {
  beforeEach(() => {
    writeSavedAnswers(localStorage, { 'auto-approve-at-the-shop': on })
    resetBootSnapshotForTests()
  })

  it(`reads the gate as ${on ? 'on' : 'off'}`, () => {
    expect(onAutoApproveAtTheShop()).toBe(on)
  })

  it(`checks in through ${on ? 'attendance_submit_attempt_v3' : 'today’s command'}`, async () => {
    const { client, calls } = recordingClient(STOP)
    await checkIn(client).catch(() => undefined)
    expect(calls[0]?.fn).toBe(on ? 'attendance_submit_attempt_v3' : 'attendance_submit_attempt')
    expect(calls[0]?.args).toMatchObject({ p_attempt_id: 'a', p_outlet_id: 'o' })
  })
})

it('reads the database’s refusal from away as blocked_away, in the card’s words', async () => {
  const { client } = recordingClient({
    data: null,
    error: { message: 'check-in away from the shop is blocked here', code: '23514' },
  })
  const error = await checkIn(client).catch((caught: unknown) => caught)
  expect(error).toBeInstanceOf(AttendanceActionError)
  expect(error).toMatchObject({ code: 'blocked_away', message: BLOCKED_AWAY_MESSAGE })
})

it('saves the outlet’s rules through set_outlet_attendance_rules, and nothing else', async () => {
  const row = { id: 'o', attendance_needs_manager: true, attendance_blocks_away: false }
  const { client, calls } = recordingClient({ data: row, error: null })
  const saved = await createSupabaseOutletsAdapter(client).updateAttendanceRules('o', {
    needsManager: true,
    blocksAway: false,
  })
  expect(calls).toEqual([
    {
      fn: 'set_outlet_attendance_rules',
      args: { p_outlet: 'o', p_needs_manager: true, p_blocks_away: false },
    },
  ])
  expect(saved).toMatchObject(row)
})

it('says who may change the rules when the database refuses', async () => {
  const { client } = recordingClient({
    data: null,
    error: { message: 'only the owner or this outlet’s manager…', code: '42501' },
  })
  const error = await createSupabaseOutletsAdapter(client)
    .updateAttendanceRules('o', { needsManager: false, blocksAway: true })
    .catch((caught: unknown) => caught)
  expect(error).toBeInstanceOf(DataActionError)
  expect(error).toMatchObject({ code: 'not_permitted' })
})
