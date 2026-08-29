/**
 * The unresolved heartbeat through real GoTrue and PostgREST sessions.
 * Positive calls mutate only counter telemetry and restore the exact seed in
 * `afterAll`, so later database suites do not inherit a fabricated heartbeat.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '../../../src/data-access/database.types'

const SUPABASE_URL = process.env['SUPABASE_URL'] ?? 'http://127.0.0.1:54321'
const SUPABASE_ANON_KEY =
  process.env['SUPABASE_ANON_KEY'] ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const PASSWORD = 'shawarmania-local'
const KAL = '00000000-0000-4000-a000-000000000001'
const DEVICE_KAL = '10000000-0000-4000-a000-000000000004'
const DEVICE_KPA = '10000000-0000-4000-a000-000000000005'

type Client = SupabaseClient<Database>
type DeviceTelemetry = Pick<
  Database['public']['Tables']['counter_devices']['Row'],
  'id' | 'last_seen_at' | 'last_reported_unsent' | 'last_reported_oldest_unresolved_at'
>

function client(key = SUPABASE_ANON_KEY): Client {
  return createClient<Database>(SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

async function signIn(alias: string): Promise<Client> {
  const opened = client()
  const { error } = await opened.auth.signInWithPassword({
    email: `${alias}@login.shawarmania.invalid`,
    password: PASSWORD,
  })
  if (error) throw new Error(`could not sign in ${alias}: ${error.message}`)
  return opened
}

let baseline: DeviceTelemetry[] = []

beforeAll(async () => {
  const serviceKey = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for telemetry cleanup')
  const { data, error } = await client(serviceKey)
    .from('counter_devices')
    .select('id, last_seen_at, last_reported_unsent, last_reported_oldest_unresolved_at')
    .in('id', [DEVICE_KAL, DEVICE_KPA])
  if (error) throw error
  baseline = data
})

afterAll(async () => {
  const serviceKey = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!serviceKey) return
  const service = client(serviceKey)
  for (const row of baseline) {
    const { error } = await service
      .from('counter_devices')
      .update({
        last_seen_at: row.last_seen_at,
        last_reported_unsent: row.last_reported_unsent,
        last_reported_oldest_unresolved_at: row.last_reported_oldest_unresolved_at,
      })
      .eq('id', row.id)
    if (error) throw error
  }
})

describe('counter unresolved telemetry over REST', () => {
  it('lets each live tablet write only its own rich summary and clear it', async () => {
    const tabletKal = await signIn('tablet.kalyani')
    const oldest = '2026-08-29T01:23:00.000Z'
    await expect(
      tabletKal.rpc('report_counter_device_state', {
        p_unresolved: 2,
        p_oldest_unresolved_at: oldest,
      }),
    ).resolves.toMatchObject({ data: 'ok', error: null })

    const tabletKpa = await signIn('tablet.kanchrapara')
    await expect(
      tabletKpa.rpc('report_counter_device_state', {
        p_unresolved: 1,
        p_oldest_unresolved_at: '2026-08-29T02:00:00.000Z',
      }),
    ).resolves.toMatchObject({ data: 'ok', error: null })

    const owner = await signIn('owner')
    const { data } = await owner.rpc('counter_operations_snapshot_v2', {
      p_outlet_ids: [KAL],
    })
    expect(data?.[0]).toMatchObject({
      device_id: DEVICE_KAL,
      last_reported_unsent: 2,
    })
    expect(Date.parse(data?.[0]?.last_reported_oldest_unresolved_at ?? '')).toBe(Date.parse(oldest))

    await expect(
      tabletKal.rpc('report_counter_device_state', {
        p_unsent: 0,
      }),
    ).resolves.toMatchObject({ data: 'ok', error: null })
  })

  it('keeps the legacy signature callable and marks a positive oldest as unknown', async () => {
    const tablet = await signIn('tablet.kalyani')
    await expect(tablet.rpc('report_counter_device_state', { p_unsent: 3 })).resolves.toMatchObject(
      { data: 'ok', error: null },
    )

    const owner = await signIn('owner')
    const { data } = await owner.rpc('counter_operations_snapshot_v2', {
      p_outlet_ids: [KAL],
    })
    expect(data?.[0]).toMatchObject({
      last_reported_unsent: 3,
      last_reported_oldest_unresolved_at: null,
    })
  })

  it('refuses human, removed-tablet, and anonymous callers', async () => {
    for (const alias of ['owner', 'revoked.tablet.kalyani']) {
      const caller = await signIn(alias)
      const result = await caller.rpc('report_counter_device_state', {
        p_unresolved: 9,
        p_oldest_unresolved_at: '2026-08-29T03:00:00.000Z',
      })
      expect(result).toMatchObject({ data: 'invalid', error: null })
    }

    const anonymous = await client().rpc('report_counter_device_state', {
      p_unresolved: 9,
      p_oldest_unresolved_at: '2026-08-29T03:00:00.000Z',
    })
    expect(anonymous.data).toBeNull()
    expect(anonymous.error?.code).toBe('42501')
  })
})
