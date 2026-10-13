/**
 * Change gates through real GoTrue and PostgREST sessions (a-release-can-be-
 * switched-off, tasks 2.6). Every signed-in principal reads the gates; only the
 * owner turns one, whatever a hand-crafted request says; and one outlet's tablet
 * health is invisible to the other outlet's manager and tablets.
 *
 * Positive calls write a gate turn and two health rows. `afterAll` turns the
 * probe back to where it was and deletes the health rows with the service-role
 * key, so later suites start from the seed; the turns stay in the append-only
 * history, which every suite counts relative to where it started.
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
const KPA = '00000000-0000-4000-a000-000000000002'
const DEVICE_KAL = '10000000-0000-4000-a000-000000000004'
const DEVICE_KPA = '10000000-0000-4000-a000-000000000005'

type Client = SupabaseClient<Database>

function client(key = SUPABASE_ANON_KEY): Client {
  return createClient<Database>(SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function service(): Client {
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for change-gate cleanup')
  return client(key)
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

let probeWasOn = false

beforeAll(async () => {
  const { data, error } = await service()
    .from('change_gates')
    .select('enabled')
    .eq('key', 'probe')
    .single()
  if (error) throw error
  probeWasOn = data.enabled
})

afterAll(async () => {
  const admin = service()
  const { error: turnError } = await admin.rpc('change_gate_force', {
    p_key: 'probe',
    p_enabled: probeWasOn,
    p_reason: 'zz-change-gates: restored after the REST probe',
  })
  if (turnError) throw turnError
  const { error } = await admin.from('device_health').delete().in('device_id', [DEVICE_KAL, DEVICE_KPA])
  if (error) throw error
})

describe('change gates over REST', () => {
  it('lets every signed-in principal read the gates, and nobody anonymous', async () => {
    for (const alias of ['owner', 'admin.kalyani', 'biller.kalyani', 'tablet.kalyani']) {
      const signedIn = await signIn(alias)
      const { data, error } = await signedIn.from('change_gates').select('key, code, enabled')
      expect(error, alias).toBeNull()
      expect(data?.map((gate) => gate.key)).toEqual(expect.arrayContaining(['probe', 'tablet-health']))
    }
    const { data, error } = await client().from('change_gates').select('key')
    expect(data ?? []).toEqual([])
    expect(error?.code).toBe('42501')
  })

  it('refuses a turn from anybody but the owner, whatever the request says', async () => {
    for (const alias of ['admin.kalyani', 'biller.kalyani', 'tablet.kalyani']) {
      const signedIn = await signIn(alias)
      const { error } = await signedIn.rpc('set_change_gate', {
        p_key: 'probe',
        p_enabled: !probeWasOn,
        p_reason: 'hand-crafted',
      })
      expect(error?.message, alias).toBe('Only the owner turns a change gate.')
      const direct = await signedIn
        .from('change_gates')
        .update({ enabled: !probeWasOn })
        .eq('key', 'probe')
        .select()
      expect(direct.data ?? [], alias).toEqual([])
    }
    const owner = await signIn('owner')
    const { error } = await owner.rpc('set_change_gate', {
      p_key: 'probe',
      p_enabled: !probeWasOn,
      p_reason: 'zz-change-gates',
    })
    expect(error).toBeNull()
    const { data } = await service().from('change_gates').select('enabled').eq('key', 'probe').single()
    expect(data?.enabled).toBe(!probeWasOn)
  })

  it('isolates each outlet’s tablet health, proved by hand-crafted requests', async () => {
    const tabletKal = await signIn('tablet.kalyani')
    const tabletKpa = await signIn('tablet.kanchrapara')
    const report = {
      p_build: 'abc1234',
      p_booted_gates: ['probe'],
      p_window_seconds: 60,
      p_requests: 38,
      p_failed: 0,
      p_slowest_ms: 420,
    }
    expect((await tabletKal.rpc('report_device_health', report)).error).toBeNull()
    expect((await tabletKpa.rpc('report_device_health', report)).error).toBeNull()

    // A tablet cannot write another tablet's row, nor read any row.
    const forged = await tabletKal.from('device_health').insert({
      device_id: DEVICE_KPA,
      outlet_id: KPA,
      build: 'forged',
      window_seconds: 60,
      requests: 0,
      failed: 0,
      slowest_ms: 0,
    })
    expect(forged.error).not.toBeNull()
    expect((await tabletKal.from('device_health').select('device_id')).data ?? []).toEqual([])

    const managerKpa = await signIn('admin.kanchrapara')
    const crafted = await managerKpa.from('device_health').select('device_id').eq('outlet_id', KAL)
    expect(crafted.error).toBeNull()
    expect(crafted.data).toEqual([])
    const own = await managerKpa.from('device_health').select('outlet_id')
    expect(own.data).toEqual([{ outlet_id: KPA }])

    const biller = await signIn('biller.kalyani')
    expect((await biller.from('device_health').select('device_id')).data ?? []).toEqual([])

    const owner = await signIn('owner')
    const all = await owner.from('device_health').select('device_id')
    expect(all.data?.map((row) => row.device_id).sort()).toEqual([DEVICE_KAL, DEVICE_KPA])
  })

  it('keeps the history for the owner alone', async () => {
    const manager = await signIn('admin.kalyani')
    expect((await manager.from('change_gate_events').select('id')).data ?? []).toEqual([])
    const owner = await signIn('owner')
    const { data } = await owner.from('change_gate_events').select('gate_key').eq('gate_key', 'probe')
    expect((data ?? []).length).toBeGreaterThan(0)
  })
})
