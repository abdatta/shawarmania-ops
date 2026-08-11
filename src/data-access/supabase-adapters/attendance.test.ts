import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'

import { AttendanceActionError } from '../adapters'
import type { Database } from '../database.types'
import { createSupabaseAttendanceAdapter } from './attendance'

/**
 * The real adapter against a stubbed client, testing the seam and nothing else:
 * what leaves for the database, and what a refusal becomes on the way back.
 *
 * The reason this file exists is a bug that shipped. `p_lat: reading?.latitude as
 * number` produces `undefined` when there is no reading, JSON serialisation drops
 * the key, and the command functions declare no default for it — so PostgREST
 * could not find the function at all, and every unlocated check-in failed with
 * "try again in a moment" while writing nothing. Nothing caught it: the component
 * suites drive the mock adapter, which takes a null reading happily, and the
 * REST suite always passed coordinates. A payload assertion is the cheapest place
 * that cannot be fooled.
 *
 * What the database then does with these commands is proved where it lives —
 * pgTAP and the REST suite. This file cannot prove a policy and does not pretend
 * to.
 */

/** Enough of a joined row for `toRecord`, with a waiting attempt to approve. */
const ROW = {
  id: 'a-1',
  outlet_id: 'o-1',
  person_id: 'p-1',
  business_date: '2026-08-04',
  status: 'absent',
  state_version: 1,
  current_attempt_id: 'at-1',
  outcome_attempt_id: null,
  latest_decision_id: null,
  retry_blocked: false,
  arrival_deadline: '13:00:00',
  check_in_at: '2026-08-04T07:00:00.000Z',
  check_in_lat: null,
  check_in_lng: null,
  check_in_accuracy_m: null,
  check_in_distance_m: null,
  check_in_source: 'phone',
  check_in_entered_by: null,
  check_in_entered_by_name: null,
  approved_by: null,
  approved_by_name: null,
  approval_reason: null,
  approved_at: null,
  approver_lat: null,
  approver_lng: null,
  approver_accuracy_m: null,
  approver_distance_m: null,
  profiles: { full_name: 'Somebody' },
  outlets: { name: 'Kalyani' },
  attendance_attempts: [],
  attendance_decisions: [],
}

/**
 * A PostgREST query builder that answers the same row however it is filtered.
 * `then` is what lets a builder be awaited directly, which `readMany` does.
 */
function query(data: unknown) {
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    in: () => builder,
    gte: () => builder,
    lte: () => builder,
    order: () => builder,
    single: () => Promise.resolve({ data, error: null }),
    maybeSingle: () => Promise.resolve({ data, error: null }),
    then: (resolve: (value: unknown) => unknown) => resolve({ data: [data], error: null }),
  }
  return builder
}

function adapterWith(rpc: ReturnType<typeof vi.fn>) {
  const client = { rpc, from: () => query(ROW) } as unknown as SupabaseClient<Database>
  return createSupabaseAttendanceAdapter(client)
}

const succeeds = () => vi.fn().mockResolvedValue({ data: { id: 'a-1' }, error: null })
const fails = (code: string) =>
  vi.fn().mockResolvedValue({ data: null, error: { code, message: 'refused' } })

const READING = {
  latitude: 22.9752,
  longitude: 88.4358,
  accuracyMetres: 18,
  at: '2026-08-04T07:00:00.000Z',
}

describe('submitting a check-in', () => {
  it('states the position it has', async () => {
    const rpc = succeeds()
    await adapterWith(rpc).checkIn({
      personId: 'p-1',
      outletId: 'o-1',
      businessDate: '2026-08-04',
      reading: READING,
      attemptId: 'at-9',
    })

    expect(rpc).toHaveBeenCalledWith(
      'attendance_submit_attempt',
      expect.objectContaining({ p_lat: 22.9752, p_lng: 88.4358, p_accuracy_m: 18 }),
    )
  })

  it('states the position it does not have, rather than omitting it', async () => {
    const rpc = succeeds()
    await adapterWith(rpc).checkIn({
      personId: 'p-1',
      outletId: 'o-1',
      businessDate: '2026-08-04',
      reading: null,
      attemptId: 'at-9',
    })

    const [, args] = rpc.mock.calls[0] as [string, Record<string, unknown>]
    // Explicitly null, and — the part that matters — present. An absent key is
    // dropped by JSON serialisation, and the function has no default to fall
    // back on, so the request would name a function that does not exist.
    expect(args).toMatchObject({ p_lat: null, p_lng: null, p_accuracy_m: null })
    expect(Object.keys(args)).toEqual(expect.arrayContaining(['p_lat', 'p_lng', 'p_accuracy_m']))
    expect(JSON.parse(JSON.stringify(args))).toMatchObject({
      p_lat: null,
      p_lng: null,
      p_accuracy_m: null,
    })
  })
})

describe('approving a day', () => {
  it('states the approver’s missing position, rather than omitting it', async () => {
    const rpc = succeeds()
    await adapterWith(rpc).approve(['a-1'], {
      reason: null,
      reading: null,
      approverId: 'm-1',
    })

    const [, args] = rpc.mock.calls[0] as [string, Record<string, unknown>]
    expect(args).toMatchObject({
      p_reason: null,
      p_manager_lat: null,
      p_manager_lng: null,
      p_manager_accuracy_m: null,
    })
    expect(JSON.parse(JSON.stringify(args))).toMatchObject({
      p_reason: null,
      p_manager_lat: null,
      p_manager_lng: null,
      p_manager_accuracy_m: null,
    })
  })
})

describe('a refusal on the way back', () => {
  it('reports a command the backend cannot accept, and does not offer a retry', async () => {
    // PostgREST's answer when no function matches the arguments sent.
    const refused = adapterWith(fails('PGRST202')).checkIn({
      personId: 'p-1',
      outletId: 'o-1',
      businessDate: '2026-08-04',
      reading: null,
    })

    await expect(refused).rejects.toBeInstanceOf(AttendanceActionError)
    await expect(refused).rejects.toMatchObject({ code: 'unsendable' })
    await expect(refused).rejects.toThrow(/could not send/)
    await expect(refused).rejects.not.toThrow(/[Tt]ry again/)
  })

  it('reports Postgres saying the same thing under its own code', async () => {
    await expect(
      adapterWith(fails('42883')).approve(['a-1'], {
        reason: 'probe',
        reading: null,
        approverId: 'm-1',
      }),
    ).rejects.toMatchObject({ code: 'unsendable' })
  })

  it('leaves every other refusal exactly as it was', async () => {
    await expect(
      adapterWith(fails('42501')).checkIn({
        personId: 'p-1',
        outletId: 'o-1',
        businessDate: '2026-08-04',
        reading: READING,
      }),
    ).rejects.toMatchObject({ code: 'not_permitted' })

    const unclassified = adapterWith(fails('XX000')).checkIn({
      personId: 'p-1',
      outletId: 'o-1',
      businessDate: '2026-08-04',
      reading: READING,
    })
    await expect(unclassified).rejects.toMatchObject({ code: 'failed' })
    await expect(unclassified).rejects.toThrow(/Try again in a moment/)
  })
})
