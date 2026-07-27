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
  superAdmin: { email: 'owner@example.com', sub: '10000000-0000-4000-a000-000000000001' },
  faKalyani: { email: 'admin.kalyani@example.com', sub: '10000000-0000-4000-a000-000000000002' },
  faKanchrapara: {
    email: 'admin.kanchrapara@example.com',
    sub: '10000000-0000-4000-a000-000000000003',
  },
  deviceKalyani: {
    email: 'tablet.kalyani@example.com',
    sub: '10000000-0000-4000-a000-000000000004',
  },
  employeeKalyani: {
    email: 'staff.kalyani@example.com',
    sub: '10000000-0000-4000-a000-000000000006',
  },
  deactivatedFa: {
    email: 'deactivated.kalyani@example.com',
    sub: '10000000-0000-4000-a000-000000000008',
  },
  revokedDevice: {
    email: 'revoked.tablet.kalyani@example.com',
    sub: '10000000-0000-4000-a000-000000000009',
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
  it('a real GoTrue sign-in carries app_role and app_outlet_id claims', async () => {
    const { accessToken } = await signIn(PERSONAS.faKalyani.email)
    const claims = decodeJwtPayload(accessToken)
    expect(claims['app_role']).toBe('franchise_admin')
    expect(claims['app_outlet_id']).toBe(OUTLETS.kalyani)
    expect(claims['sub']).toBe(PERSONAS.faKalyani.sub)
  })

  it('the super admin claim set is outlet-less', async () => {
    const { accessToken } = await signIn(PERSONAS.superAdmin.email)
    const claims = decodeJwtPayload(accessToken)
    expect(claims['app_role']).toBe('super_admin')
    expect(claims['app_outlet_id']).toBeNull()
  })
})

describe('a Franchise Admin session, hand-crafting requests for the other outlet', () => {
  let fa: Client

  beforeAll(async () => {
    fa = (await signIn(PERSONAS.faKalyani.email)).client
  })

  it.each(['bills', 'menu_items', 'expenses', 'employees', 'attendance', 'shifts'] as const)(
    'an explicit other-outlet filter on %s returns zero rows',
    async (table) => {
      const { data, error } = await fa.from(table).select('*').eq('outlet_id', OUTLETS.kanchrapara)
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
      business_date: new Date().toISOString().slice(0, 10),
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
      business_date: new Date().toISOString().slice(0, 10),
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
      business_date: new Date().toISOString().slice(0, 10),
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

    const { data: attendance, error } = await employee.from('attendance').select('employee_id')
    expect(error).toBeNull()
    expect(attendance?.length).toBeGreaterThan(0)
    expect(
      attendance?.every((row) => row.employee_id === '20000000-0000-4000-a000-000000000001'),
    ).toBe(true)

    const { data: bills } = await employee.from('bills').select('*')
    expect(bills).toEqual([])
    const { data: menu } = await employee.from('menu_items').select('*')
    expect(menu).toEqual([])
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
