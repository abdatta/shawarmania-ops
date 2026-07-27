/**
 * The account lifecycle over real HTTP: provisioning, the one-time code,
 * activation, sign-in, re-issue, and deactivation — against the running local
 * stack, through Kong, through the Edge Functions, through GoTrue and RLS.
 *
 * The roadmap gate for auth-and-roles restated as a test file. The pgTAP suite
 * (supabase/tests/07_account_invites.sql) proves the code semantics inside the
 * database; this proves that the deployed pieces agree with it, and that the
 * authority matrix in supabase/functions/_shared/authority.ts is enforced
 * rather than merely written down.
 *
 * Requires the local stack: `npm run db:start && npm run db:reset`, then
 * `npm run test:rls`.
 *
 * Unlike rls-probes.test.ts, this suite necessarily creates accounts. It uses
 * a fresh address per run so it is re-runnable without a reset, and it asserts
 * properties rather than row counts so it does not fight anything else that
 * writes to the same database.
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

const SEED_PASSWORD = 'shawarmania-local'
const NEW_PASSWORD = 'a-genuinely-set-password'

const OUTLETS = {
  kalyani: '00000000-0000-4000-a000-000000000001',
  kanchrapara: '00000000-0000-4000-a000-000000000002',
} as const

const PERSONAS = {
  superAdmin: 'owner@example.com',
  faKalyani: 'admin.kalyani@example.com',
  faKanchrapara: 'admin.kanchrapara@example.com',
  employeeKalyani: 'staff.kalyani@example.com',
  billerKalyani: 'biller.kalyani@example.com',
} as const

type Client = SupabaseClient<Database>

/** Unique per run, so the suite is re-runnable without a database reset. */
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`
let seq = 0
const freshEmail = (label: string) => `probe.${label}.${RUN}.${seq++}@example.com`

function anonClient(): Client {
  return createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

async function tokenFor(email: string, password = SEED_PASSWORD): Promise<string> {
  const { data, error } = await anonClient().auth.signInWithPassword({ email, password })
  if (error || !data.session) {
    throw new Error(`sign-in failed for ${email}: ${error?.message ?? 'no session'}`)
  }
  return data.session.access_token
}

interface FnResult<T = Record<string, unknown>> {
  status: number
  body: T
}

async function adminAccounts<T = Record<string, unknown>>(
  token: string | null,
  payload: Record<string, unknown>,
): Promise<FnResult<T>> {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/admin-accounts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  })
  const text = await response.text()
  return { status: response.status, body: (text ? JSON.parse(text) : {}) as T }
}

async function redeem(payload: Record<string, unknown>): Promise<FnResult> {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/redeem-invite`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const text = await response.text()
  return {
    status: response.status,
    body: (text ? JSON.parse(text) : {}) as Record<string, unknown>,
  }
}

interface Provisioned {
  profileId: string
  code: string
  expiresAt: string
}

async function provisionAs(
  token: string,
  overrides: Record<string, unknown> = {},
): Promise<{ email: string; result: FnResult<Provisioned> }> {
  const email = freshEmail('staff')
  const result = await adminAccounts<Provisioned>(token, {
    action: 'provision',
    fullName: 'Probe Staff',
    email,
    role: 'employee',
    outletId: OUTLETS.kalyani,
    ...overrides,
  })
  return { email, result }
}

let superAdminToken: string
let faKalyaniToken: string

beforeAll(async () => {
  superAdminToken = await tokenFor(PERSONAS.superAdmin)
  faKalyaniToken = await tokenFor(PERSONAS.faKalyani)
})

describe('provisioning an account end to end', () => {
  it('creates the account, issues a code, and the person activates and signs in', async () => {
    const { email, result } = await provisionAs(faKalyaniToken)
    expect(result.status).toBe(201)
    expect(result.body.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/)
    expect(new Date(result.body.expiresAt).getTime()).toBeGreaterThan(Date.now())

    // The account exists but is unusable: the password set at creation is
    // random and nobody — including the issuing admin — has ever seen it.
    const beforeActivation = await anonClient().auth.signInWithPassword({
      email,
      password: NEW_PASSWORD,
    })
    expect(beforeActivation.error).not.toBeNull()

    const activation = await redeem({ email, code: result.body.code, password: NEW_PASSWORD })
    expect(activation.status).toBe(204)

    const session = await anonClient().auth.signInWithPassword({ email, password: NEW_PASSWORD })
    expect(session.error).toBeNull()

    // And the session carries the claims the policies read.
    const claims = JSON.parse(
      Buffer.from(session.data.session!.access_token.split('.')[1]!, 'base64url').toString('utf8'),
    ) as Record<string, unknown>
    expect(claims['app_role']).toBe('employee')
    expect(claims['app_outlet_id']).toBe(OUTLETS.kalyani)
  })

  it('accepts a code however sloppily it was retyped', async () => {
    const { email, result } = await provisionAs(superAdminToken)
    const mangled = ` ${result.body.code.toLowerCase().replace('-', '  ')} `

    expect((await redeem({ email, code: mangled, password: NEW_PASSWORD })).status).toBe(204)
  })

  it('refuses a duplicate email address without creating anything', async () => {
    const duplicate = await adminAccounts(superAdminToken, {
      action: 'provision',
      fullName: 'Impostor',
      email: PERSONAS.employeeKalyani,
      role: 'employee',
      outletId: OUTLETS.kalyani,
    })
    expect(duplicate.status).toBe(409)

    // The existing account is untouched: its original password still works.
    const still = await anonClient().auth.signInWithPassword({
      email: PERSONAS.employeeKalyani,
      password: SEED_PASSWORD,
    })
    expect(still.error).toBeNull()
  })
})

describe('the authority matrix is enforced, not documented', () => {
  it('refuses an unauthenticated caller, and the anon key as a caller', async () => {
    expect((await adminAccounts(null, { action: 'provision' })).status).toBe(401)
    expect((await adminAccounts(SUPABASE_ANON_KEY, { action: 'provision' })).status).toBe(401)
  })

  it.each([
    ['an Employee', PERSONAS.employeeKalyani],
    ['a Biller', PERSONAS.billerKalyani],
  ])('refuses %s outright', async (_label, email) => {
    const token = await tokenFor(email)
    const { result } = await provisionAs(token)
    expect(result.status).toBe(403)
  })

  it('refuses a Franchise Admin reaching into the other outlet', async () => {
    const { result } = await provisionAs(faKalyaniToken, { outletId: OUTLETS.kanchrapara })
    expect(result.status).toBe(403)
  })

  it.each(['super_admin', 'franchise_admin'] as const)(
    'refuses a Franchise Admin minting a %s',
    async (role) => {
      const { result } = await provisionAs(faKalyaniToken, {
        role,
        outletId: role === 'super_admin' ? null : OUTLETS.kalyani,
      })
      expect(result.status).toBe(403)
    },
  )

  it('refuses an outlet-scoped role with no outlet, and a Super Admin with one', async () => {
    expect((await provisionAs(superAdminToken, { outletId: null })).result.status).toBe(403)
    expect(
      (await provisionAs(superAdminToken, { role: 'super_admin', outletId: OUTLETS.kalyani }))
        .result.status,
    ).toBe(403)
  })

  it('lets the Super Admin provision into either outlet', async () => {
    for (const outletId of [OUTLETS.kalyani, OUTLETS.kanchrapara]) {
      const { result } = await provisionAs(superAdminToken, { outletId })
      expect(result.status).toBe(201)
    }
  })

  it('refuses a Franchise Admin managing another outlet’s account', async () => {
    const { result: theirs } = await provisionAs(superAdminToken, {
      outletId: OUTLETS.kanchrapara,
    })
    expect(theirs.status).toBe(201)

    for (const payload of [
      { action: 'reissue', profileId: theirs.body.profileId },
      { action: 'set-active', profileId: theirs.body.profileId, isActive: false },
    ]) {
      expect((await adminAccounts(faKalyaniToken, payload)).status).toBe(403)
    }
  })

  it('refuses any admin deactivating themselves', async () => {
    const owner = await anonClient().auth.signInWithPassword({
      email: PERSONAS.superAdmin,
      password: SEED_PASSWORD,
    })
    const selfId = owner.data.user!.id
    const refused = await adminAccounts(superAdminToken, {
      action: 'set-active',
      profileId: selfId,
      isActive: false,
    })
    expect(refused.status).toBe(403)

    // Still active, and still able to act.
    const { result } = await provisionAs(superAdminToken)
    expect(result.status).toBe(201)
  })

  it('rejects an unknown action and a malformed body', async () => {
    expect((await adminAccounts(superAdminToken, { action: 'delete-everything' })).status).toBe(400)
    expect((await adminAccounts(superAdminToken, { action: 'provision' })).status).toBe(400)
  })
})

describe('the one-time code over the wire', () => {
  it('cannot be redeemed twice', async () => {
    const { email, result } = await provisionAs(superAdminToken)
    expect((await redeem({ email, code: result.body.code, password: NEW_PASSWORD })).status).toBe(
      204,
    )

    const replay = await redeem({ email, code: result.body.code, password: 'yet-another-password' })
    expect(replay.status).toBe(400)

    // And the password from the first, legitimate activation still stands.
    const session = await anonClient().auth.signInWithPassword({ email, password: NEW_PASSWORD })
    expect(session.error).toBeNull()
  })

  it('stops working the moment a replacement is issued', async () => {
    const { email, result } = await provisionAs(superAdminToken)
    const reissued = await adminAccounts<Provisioned>(superAdminToken, {
      action: 'reissue',
      profileId: result.body.profileId,
    })
    expect(reissued.status).toBe(200)
    expect(reissued.body.code).not.toBe(result.body.code)

    expect((await redeem({ email, code: result.body.code, password: NEW_PASSWORD })).status).toBe(
      400,
    )
    expect((await redeem({ email, code: reissued.body.code, password: NEW_PASSWORD })).status).toBe(
      204,
    )
  })

  it('is exhausted by repeated wrong guesses', async () => {
    const { email, result } = await provisionAs(superAdminToken)

    for (let attempt = 0; attempt < 5; attempt++) {
      const wrong = await redeem({ email, code: 'ZZZZZ-ZZZZZ', password: NEW_PASSWORD })
      expect(wrong.status).toBe(400)
    }

    // The right code, now worthless: only a fresh invite revives the account.
    expect((await redeem({ email, code: result.body.code, password: NEW_PASSWORD })).status).toBe(
      400,
    )

    const revived = await adminAccounts<Provisioned>(superAdminToken, {
      action: 'reissue',
      profileId: result.body.profileId,
    })
    expect((await redeem({ email, code: revived.body.code, password: NEW_PASSWORD })).status).toBe(
      204,
    )
  })

  it('reveals nothing: every failure looks the same', async () => {
    const { email, result } = await provisionAs(superAdminToken)

    const failures = await Promise.all([
      redeem({ email: freshEmail('ghost'), code: result.body.code, password: NEW_PASSWORD }),
      redeem({ email, code: 'ZZZZZ-ZZZZZ', password: NEW_PASSWORD }),
      redeem({ email: PERSONAS.superAdmin, code: result.body.code, password: NEW_PASSWORD }),
    ])

    const shapes = new Set(failures.map((f) => `${f.status}:${JSON.stringify(f.body)}`))
    expect(shapes.size).toBe(1)
    expect(failures[0]!.status).toBe(400)
  })

  it('refuses a short password before consuming anything', async () => {
    const { email, result } = await provisionAs(superAdminToken)

    const weak = await redeem({ email, code: result.body.code, password: 'short' })
    expect(weak.status).toBe(400)
    expect(weak.body['error']).toBe('weak_password')

    // The code survived the fumble.
    expect((await redeem({ email, code: result.body.code, password: NEW_PASSWORD })).status).toBe(
      204,
    )
  })
})

describe('deactivation, without waiting for a token to expire', () => {
  it('blocks a live session at the next request', async () => {
    const { email, result } = await provisionAs(superAdminToken)
    await redeem({ email, code: result.body.code, password: NEW_PASSWORD })

    const client = anonClient()
    const { data: session } = await client.auth.signInWithPassword({
      email,
      password: NEW_PASSWORD,
    })
    expect(session.session).not.toBeNull()

    // Signed in and reading their own profile — the exact read the client's
    // account watch performs.
    const before = await client
      .from('profiles')
      .select('id, full_name')
      .eq('id', result.body.profileId)
    expect(before.data).toHaveLength(1)

    const deactivated = await adminAccounts(superAdminToken, {
      action: 'set-active',
      profileId: result.body.profileId,
      isActive: false,
    })
    expect(deactivated.status).toBe(200)

    // Same client, same unexpired token, no refresh: nothing.
    const after = await client
      .from('profiles')
      .select('id, full_name')
      .eq('id', result.body.profileId)
    expect(after.error).toBeNull()
    expect(after.data).toEqual([])
  })

  it('leaves a deactivated account able to authenticate but unable to read', async () => {
    const { email, result } = await provisionAs(superAdminToken)
    await redeem({ email, code: result.body.code, password: NEW_PASSWORD })
    await adminAccounts(superAdminToken, {
      action: 'set-active',
      profileId: result.body.profileId,
      isActive: false,
    })

    // Auth still succeeds — deactivation is an authorisation fact, not an
    // authentication one. This is precisely why the client cannot infer it
    // from a failed sign-in and reads its own profile instead.
    const client = anonClient()
    const { error } = await client.auth.signInWithPassword({ email, password: NEW_PASSWORD })
    expect(error).toBeNull()

    const { data } = await client.from('profiles').select('id').eq('id', result.body.profileId)
    expect(data).toEqual([])
  })

  it('reactivates', async () => {
    const { email, result } = await provisionAs(superAdminToken)
    await redeem({ email, code: result.body.code, password: NEW_PASSWORD })
    await adminAccounts(superAdminToken, {
      action: 'set-active',
      profileId: result.body.profileId,
      isActive: false,
    })
    await adminAccounts(superAdminToken, {
      action: 'set-active',
      profileId: result.body.profileId,
      isActive: true,
    })

    const client = anonClient()
    await client.auth.signInWithPassword({ email, password: NEW_PASSWORD })
    const { data } = await client.from('profiles').select('id').eq('id', result.body.profileId)
    expect(data).toHaveLength(1)
  })
})

describe('an outstanding invite over REST', () => {
  /**
   * Supersession on reassignment is a database trigger, and it is proved
   * exhaustively in supabase/tests/07_account_invites.sql — there is no
   * reassignment endpoint to drive it from here, deliberately (this change
   * does not build one). What REST can prove is the other half: a freshly
   * issued invite is visible to its own outlet's admin, invisible to the
   * other's, and its hash is beyond reach of both.
   */
  it('is visible only within its own outlet, hash withheld from everyone', async () => {
    const { result } = await provisionAs(faKalyaniToken)
    expect(result.status).toBe(201)

    const clientFor = async (email: string): Promise<Client> => {
      const token = await tokenFor(email)
      return createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
      })
    }

    const kalyani = await clientFor(PERSONAS.faKalyani)
    const { data: own } = await kalyani
      .from('account_invites')
      .select('id, profile_id, outlet_id')
      .eq('profile_id', result.body.profileId)
    expect(own).toHaveLength(1)
    expect(own?.[0]?.outlet_id).toBe(OUTLETS.kalyani)

    const kanchrapara = await clientFor(PERSONAS.faKanchrapara)
    const { data: theirs } = await kanchrapara
      .from('account_invites')
      .select('id, profile_id, outlet_id')
      .eq('profile_id', result.body.profileId)
    expect(theirs).toEqual([])

    for (const client of [kalyani, await clientFor(PERSONAS.superAdmin)]) {
      const { error } = await client.from('account_invites').select('code_hash')
      expect(error?.code).toBe('42501')
    }
  })
})
