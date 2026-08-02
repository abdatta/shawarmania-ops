import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '../../../src/data-access/database.types'
import { resolveBusinessDate } from '../../../src/domain/datetime'

const SUPABASE_URL = process.env['SUPABASE_URL'] ?? 'http://127.0.0.1:54321'
const SUPABASE_ANON_KEY =
  process.env['SUPABASE_ANON_KEY'] ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYXNlLWRlbW8iLCJyb2xlIjoiYW5vbiIsImV4cCI6MTk4MzgxMjk5Nn0.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const PASSWORD = 'shawarmania-local'

const KALYANI = '00000000-0000-4000-a000-000000000001'
const KANCHRAPARA = '00000000-0000-4000-a000-000000000002'
const TWO_OUTLETS = '10000000-0000-4000-a000-00000000000e'
const STAFF_KANCHRAPARA = '10000000-0000-4000-a000-000000000007'

type Client = SupabaseClient<Database>

async function signIn(email: string): Promise<Client> {
  const client = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD })
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`)
  return client
}

async function currentDay(client: Client, personId: string, businessDate: string) {
  return client
    .from('attendance')
    .select('id, status, state_version, current_attempt_id')
    .eq('person_id', personId)
    .eq('business_date', businessDate)
    .maybeSingle()
}

let twoOutletEmployee: Client
let kanchraparaEmployee: Client
let kalyaniManager: Client
let kanchraparaManager: Client

beforeAll(async () => {
  ;[twoOutletEmployee, kanchraparaEmployee, kalyaniManager, kanchraparaManager] = await Promise.all(
    [
      signIn('two.outlets@login.shawarmania.invalid'),
      signIn('staff.kanchrapara@login.shawarmania.invalid'),
      signIn('admin.kalyani@login.shawarmania.invalid'),
      signIn('admin.kanchrapara@login.shawarmania.invalid'),
    ],
  )
}, 30_000)

describe('attendance command races', () => {
  it('serializes approval versus denial into one complete decision', async () => {
    const businessDate = resolveBusinessDate(new Date(), '04:00')
    const existing = await currentDay(twoOutletEmployee, TWO_OUTLETS, businessDate)
    if (existing.data) return // Supports an intentional re-run without rewriting history.

    const attemptId = 'f1000000-0000-4000-a000-000000000001'
    const submitted = await twoOutletEmployee.rpc('attendance_submit_attempt', {
      p_attempt_id: attemptId,
      p_outlet_id: KALYANI,
      p_business_date: businessDate,
      p_attempted_at: new Date().toISOString(),
      p_lat: 22.984,
      p_lng: 88.4345,
      p_accuracy_m: 25,
    })
    expect(submitted.error).toBeNull()
    if (!submitted.data) throw new Error('attempt command returned no attendance day')
    const row = submitted.data

    const [approval, denial] = await Promise.all([
      kalyaniManager.rpc('attendance_approve_attempt', {
        p_attendance_id: row.id,
        p_decision_id: 'f2000000-0000-4000-a000-000000000001',
        p_expected_attempt_id: attemptId,
        p_expected_version: row.state_version,
        p_manager_lat: 22.97505,
        p_manager_lng: 88.4346,
        p_manager_accuracy_m: 12,
        p_reason: 'Concurrent approval probe',
      }),
      kalyaniManager.rpc('attendance_deny_attempt', {
        p_attendance_id: row.id,
        p_decision_id: 'f2000000-0000-4000-a000-000000000002',
        p_expected_attempt_id: attemptId,
        p_expected_version: row.state_version,
        p_reason: 'Concurrent denial probe',
        p_prevent_retry: false,
      }),
    ])

    expect([approval, denial].filter((result) => result.error === null)).toHaveLength(1)
    expect([approval, denial].filter((result) => result.error !== null)).toHaveLength(1)

    const finalDay = await currentDay(twoOutletEmployee, TWO_OUTLETS, businessDate)
    expect(finalDay.data?.current_attempt_id).toBeNull()
    const history = await twoOutletEmployee
      .from('attendance_decisions')
      .select('id, kind')
      .eq('attendance_id', row.id)
    expect(history.data).toHaveLength(1)
  })

  it('serializes retry versus denial into one current-attempt answer', async () => {
    const businessDate = resolveBusinessDate(new Date(), '04:00')
    const existing = await currentDay(kanchraparaEmployee, STAFF_KANCHRAPARA, businessDate)
    if (existing.data) return // Supports an intentional re-run without rewriting history.

    const firstAttemptId = 'f1000000-0000-4000-a000-000000000011'
    const retryAttemptId = 'f1000000-0000-4000-a000-000000000012'
    const submitted = await kanchraparaEmployee.rpc('attendance_submit_attempt', {
      p_attempt_id: firstAttemptId,
      p_outlet_id: KANCHRAPARA,
      p_business_date: businessDate,
      p_attempted_at: new Date().toISOString(),
      p_lat: 22.955,
      p_lng: 88.443,
      p_accuracy_m: 30,
    })
    expect(submitted.error).toBeNull()
    if (!submitted.data) throw new Error('attempt command returned no attendance day')
    const row = submitted.data

    const [retry, denial] = await Promise.all([
      kanchraparaEmployee.rpc('attendance_submit_attempt', {
        p_attempt_id: retryAttemptId,
        p_outlet_id: KANCHRAPARA,
        p_business_date: businessDate,
        p_attempted_at: new Date().toISOString(),
        p_lat: 22.956,
        p_lng: 88.444,
        p_accuracy_m: 35,
        p_expected_version: row.state_version,
      }),
      kanchraparaManager.rpc('attendance_deny_attempt', {
        p_attendance_id: row.id,
        p_decision_id: 'f2000000-0000-4000-a000-000000000011',
        p_expected_attempt_id: firstAttemptId,
        p_expected_version: row.state_version,
        p_reason: 'Concurrent retry decision probe',
        p_prevent_retry: false,
      }),
    ])

    expect([retry, denial].filter((result) => result.error === null)).toHaveLength(1)
    const finalDay = await currentDay(kanchraparaEmployee, STAFF_KANCHRAPARA, businessDate)
    const attempts = await kanchraparaEmployee
      .from('attendance_attempts')
      .select('id')
      .eq('attendance_id', row.id)
    const decisions = await kanchraparaEmployee
      .from('attendance_decisions')
      .select('id')
      .eq('attendance_id', row.id)

    if (retry.error === null) {
      expect(finalDay.data?.current_attempt_id).toBe(retryAttemptId)
      expect(attempts.data).toHaveLength(2)
      expect(decisions.data).toHaveLength(0)
    } else {
      expect(finalDay.data?.current_attempt_id).toBeNull()
      expect(attempts.data).toHaveLength(1)
      expect(decisions.data).toHaveLength(1)
    }
  })
})
