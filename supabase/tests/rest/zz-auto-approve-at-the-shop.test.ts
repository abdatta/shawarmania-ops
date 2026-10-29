/**
 * A check-in at the shop approves itself, over the wire
 * (a-check-in-at-the-shop-approves-itself, #81, tasks 8.4).
 *
 * `99_a_check_in_at_the_shop_approves_itself.sql` proves the rule, the block
 * and who may change the rules in SQL. What only signed-in sessions over REST
 * can show:
 *
 *   * **a hand-crafted check-in 2.6 km away under Block is refused** through
 *     PostgREST, with the sentence the adapter reads;
 *   * **another outlet's manager is refused** the rules, through the real
 *     outlets adapter and by a hand-crafted RPC;
 *   * **an auto-approved day reads back with its decision** to the person
 *     whose day it is.
 *
 * It turns `auto-approve-at-the-shop` on, so it runs in the change-gate phase
 * (`vitest.change-gates.config.ts`), and puts the gate and Kalyani's rules back
 * afterwards. The check-in it keeps is a Biller's, acting as an Employee, whom
 * no other attendance suite checks in.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { DataActionError } from '../../../src/data-access/adapters'
import type { Database } from '../../../src/data-access/database.types'
import { createSupabaseOutletsAdapter } from '../../../src/data-access/supabase-adapters/outlets'

const SUPABASE_URL = process.env['SUPABASE_URL'] ?? 'http://127.0.0.1:54321'
const SUPABASE_ANON_KEY =
  process.env['SUPABASE_ANON_KEY'] ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const PASSWORD = 'shawarmania-local'
const KAL = '00000000-0000-4000-a000-000000000001'
const GATE = 'auto-approve-at-the-shop'

type Client = SupabaseClient<Database>

function client(key = SUPABASE_ANON_KEY): Client {
  return createClient<Database>(SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function service(): Client {
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required to turn the gate')
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

async function turn(enabled: boolean, reason: string) {
  const { error } = await service().rpc('change_gate_force', {
    p_key: GATE,
    p_enabled: enabled,
    p_reason: reason,
  })
  if (error) throw error
}

/** A check-in by hand: the RPC the adapter sends, with no adapter in between. */
function checkIn(as: Client, lat: number, lng: number) {
  return as.rpc('attendance_submit_attempt_v3', {
    p_attempt_id: crypto.randomUUID(),
    p_outlet_id: KAL,
    // The command takes the date from its own clock; this is only identity.
    p_business_date: new Date().toISOString().slice(0, 10),
    p_attempted_at: new Date().toISOString(),
    p_lat: lat,
    p_lng: lng,
    p_accuracy_m: 15,
  })
}

let gateWasOn = false
let owner: ReturnType<typeof createSupabaseOutletsAdapter>
let kalyaniManager: ReturnType<typeof createSupabaseOutletsAdapter>
let otherManagerClient: Client
let otherManager: ReturnType<typeof createSupabaseOutletsAdapter>
let staff: Client

beforeAll(async () => {
  const { data, error } = await service()
    .from('change_gates')
    .select('enabled')
    .eq('key', GATE)
    .single()
  if (error) throw error
  gateWasOn = data.enabled
  await turn(true, 'zz-auto-approve-at-the-shop: on for the REST probe')

  owner = createSupabaseOutletsAdapter(await signIn('owner'))
  kalyaniManager = createSupabaseOutletsAdapter(await signIn('admin.kalyani'))
  otherManagerClient = await signIn('admin.kanchrapara')
  otherManager = createSupabaseOutletsAdapter(otherManagerClient)
  staff = await signIn('biller.kalyani.two')
})

afterAll(async () => {
  await owner.updateAttendanceRules(KAL, { needsManager: false, blocksAway: false })
  await turn(gateWasOn, 'zz-auto-approve-at-the-shop: restored after the REST probe')
})

describe('an outlet’s attendance rules, over REST', () => {
  it('lets the outlet’s own manager save them, and reads them back', async () => {
    const row = await kalyaniManager.updateAttendanceRules(KAL, {
      needsManager: false,
      blocksAway: true,
    })
    expect(row).toMatchObject({ attendance_needs_manager: false, attendance_blocks_away: true })
  })

  it('refuses another outlet’s manager, through the adapter and by hand', async () => {
    const refused = await otherManager
      .updateAttendanceRules(KAL, { needsManager: true, blocksAway: false })
      .catch((caught: unknown) => caught)
    expect(refused).toBeInstanceOf(DataActionError)
    expect(refused).toMatchObject({ code: 'not_permitted' })

    const { error } = await otherManagerClient.rpc('set_outlet_attendance_rules', {
      p_outlet: KAL,
      p_needs_manager: true,
      p_blocks_away: false,
    })
    expect(error?.code).toBe('42501')

    const { data } = await staff
      .from('outlets')
      .select('attendance_needs_manager, attendance_blocks_away')
      .eq('id', KAL)
      .single()
    expect(data).toEqual({ attendance_needs_manager: false, attendance_blocks_away: true })
  })
})

describe('a check-in under the rules, over REST', () => {
  it('refuses a hand-crafted check-in 2.6 km away under Block, and writes nothing', async () => {
    const { error } = await checkIn(staff, 22.9984, 88.4345)
    expect(error?.code).toBe('23514')
    expect(error?.message).toContain('check-in away from the shop is blocked here')

    const { data } = await staff.from('attendance_attempts').select('id').eq('outlet_id', KAL)
    expect(data).toEqual([])
  })

  it('approves a check-in inside the fence, and the day reads back with its decision', async () => {
    const { data: day, error } = await checkIn(staff, 22.975, 88.4345)
    expect(error).toBeNull()
    expect(day).toMatchObject({ status: 'present', current_attempt_id: null, approved_by: null })

    const { data: decision } = await staff
      .from('attendance_decisions')
      .select('kind, actor_id, actor_name, fence_radius_m, new_status')
      .eq('id', day!.latest_decision_id!)
      .single()
    expect(decision).toEqual({
      kind: 'auto_approved',
      actor_id: null,
      actor_name: null,
      fence_radius_m: 150,
      new_status: 'present',
    })
  })
})
