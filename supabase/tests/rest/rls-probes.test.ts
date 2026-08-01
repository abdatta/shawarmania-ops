/**
 * REST-level isolation probes — the roadmap gate stated literally: a valid,
 * really-signed-in session issuing hand-crafted PostgREST requests for the
 * other outlet's rows, and getting nothing.
 *
 * The pgTAP suite (supabase/tests/*.sql) proves the policies exhaustively
 * with simulated claims; this layer proves the deployed stack injects those
 * claims into real tokens and enforces them over HTTP. Requires the local
 * stack: `npm run db:start && npm run db:reset`, then `npm run test:rls`.
 *
 * Every write attempted here is a DENIED one — the probes never mutate the
 * seeded database, so they can run repeatedly against the same reset.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '../../../src/data-access/database.types'
import { resolveBusinessDate } from '../../../src/domain/datetime'

const SUPABASE_URL = process.env['SUPABASE_URL'] ?? 'http://127.0.0.1:54321'
// The Supabase CLI's well-known local demo anon key — public by design,
// identical in every local stack, useless anywhere else.
const SUPABASE_ANON_KEY =
  process.env['SUPABASE_ANON_KEY'] ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

const PASSWORD = 'shawarmania-local'

const OUTLETS = {
  kalyani: '00000000-0000-4000-a000-000000000001',
  kanchrapara: '00000000-0000-4000-a000-000000000002',
} as const

const PERSONAS = {
  superAdmin: {
    email: 'owner@login.shawarmania.invalid',
    sub: '10000000-0000-4000-a000-000000000001',
  },
  faKalyani: {
    email: 'admin.kalyani@login.shawarmania.invalid',
    sub: '10000000-0000-4000-a000-000000000002',
  },
  faKanchrapara: {
    email: 'admin.kanchrapara@login.shawarmania.invalid',
    sub: '10000000-0000-4000-a000-000000000003',
  },
  deviceKalyani: {
    email: 'tablet.kalyani@login.shawarmania.invalid',
    sub: '10000000-0000-4000-a000-000000000004',
  },
  employeeKalyani: {
    email: 'staff.kalyani@login.shawarmania.invalid',
    sub: '10000000-0000-4000-a000-000000000006',
  },
  deactivatedFa: {
    email: 'deactivated.kalyani@login.shawarmania.invalid',
    sub: '10000000-0000-4000-a000-000000000008',
  },
  revokedDevice: {
    email: 'revoked.tablet.kalyani@login.shawarmania.invalid',
    sub: '10000000-0000-4000-a000-000000000009',
  },
  // One login, live assignments at BOTH outlets — the case that did not exist
  // before multi-outlet-people.
  twoOutlets: {
    email: 'two.outlets@login.shawarmania.invalid',
    sub: '10000000-0000-4000-a000-00000000000e',
  },
} as const

type Client = SupabaseClient<Database>

function anonClient(): Client {
  return createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

async function signIn(email: string): Promise<{ client: Client; accessToken: string }> {
  const client = anonClient()
  const { data, error } = await client.auth.signInWithPassword({ email, password: PASSWORD })
  if (error || !data.session) {
    throw new Error(`sign-in failed for ${email}: ${error?.message ?? 'no session'}`)
  }
  return { client, accessToken: data.session.access_token }
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const payload = token.split('.')[1]
  if (!payload) throw new Error('malformed JWT')
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>
}

describe('token claims', () => {
  // Since multi-outlet-people nothing about authority is in the token, and this
  // is the probe that says so against a real GoTrue sign-in rather than against
  // the migration set. A token that carried a role again would be a regression
  // nothing else here would notice — every policy would keep passing, because
  // they stopped reading it.
  it('a real GoTrue sign-in carries no authority claim at all', async () => {
    const { accessToken } = await signIn(PERSONAS.faKalyani.email)
    const claims = decodeJwtPayload(accessToken)
    expect(claims['app_role']).toBeUndefined()
    expect(claims['app_outlet_id']).toBeUndefined()
    expect(claims['sub']).toBe(PERSONAS.faKalyani.sub)
  })

  it('so authority is resolved from assignments, not from the session', async () => {
    const { client } = await signIn(PERSONAS.faKalyani.email)
    const { data, error } = await client
      .from('assignments')
      .select('role, outlet_id')
      .eq('person_id', PERSONAS.faKalyani.sub)
      .is('ended_on', null)
    expect(error).toBeNull()
    expect(data).toEqual([{ role: 'franchise_admin', outlet_id: OUTLETS.kalyani }])
  })
})

describe('a person assigned to two outlets', () => {
  let split: Client

  beforeAll(async () => {
    split = (await signIn(PERSONAS.twoOutlets.email)).client
  })

  it('reads their own attendance at both outlets, from one login', async () => {
    const { data, error } = await split.from('attendance').select('outlet_id, person_id')
    expect(error).toBeNull()
    expect(new Set(data?.map((row) => row.outlet_id))).toEqual(
      new Set([OUTLETS.kalyani, OUTLETS.kanchrapara]),
    )
    expect(data?.every((row) => row.person_id === PERSONAS.twoOutlets.sub)).toBe(true)
  })

  it('sees both outlet rows, because the fence has to judge them at either', async () => {
    const { data, error } = await split.from('outlets').select('id')
    expect(error).toBeNull()
    expect(new Set(data?.map((row) => row.id))).toEqual(
      new Set([OUTLETS.kalyani, OUTLETS.kanchrapara]),
    )
  })

  it('sees both of their own assignments and nobody else’s', async () => {
    const { data, error } = await split.from('assignments').select('person_id, outlet_id')
    expect(error).toBeNull()
    expect(data).toHaveLength(2)
    expect(data?.every((row) => row.person_id === PERSONAS.twoOutlets.sub)).toBe(true)
  })

  it('is still only an Employee at each, so no manager surface opens anywhere', async () => {
    for (const table of ['expenses', 'inventory_items', 'daily_cash_records'] as const) {
      const { data, error } = await split.from(table).select('id')
      expect(error).toBeNull()
      expect(data).toEqual([])
    }
  })

  it('reads no colleague’s attendance at either outlet', async () => {
    const { data, error } = await split
      .from('attendance')
      .select('id')
      .neq('person_id', PERSONAS.twoOutlets.sub)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })
})

describe('a Franchise Admin session, hand-crafting requests for the other outlet', () => {
  let fa: Client

  beforeAll(async () => {
    fa = (await signIn(PERSONAS.faKalyani.email)).client
  })

  it.each(['bills', 'menu_items', 'expenses', 'assignments', 'attendance', 'shifts'] as const)(
    'an explicit other-outlet filter on %s returns zero rows',
    async (table) => {
      const { data, error } = await fa.from(table).select('id').eq('outlet_id', OUTLETS.kanchrapara)
      expect(error).toBeNull()
      expect(data).toEqual([])
    },
  )

  it('an unfiltered bills read returns only own-outlet rows', async () => {
    const { data, error } = await fa.from('bills').select('outlet_id')
    expect(error).toBeNull()
    expect(data?.length).toBeGreaterThan(0)
    expect(data?.every((row) => row.outlet_id === OUTLETS.kalyani)).toBe(true)
  })

  it('reading a specific other-outlet row by id returns nothing', async () => {
    const { data, error } = await fa
      .from('menu_items')
      .select('*')
      .eq('id', '32000000-0000-4000-a000-000000000001')
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('an insert carrying the other outlet id is rejected by the database', async () => {
    const { error } = await fa.from('expenses').insert({
      outlet_id: OUTLETS.kanchrapara,
      business_date: resolveBusinessDate(new Date(), '04:00'),
      category: 'other',
      amount_paise: 1000,
      payment_method: 'cash',
      recorded_by: PERSONAS.faKalyani.sub,
    })
    expect(error).not.toBeNull()
    expect(error?.code).toBe('42501')
  })

  it('an update aimed at the other outlet touches nothing', async () => {
    const { data, error } = await fa
      .from('menu_items')
      .update({ price_paise: 100 })
      .eq('outlet_id', OUTLETS.kanchrapara)
      .select()
    expect(error).toBeNull()
    expect(data).toEqual([])

    // Prove the target row is untouched, as its own admin.
    const kpa = (await signIn(PERSONAS.faKanchrapara.email)).client
    const { data: item } = await kpa
      .from('menu_items')
      .select('price_paise')
      .eq('id', '32000000-0000-4000-a000-000000000001')
      .single()
    expect(item?.price_paise).toBe(13900)
  })

  it('the daily cash record of the other outlet is invisible', async () => {
    const { data, error } = await fa
      .from('daily_cash_records')
      .select('*')
      .eq('outlet_id', OUTLETS.kanchrapara)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('closing another outlet’s day over RPC is refused', async () => {
    const { error } = await fa.rpc('close_business_day', {
      p_outlet_id: OUTLETS.kanchrapara,
      p_business_date: '2020-01-01',
      p_opening_cash_paise: 0,
      p_actual_closing_paise: 0,
    })
    expect(error).not.toBeNull()
  })
})

describe('the Super Admin session', () => {
  it('reads across both outlets', async () => {
    const sa = (await signIn(PERSONAS.superAdmin.email)).client
    const { data, error } = await sa.from('bills').select('outlet_id')
    expect(error).toBeNull()
    const distinct = new Set(data?.map((row) => row.outlet_id))
    expect(distinct).toEqual(new Set([OUTLETS.kalyani, OUTLETS.kanchrapara]))
  })

  it('cannot close a business day — day close belongs to the Franchise Admin', async () => {
    const sa = (await signIn(PERSONAS.superAdmin.email)).client
    const { error } = await sa.rpc('close_business_day', {
      p_outlet_id: OUTLETS.kalyani,
      p_business_date: '2020-01-01',
      p_opening_cash_paise: 0,
      p_actual_closing_paise: 0,
    })
    expect(error).not.toBeNull()
  })
})

describe('a deactivated account with a still-valid session', () => {
  let deactivated: Client

  beforeAll(async () => {
    deactivated = (await signIn(PERSONAS.deactivatedFa.email)).client
  })

  it('signs in (auth is valid) but reads nothing at all', async () => {
    for (const table of ['bills', 'menu_items', 'profiles', 'outlets'] as const) {
      const { data, error } = await deactivated.from(table).select('*')
      expect(error).toBeNull()
      expect(data).toEqual([])
    }
  })

  it('cannot write, even inside its own outlet', async () => {
    const { error } = await deactivated.from('expenses').insert({
      outlet_id: OUTLETS.kalyani,
      business_date: resolveBusinessDate(new Date(), '04:00'),
      category: 'other',
      amount_paise: 1000,
      payment_method: 'cash',
      recorded_by: PERSONAS.deactivatedFa.sub,
    })
    expect(error?.code).toBe('42501')
  })
})

describe('a revoked counter device with a still-valid session', () => {
  let revoked: Client

  beforeAll(async () => {
    revoked = (await signIn(PERSONAS.revokedDevice.email)).client
  })

  it('reads nothing — menu, bills, shifts, even its own device row', async () => {
    for (const table of ['menu_items', 'bills', 'shifts', 'counter_devices'] as const) {
      const { data, error } = await revoked.from(table).select('*')
      expect(error).toBeNull()
      expect(data).toEqual([])
    }
  })

  it('cannot settle a bill', async () => {
    const { error } = await revoked.from('bills').insert({
      id: crypto.randomUUID(),
      outlet_id: OUTLETS.kalyani,
      business_date: resolveBusinessDate(new Date(), '04:00'),
      biller_profile_id: '10000000-0000-4000-a000-00000000000a',
      counter_device_id: PERSONAS.revokedDevice.sub,
      shift_id: '40000000-0000-4000-a000-000000000002',
      subtotal_paise: 13900,
      total_paise: 13900,
      payment_method: 'cash',
    })
    expect(error?.code).toBe('42501')
  })
})

describe('an Employee session', () => {
  it('sees only their own attendance, and no billing surface', async () => {
    const employee = (await signIn(PERSONAS.employeeKalyani.email)).client

    // Staff are accounts: attendance keys on the person's own profile id.
    const { data: attendance, error } = await employee.from('attendance').select('person_id')
    expect(error).toBeNull()
    expect(attendance?.length).toBeGreaterThan(0)
    expect(attendance?.every((row) => row.person_id === PERSONAS.employeeKalyani.sub)).toBe(true)

    const { data: bills } = await employee.from('bills').select('*')
    expect(bills).toEqual([])
    const { data: menu } = await employee.from('menu_items').select('*')
    expect(menu).toEqual([])
  })

  /**
   * The geofence, attacked the way it would actually be attacked: a real token
   * and a hand-crafted PostgREST request, not the app. pgTAP proves the trigger
   * logic exhaustively; these prove it is reachable over HTTP and that the
   * three obvious laundering routes are all closed.
   */
  it('cannot rewrite the verdict on its own attendance row', async () => {
    const employee = (await signIn(PERSONAS.employeeKalyani.email)).client

    const { error } = await employee
      .from('attendance')
      .update({ status: 'half_day' })
      .eq('person_id', PERSONAS.employeeKalyani.sub)
    // The rule was always about who may ATTEST, not about which role you are:
    // the old wording named `employee` and so silently exempted a biller
    // updating their own row (multi-outlet-people).
    expect(error?.message).toContain(
      'only an admin for this outlet may change an attendance status',
    )
  })

  it('cannot erase the evidence its verdict was derived from', async () => {
    const employee = (await signIn(PERSONAS.employeeKalyani.email)).client

    const { error } = await employee
      .from('attendance')
      .update({ check_in_lat: null, check_in_lng: null })
      .eq('person_id', PERSONAS.employeeKalyani.sub)
      .not('check_in_at', 'is', null)
    expect(error?.message).toContain('captured check-in evidence is immutable')
  })

  it('cannot approve its own day over HTTP', async () => {
    const employee = (await signIn(PERSONAS.employeeKalyani.email)).client

    // Their own arrival on a day nothing else in any suite touches, so this
    // proves the guard rather than depending on which file ran first. Every
    // seeded day of theirs is already settled, and a settled day is refused by
    // the immutability rule — a different refusal from the one being proved.
    const at = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000)
    const businessDate = resolveBusinessDate(at, '04:00')
    await employee.from('attendance').insert({
      outlet_id: OUTLETS.kalyani,
      person_id: PERSONAS.employeeKalyani.sub,
      business_date: businessDate,
      status: 'present',
      check_in_at: at.toISOString(),
      check_in_source: 'phone',
    })

    const { error } = await employee
      .from('attendance')
      .update({
        approved_by: PERSONAS.employeeKalyani.sub,
        approval_reason: 'self-approved',
      })
      .eq('person_id', PERSONAS.employeeKalyani.sub)
      .eq('business_date', businessDate)
      .is('approved_by', null)
    expect(error?.message).toContain('only a franchise admin or super admin may record an approval')
  })

  it('cannot fabricate a manual entry over HTTP', async () => {
    const employee = (await signIn(PERSONAS.employeeKalyani.email)).client

    // Today as the outlet reckons days: IST wall clock, 04:00 cutover.
    const businessDate = resolveBusinessDate(new Date(), '04:00')
    const { error } = await employee.from('attendance').insert({
      outlet_id: OUTLETS.kalyani,
      person_id: PERSONAS.employeeKalyani.sub,
      business_date: businessDate,
      status: 'present',
      check_in_at: new Date().toISOString(),
      check_in_source: 'manual',
    })
    expect(error?.message).toContain(
      'only a franchise admin or super admin may record a manual entry',
    )
  })

  it('nor can the counter tablet', async () => {
    const device = (await signIn(PERSONAS.deviceKalyani.email)).client

    const businessDate = resolveBusinessDate(new Date(), '04:00')
    const { error } = await device.from('attendance').insert({
      outlet_id: OUTLETS.kalyani,
      person_id: '20000000-0000-4000-a000-000000000002',
      business_date: businessDate,
      status: 'present',
      check_in_at: new Date().toISOString(),
      check_in_source: 'manual',
    })
    expect(error?.message).toContain(
      'only a franchise admin or super admin may record a manual entry',
    )
  })
})

describe('the geofence reference point', () => {
  /**
   * Moving the fence is not the same power as overriding a check-in, even
   * though the outcome can look alike. An override is recorded with who and
   * why; moving the fence is silent and applies to everyone from then on. Only
   * the Super Admin may do it (attendance, design D4).
   */
  it('cannot be moved by the Franchise Admin whose own staff it judges', async () => {
    const fa = (await signIn(PERSONAS.faKalyani.email)).client

    const { data, error } = await fa
      .from('outlets')
      .update({ latitude: 1, longitude: 1, geofence_radius_m: 5000 })
      .eq('id', OUTLETS.kalyani)
      .select('id')

    // RLS filters the row out rather than raising: nothing was touched.
    expect(error).toBeNull()
    expect(data).toEqual([])

    const { data: after } = await fa
      .from('outlets')
      .select('geofence_radius_m, latitude')
      .eq('id', OUTLETS.kalyani)
      .single()
    expect(after?.geofence_radius_m).toBe(150)
    expect(after?.latitude).toBeCloseTo(22.975, 3)
  })

  it('is invisible, let alone writable, across outlets', async () => {
    const fa = (await signIn(PERSONAS.faKalyani.email)).client

    const { data } = await fa
      .from('outlets')
      .select('id, latitude, geofence_radius_m')
      .eq('id', OUTLETS.kanchrapara)
    expect(data).toEqual([])
  })
})

describe('the anonymous role', () => {
  it('holds no privilege on any table', async () => {
    const anon = anonClient()
    const { error } = await anon.from('menu_items').select('*')
    expect(error).not.toBeNull()
    expect(error?.code).toBe('42501')
  })
})

describe('account invitations', () => {
  // Selected columns, never `select('*')`: code_hash is withheld by
  // column-level grant, so a whole-row read is refused on purpose.
  const SAFE_COLUMNS = 'id, profile_id, expires_at, consumed_at, attempts'

  it('a Franchise Admin sees the invite of a person they manage, and not the other’s', async () => {
    const fa = (await signIn(PERSONAS.faKalyani.email)).client
    const { data, error } = await fa.from('account_invites').select(SAFE_COLUMNS)
    expect(error).toBeNull()
    // A property, not a population count: the account-flows suite provisions
    // real Kalyani accounts against this same database.
    expect(data?.length).toBeGreaterThan(0)

    // Since multi-outlet-people an invite carries no outlet of its own — it is
    // about a person, so the scoping question is who may manage them. The other
    // outlet's pending staff member is the row that must not appear.
    const { data: other } = await fa
      .from('account_invites')
      .select(SAFE_COLUMNS)
      .eq('profile_id', '10000000-0000-4000-a000-00000000000d')
    expect(other).toEqual([])
  })

  it('the code hash is unreadable over REST, for every role', async () => {
    for (const persona of [PERSONAS.superAdmin, PERSONAS.faKalyani] as const) {
      const client = (await signIn(persona.email)).client
      const { error: named } = await client.from('account_invites').select('code_hash')
      expect(named?.code, persona.email).toBe('42501')
      const { error: star } = await client.from('account_invites').select('*')
      expect(star?.code, persona.email).toBe('42501')
    }
  })

  it('an Employee and a counter device see no invitations at all', async () => {
    for (const persona of [PERSONAS.employeeKalyani, PERSONAS.deviceKalyani] as const) {
      const client = (await signIn(persona.email)).client
      const { data, error } = await client.from('account_invites').select(SAFE_COLUMNS)
      expect(error, persona.email).toBeNull()
      expect(data, persona.email).toEqual([])
    }
  })

  it('no client can issue, extend, or delete an invitation', async () => {
    const fa = (await signIn(PERSONAS.faKalyani.email)).client

    const { error: inserted } = await fa.from('account_invites').insert({
      profile_id: PERSONAS.employeeKalyani.sub,
      code_hash: 'forged',
      issued_by: PERSONAS.faKalyani.sub,
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    })
    expect(inserted?.code).toBe('42501')

    const { error: updated } = await fa
      .from('account_invites')
      .update({ expires_at: new Date(Date.now() + 99 * 86_400_000).toISOString() })
      .eq('profile_id', PERSONAS.employeeKalyani.sub)
    expect(updated?.code).toBe('42501')

    const { error: deleted } = await fa
      .from('account_invites')
      .delete()
      .eq('profile_id', PERSONAS.employeeKalyani.sub)
    expect(deleted?.code).toBe('42501')
  })
})

describe('deliberately closed surfaces', () => {
  it('the bill number counters are invisible even to the Super Admin', async () => {
    const sa = (await signIn(PERSONAS.superAdmin.email)).client
    // Not in the generated types' public surface contractually, but craft the
    // request anyway — the point is that the table is closed over REST too.
    const { error } = await sa.from('bill_number_counters' as 'bills').select('*')
    expect(error).not.toBeNull()
    expect(error?.code).toBe('42501')
  })

  it('no client can insert a daily cash record directly', async () => {
    const fa = (await signIn(PERSONAS.faKalyani.email)).client
    const { error } = await fa.from('daily_cash_records').insert({
      outlet_id: OUTLETS.kalyani,
      business_date: '2030-01-01',
      opening_cash_paise: 0,
      cash_sales_paise: 0,
      cash_expenses_paise: 0,
      cash_withdrawn_paise: 0,
      expected_closing_paise: 0,
      actual_closing_paise: 0,
      difference_paise: 0,
      closed_by: PERSONAS.faKalyani.sub,
    })
    expect(error?.code).toBe('42501')
  })
})
