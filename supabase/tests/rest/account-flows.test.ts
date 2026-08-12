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
 * a fresh username per run so it is re-runnable without a reset, and it asserts
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
  superAdmin: 'owner@login.shawarmania.invalid',
  faKalyani: 'admin.kalyani@login.shawarmania.invalid',
  faKanchrapara: 'admin.kanchrapara@login.shawarmania.invalid',
  employeeKalyani: 'staff.kalyani@login.shawarmania.invalid',
  billerKalyani: 'biller.kalyani@login.shawarmania.invalid',
} as const

const PERSON_IDS = {
  superAdmin: '10000000-0000-4000-a000-000000000001',
  faKalyani: '10000000-0000-4000-a000-000000000002',
  splitStaff: '10000000-0000-4000-a000-00000000000e',
} as const

type Client = SupabaseClient<Database>

/** Unique per run, so the suite is re-runnable without a database reset. */
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`
let seq = 0
const freshUsername = (label: string) => `probe.${label}.${RUN.slice(-6)}.${seq++}`
const authAlias = (username: string) => `${username}@login.shawarmania.invalid`
const codeUsernames = new Map<string, string>()
const codeKey = (code: string) => code.replace(/[^0-9A-Z]/gi, '').toUpperCase()

function anonClient(): Client {
  return createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function clientWithToken(token: string): Client {
  return createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
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
  const body = (text ? JSON.parse(text) : {}) as T
  const recordCode = (candidate: unknown) => {
    const value = candidate as { code?: unknown; username?: unknown } | null
    if (typeof value?.code === 'string' && typeof value.username === 'string') {
      codeUsernames.set(codeKey(value.code), value.username)
    }
  }
  recordCode(body)
  recordCode((body as { issuedCode?: unknown }).issuedCode)
  recordCode((body as { replacementHandover?: unknown }).replacementHandover)
  return { status: response.status, body }
}

async function redeem(payload: Record<string, unknown>): Promise<FnResult> {
  const action = payload['action'] ?? 'redeem'
  const code = payload['code']
  const enriched =
    action === 'redeem' &&
    payload['username'] === undefined &&
    typeof code === 'string' &&
    codeUsernames.has(codeKey(code))
      ? { ...payload, username: codeUsernames.get(codeKey(code)) }
      : payload
  const response = await fetch(`${SUPABASE_URL}/functions/v1/redeem-invite`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // TEST-NET-2: isolate this suite's deliberate bad-code attempts from
      // other REST files exercising the endpoint's per-address limiter.
      'x-forwarded-for': '198.51.100.23',
    },
    body: JSON.stringify(enriched),
  })
  const text = await response.text()
  return {
    status: response.status,
    body: (text ? JSON.parse(text) : {}) as Record<string, unknown>,
  }
}

async function emailSignIn(
  email: string,
  password: string,
  ip = '198.51.100.42',
): Promise<FnResult<{ accessToken?: string; refreshToken?: string; error?: string }>> {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/email-sign-in`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': ip,
    },
    body: JSON.stringify({ email, password }),
  })
  const text = await response.text()
  return {
    status: response.status,
    body: (text ? JSON.parse(text) : {}) as {
      accessToken?: string
      refreshToken?: string
      error?: string
    },
  }
}

async function deploymentReadiness(): Promise<FnResult<{ ready?: boolean }>> {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/email-sign-in`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action: 'deployment-readiness' }),
  })
  const text = await response.text()
  return {
    status: response.status,
    body: (text ? JSON.parse(text) : {}) as { ready?: boolean },
  }
}

interface Provisioned {
  profileId: string
  username: string
  code: string
  expiresAt: string
  purpose?: 'activation' | 'password_reset'
}

interface AssignmentChanged {
  assignmentId: string
  issuedCode: Provisioned | null
}

interface AccountIdentifier {
  username: string
  accountEmail: string | null
  hasSignedIn: boolean
  invite: { purpose: 'activation' | 'password_reset'; expiresAt: string } | null
  stateFingerprint: string
}

interface IntendedAssignment {
  assignmentId: string | null
  outletId: string | null
  role: 'super_admin' | 'franchise_admin' | 'biller' | 'employee'
  startedOn: string
}

interface AssignmentSetResult {
  profileId: string
  assignments: IntendedAssignment[]
  stateFingerprint: string
  replacementHandover: (Provisioned & { purpose: 'activation' | 'password_reset' }) | null
}

async function identifiersFor(token: string): Promise<Record<string, AccountIdentifier>> {
  const result = await adminAccounts<{ identifiers: Record<string, AccountIdentifier> }>(token, {
    action: 'identifiers',
  })
  expect(result.status).toBe(200)
  return result.body.identifiers
}

async function liveAssignments(profileId: string): Promise<IntendedAssignment[]> {
  const { data, error } = await clientWithToken(superAdminToken)
    .from('assignments')
    .select('id, outlet_id, role, started_on')
    .eq('person_id', profileId)
    .is('ended_on', null)
    .order('outlet_id')
  expect(error).toBeNull()
  return (data ?? []).map((row) => ({
    assignmentId: row.id,
    outletId: row.outlet_id,
    role: row.role,
    startedOn: row.started_on,
  }))
}

async function provisionAs(
  token: string,
  overrides: Record<string, unknown> = {},
): Promise<{ username: string; email: string; result: FnResult<Provisioned> }> {
  const username = freshUsername('staff')
  const result = await adminAccounts<Provisioned>(token, {
    action: 'provision',
    fullName: 'Probe Staff',
    username,
    role: 'employee',
    outletIds: [OUTLETS.kalyani],
    ...overrides,
  })
  return { username, email: authAlias(username), result }
}

let superAdminToken: string
let faKalyaniToken: string

beforeAll(async () => {
  superAdminToken = await tokenFor(PERSONAS.superAdmin)
  faKalyaniToken = await tokenFor(PERSONAS.faKalyani)
})

describe('production deployment readiness', () => {
  it('exposes only a positive readiness boolean for the canonical local state', async () => {
    expect(await deploymentReadiness()).toEqual({
      status: 200,
      body: { ready: true },
    })
  })
})

describe('permanent associated-email sign-in', () => {
  it('returns a normal Supabase session for the same account as the username', async () => {
    const byEmail = await emailSignIn(' OWNER.ACCOUNT@EXAMPLE.COM ', SEED_PASSWORD)
    expect(byEmail.status).toBe(200)
    expect(byEmail.body).toEqual({
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
    })
    expect(byEmail.body).not.toHaveProperty('username')
    expect(byEmail.body).not.toHaveProperty('email')

    const installed = await anonClient().auth.setSession({
      access_token: byEmail.body.accessToken!,
      refresh_token: byEmail.body.refreshToken!,
    })
    const byUsername = await anonClient().auth.signInWithPassword({
      email: PERSONAS.superAdmin,
      password: SEED_PASSWORD,
    })
    expect(installed.data.user?.id).toBe(byUsername.data.user?.id)
  })

  it('keeps unknown email and wrong password indistinguishable', async () => {
    const [unknown, wrong] = await Promise.all([
      emailSignIn('nobody@example.com', SEED_PASSWORD, '198.51.100.43'),
      emailSignIn('owner.account@example.com', 'wrong-password', '198.51.100.44'),
    ])
    expect(unknown).toEqual({
      status: 401,
      body: { error: 'invalid_credentials' },
    })
    expect(wrong).toEqual(unknown)
  })
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

    const activation = await redeem({ code: result.body.code, password: NEW_PASSWORD })
    expect(activation.status).toBe(204)

    const session = await anonClient().auth.signInWithPassword({ email, password: NEW_PASSWORD })
    expect(session.error).toBeNull()

    // And the session reads its own authority from the table rather than from
    // the token, which since multi-outlet-people carries none of it.
    const claims = JSON.parse(
      Buffer.from(session.data.session!.access_token.split('.')[1]!, 'base64url').toString('utf8'),
    ) as Record<string, unknown>
    expect(claims['app_role']).toBeUndefined()
    expect(claims['app_outlet_id']).toBeUndefined()

    const { data: mine } = (await session.data.session!.user)
      ? await createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
          auth: { persistSession: false, autoRefreshToken: false },
          global: {
            headers: { Authorization: `Bearer ${session.data.session!.access_token}` },
          },
        })
          .from('assignments')
          .select('role, outlet_id, ended_on')
          .eq('person_id', result.body.profileId)
      : { data: null }
    expect(mine).toEqual([{ role: 'employee', outlet_id: OUTLETS.kalyani, ended_on: null }])
  })

  it('accepts a code however sloppily it was retyped', async () => {
    const { result } = await provisionAs(superAdminToken)
    const mangled = ` ${result.body.code.toLowerCase().replace('-', '  ')} `

    expect((await redeem({ code: mangled, password: NEW_PASSWORD })).status).toBe(204)
  })

  it('creates one person at two outlets, then the one returned code activates', async () => {
    const { email, result } = await provisionAs(superAdminToken, {
      outletIds: [OUTLETS.kalyani, OUTLETS.kanchrapara],
      fullName: 'Probe Two Outlets',
    })
    expect(result.status).toBe(201)
    expect(result.body.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/)

    expect((await redeem({ code: result.body.code, password: NEW_PASSWORD })).status).toBe(204)
    const signedIn = await anonClient().auth.signInWithPassword({
      email,
      password: NEW_PASSWORD,
    })
    expect(signedIn.error).toBeNull()

    const client = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        headers: { Authorization: `Bearer ${signedIn.data.session!.access_token}` },
      },
    })
    const { data: assignments } = await client
      .from('assignments')
      .select('role, outlet_id, ended_on')
      .eq('person_id', result.body.profileId)
      .order('outlet_id')
    expect(assignments).toEqual([
      { role: 'employee', outlet_id: OUTLETS.kalyani, ended_on: null },
      { role: 'employee', outlet_id: OUTLETS.kanchrapara, ended_on: null },
    ])
  })

  it('refuses a case-equivalent duplicate username without creating anything', async () => {
    const duplicate = await adminAccounts(superAdminToken, {
      action: 'provision',
      fullName: 'Impostor',
      username: 'STAFF.KALYANI',
      role: 'employee',
      outletIds: [OUTLETS.kalyani],
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

  it('refuses a Franchise Admin reaching into the other outlet before creating anything', async () => {
    const { username, result } = await provisionAs(faKalyaniToken, {
      outletIds: [OUTLETS.kalyani, OUTLETS.kanchrapara],
    })
    expect(result.status).toBe(403)

    // The same username remains available to the owner, proving the refused
    // mixed-authority request did not reserve an Auth alias.
    const retried = await adminAccounts<Provisioned>(superAdminToken, {
      action: 'provision',
      fullName: 'Owner Retry',
      username,
      role: 'employee',
      outletIds: [OUTLETS.kanchrapara],
    })
    expect(retried.status).toBe(201)
  })

  it('rejects a malformed outlet set before reserving the username', async () => {
    const username = freshUsername('malformed')
    const refused = await adminAccounts(superAdminToken, {
      action: 'provision',
      fullName: 'Malformed Outlet',
      username,
      role: 'employee',
      outletIds: ['not-an-outlet-id'],
    })
    expect(refused.status).toBe(400)

    const retried = await adminAccounts<Provisioned>(superAdminToken, {
      action: 'provision',
      fullName: 'Valid Retry',
      username,
      role: 'employee',
      outletIds: [OUTLETS.kalyani],
    })
    expect(retried.status).toBe(201)
  })

  it.each(['super_admin', 'franchise_admin'] as const)(
    'refuses a Franchise Admin minting a %s',
    async (role) => {
      const { result } = await provisionAs(faKalyaniToken, {
        role,
        outletIds: role === 'super_admin' ? [] : [OUTLETS.kalyani],
      })
      expect(result.status).toBe(403)
    },
  )

  it('refuses an outlet-scoped role with no outlet, and a Super Admin with one', async () => {
    expect((await provisionAs(superAdminToken, { outletIds: [] })).result.status).toBe(403)
    expect(
      (
        await provisionAs(superAdminToken, {
          role: 'super_admin',
          outletIds: [OUTLETS.kalyani],
        })
      ).result.status,
    ).toBe(403)
  })

  it('lets the Super Admin provision into either outlet', async () => {
    for (const outletId of [OUTLETS.kalyani, OUTLETS.kanchrapara]) {
      const { result } = await provisionAs(superAdminToken, { outletIds: [outletId] })
      expect(result.status).toBe(201)
    }
  })

  it('refuses a Franchise Admin managing another outlet’s account', async () => {
    const { result: theirs } = await provisionAs(superAdminToken, {
      outletIds: [OUTLETS.kanchrapara],
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
    expect((await redeem({ code: result.body.code, password: NEW_PASSWORD })).status).toBe(204)

    const replay = await redeem({ code: result.body.code, password: 'yet-another-password' })
    expect(replay.status).toBe(400)

    // And the password from the first, legitimate activation still stands.
    const session = await anonClient().auth.signInWithPassword({ email, password: NEW_PASSWORD })
    expect(session.error).toBeNull()
  })

  it('stops working the moment a replacement is issued', async () => {
    const { result } = await provisionAs(superAdminToken)
    const reissued = await adminAccounts<Provisioned>(superAdminToken, {
      action: 'reissue',
      profileId: result.body.profileId,
    })
    expect(reissued.status).toBe(200)
    expect(reissued.body.code).not.toBe(result.body.code)

    expect((await redeem({ code: result.body.code, password: NEW_PASSWORD })).status).toBe(400)
    expect((await redeem({ code: reissued.body.code, password: NEW_PASSWORD })).status).toBe(204)
  })

  it('is not disabled by somebody else guessing at it', async () => {
    const { result } = await provisionAs(superAdminToken)

    // The old per-invite ceiling made this the opposite: five wrong guesses
    // aimed at one account killed that account's outstanding code, so a
    // targeted guesser could lock a new starter out of their own activation
    // over and over. Keyed on the code, a wrong guess matches no invite at all
    // and there is nothing for it to burn.
    for (let attempt = 0; attempt < 5; attempt++) {
      expect(
        (
          await redeem({
            code: 'ZZZZZ-ZZZZZ',
            username: 'some.person',
            password: NEW_PASSWORD,
          })
        ).status,
      ).toBe(400)
    }

    expect((await redeem({ code: result.body.code, password: NEW_PASSWORD })).status).toBe(204)
  })

  it('reveals nothing: every failure looks the same', async () => {
    const { result } = await provisionAs(superAdminToken)
    const spent = await provisionAs(superAdminToken)
    expect((await redeem({ code: spent.result.body.code, password: NEW_PASSWORD })).status).toBe(
      204,
    )

    const failures = await Promise.all([
      // A code that never existed, one that has been spent, and one belonging
      // to a deactivated account: three different truths, one answer.
      redeem({ code: 'ZZZZZ-ZZZZZ', username: 'some.person', password: NEW_PASSWORD }),
      redeem({ code: spent.result.body.code, password: NEW_PASSWORD }),
      deactivateThenRedeem(result.body),
    ])

    const shapes = new Set(failures.map((f) => `${f.status}:${JSON.stringify(f.body)}`))
    expect(shapes.size).toBe(1)
    expect(failures[0]!.status).toBe(400)
  })

  async function deactivateThenRedeem(provisioned: Provisioned): Promise<FnResult> {
    await adminAccounts(superAdminToken, {
      action: 'set-active',
      profileId: provisioned.profileId,
      isActive: false,
    })
    return await redeem({ code: provisioned.code, password: NEW_PASSWORD })
  }

  it('refuses a short password before consuming anything', async () => {
    const { result } = await provisionAs(superAdminToken)

    const weak = await redeem({ code: result.body.code, password: 'short' })
    expect(weak.status).toBe(400)
    expect(weak.body['error']).toBe('weak_password')

    // The code survived the fumble, and so did the person's allowance: a
    // password checked before anything is looked up records no failure.
    expect((await redeem({ code: result.body.code, password: NEW_PASSWORD })).status).toBe(204)
  })
})

describe('assignment changes and outstanding activation links', () => {
  it('grants, replaces the pending code in the same action, and returns the replacement', async () => {
    const { email, result } = await provisionAs(superAdminToken)

    const changed = await adminAccounts<AssignmentChanged>(superAdminToken, {
      action: 'assign',
      personId: result.body.profileId,
      role: 'employee',
      outletId: OUTLETS.kanchrapara,
    })
    expect(changed.status).toBe(201)
    expect(changed.body.assignmentId).toBeTruthy()
    expect(changed.body.issuedCode?.profileId).toBe(result.body.profileId)
    expect(changed.body.issuedCode?.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/)
    expect(changed.body.issuedCode?.code).not.toBe(result.body.code)

    expect((await redeem({ code: result.body.code, password: NEW_PASSWORD })).status).toBe(400)
    expect(
      await redeem({
        code: changed.body.issuedCode!.code,
        password: NEW_PASSWORD,
      }),
    ).toMatchObject({ status: 204 })

    const signedIn = await anonClient().auth.signInWithPassword({
      email,
      password: NEW_PASSWORD,
    })
    const { data: assignments } = await clientWithToken(signedIn.data.session!.access_token)
      .from('assignments')
      .select('outlet_id, ended_on')
      .eq('person_id', result.body.profileId)
      .order('outlet_id')
    expect(assignments).toEqual([
      { outlet_id: OUTLETS.kalyani, ended_on: null },
      { outlet_id: OUTLETS.kanchrapara, ended_on: null },
    ])
  })

  it('ends, replaces the pending code in the same action, and returns the replacement', async () => {
    const { result } = await provisionAs(superAdminToken, {
      outletIds: [OUTLETS.kalyani, OUTLETS.kanchrapara],
    })
    const owner = clientWithToken(superAdminToken)
    const { data: rows } = await owner
      .from('assignments')
      .select('id')
      .eq('person_id', result.body.profileId)
      .eq('outlet_id', OUTLETS.kanchrapara)
      .is('ended_on', null)
    expect(rows).toHaveLength(1)

    const changed = await adminAccounts<AssignmentChanged>(superAdminToken, {
      action: 'end-assignment',
      assignmentId: rows![0]!.id,
    })
    expect(changed.status).toBe(200)
    expect(changed.body.issuedCode?.profileId).toBe(result.body.profileId)
    expect(changed.body.issuedCode?.code).not.toBe(result.body.code)

    expect((await redeem({ code: result.body.code, password: NEW_PASSWORD })).status).toBe(400)
    expect(
      await redeem({
        code: changed.body.issuedCode!.code,
        password: NEW_PASSWORD,
      }),
    ).toMatchObject({ status: 204 })

    const { data: ended } = await owner
      .from('assignments')
      .select('ended_on')
      .eq('id', rows![0]!.id)
      .single()
    expect(ended?.ended_on).not.toBeNull()
  })

  it('changes an activated person without manufacturing a reset code', async () => {
    const { result } = await provisionAs(superAdminToken)
    expect((await redeem({ code: result.body.code, password: NEW_PASSWORD })).status).toBe(204)

    const changed = await adminAccounts<AssignmentChanged>(superAdminToken, {
      action: 'assign',
      personId: result.body.profileId,
      role: 'employee',
      outletId: OUTLETS.kanchrapara,
    })
    expect(changed.status).toBe(201)
    expect(changed.body.issuedCode).toBeNull()
  })
})

describe('atomic account editing over the privileged boundary', () => {
  it('refuses self-edit and FA edits of administrator or out-of-scope complete sets', async () => {
    const ownerIdentifiers = await identifiersFor(superAdminToken)
    const ownerAssignments = await liveAssignments(PERSON_IDS.superAdmin)
    const self = await adminAccounts<{ error: string }>(superAdminToken, {
      action: 'edit-account',
      profileId: PERSON_IDS.superAdmin,
      expectedStateFingerprint: ownerIdentifiers[PERSON_IDS.superAdmin]!.stateFingerprint,
      fullName: 'Must not rename self',
      phone: null,
      roleTitle: null,
      accountEmail: ownerIdentifiers[PERSON_IDS.superAdmin]!.accountEmail,
      assignments: ownerAssignments,
    })
    expect(self).toEqual({ status: 403, body: { error: 'forbidden' } })

    for (const profileId of [PERSON_IDS.faKalyani, PERSON_IDS.superAdmin, PERSON_IDS.splitStaff]) {
      const assignments = await liveAssignments(profileId)
      const refused = await adminAccounts<{ error: string }>(faKalyaniToken, {
        action: 'edit-account',
        profileId,
        expectedStateFingerprint: ownerIdentifiers[profileId]!.stateFingerprint,
        fullName: 'Must not cross the boundary',
        phone: null,
        roleTitle: null,
        accountEmail: null,
        assignments,
      })
      expect(refused).toEqual({ status: 403, body: { error: 'forbidden' } })
    }
  })

  it('promotes Employee to Biller without deactivation or history loss', async () => {
    const { result } = await provisionAs(superAdminToken)
    expect((await redeem({ code: result.body.code, password: NEW_PASSWORD })).status).toBe(204)
    const before = await liveAssignments(result.body.profileId)
    const fingerprint = (await identifiersFor(superAdminToken))[result.body.profileId]!
      .stateFingerprint

    const changed = await adminAccounts<AssignmentSetResult>(superAdminToken, {
      action: 'edit-account',
      profileId: result.body.profileId,
      expectedStateFingerprint: fingerprint,
      fullName: 'Probe Staff Promoted',
      phone: null,
      roleTitle: 'Counter Biller',
      accountEmail: null,
      assignments: [{ ...before[0]!, role: 'biller' }],
    })
    expect(changed).toMatchObject({
      status: 200,
      body: {
        profileId: result.body.profileId,
        stateFingerprint: expect.any(String),
        replacementHandover: null,
      },
    })

    const owner = clientWithToken(superAdminToken)
    const [{ data: profile }, { data: history }] = await Promise.all([
      owner
        .from('profiles')
        .select('full_name, role_title, is_active')
        .eq('id', result.body.profileId)
        .single(),
      owner
        .from('assignments')
        .select('id, role, ended_on')
        .eq('person_id', result.body.profileId)
        .order('created_at'),
    ])
    expect(profile).toEqual({
      full_name: 'Probe Staff Promoted',
      role_title: 'Counter Biller',
      is_active: true,
    })
    expect(history).toEqual([
      expect.objectContaining({
        id: before[0]!.assignmentId,
        role: 'employee',
        ended_on: expect.any(String),
      }),
      expect.objectContaining({ role: 'biller', ended_on: null }),
    ])
  })

  it('transfers outlets in one save and rejects reuse of the stale fingerprint', async () => {
    const { result } = await provisionAs(superAdminToken)
    const before = await liveAssignments(result.body.profileId)
    const fingerprint = (await identifiersFor(superAdminToken))[result.body.profileId]!
      .stateFingerprint
    const command = {
      action: 'edit-account',
      profileId: result.body.profileId,
      expectedStateFingerprint: fingerprint,
      fullName: 'Probe Staff Transferred',
      phone: null,
      roleTitle: null,
      accountEmail: null,
      assignments: [{ ...before[0]!, outletId: OUTLETS.kanchrapara }],
    }
    expect((await adminAccounts(superAdminToken, command)).status).toBe(200)

    const stale = await adminAccounts<{ error: string }>(superAdminToken, {
      ...command,
      fullName: 'This must roll back',
    })
    expect(stale).toEqual({ status: 409, body: { error: 'stale_edit' } })

    const owner = clientWithToken(superAdminToken)
    const { data: profile } = await owner
      .from('profiles')
      .select('full_name, is_active')
      .eq('id', result.body.profileId)
      .single()
    expect(profile).toEqual({ full_name: 'Probe Staff Transferred', is_active: true })
    expect(await liveAssignments(result.body.profileId)).toEqual([
      expect.objectContaining({ outletId: OUTLETS.kanchrapara, role: 'employee' }),
    ])
  })

  it('marks a person as left atomically through the dedicated action', async () => {
    const { result } = await provisionAs(superAdminToken, {
      outletIds: [OUTLETS.kalyani, OUTLETS.kanchrapara],
    })
    const fingerprint = (await identifiersFor(superAdminToken))[result.body.profileId]!
      .stateFingerprint
    const left = await adminAccounts<AssignmentSetResult>(superAdminToken, {
      action: 'mark-as-left',
      profileId: result.body.profileId,
      expectedStateFingerprint: fingerprint,
    })
    expect(left).toMatchObject({
      status: 200,
      body: {
        profileId: result.body.profileId,
        assignments: [],
        replacementHandover: null,
      },
    })
    const owner = clientWithToken(superAdminToken)
    const { data: profile } = await owner
      .from('profiles')
      .select('is_active')
      .eq('id', result.body.profileId)
      .single()
    expect(profile?.is_active).toBe(false)
    expect(await liveAssignments(result.body.profileId)).toEqual([])
  })

  it('rolls back the whole request when an FA includes an unmanaged outlet', async () => {
    const { result } = await provisionAs(superAdminToken)
    const beforeAssignments = await liveAssignments(result.body.profileId)
    const beforeIdentifier = (await identifiersFor(superAdminToken))[result.body.profileId]!
    const refused = await adminAccounts<{ error: string }>(faKalyaniToken, {
      action: 'edit-account',
      profileId: result.body.profileId,
      expectedStateFingerprint: beforeIdentifier.stateFingerprint,
      fullName: 'Must not partially change',
      phone: '9999999999',
      roleTitle: 'Must not persist',
      accountEmail: null,
      assignments: [
        beforeAssignments[0],
        {
          assignmentId: null,
          outletId: OUTLETS.kanchrapara,
          role: 'employee',
          startedOn: beforeAssignments[0]!.startedOn,
        },
      ],
    })
    expect(refused).toEqual({ status: 403, body: { error: 'forbidden' } })

    const owner = clientWithToken(superAdminToken)
    const { data: profile } = await owner
      .from('profiles')
      .select('full_name, phone, role_title, is_active')
      .eq('id', result.body.profileId)
      .single()
    expect(profile).toEqual({
      full_name: 'Probe Staff',
      phone: null,
      role_title: null,
      is_active: true,
    })
    expect(await liveAssignments(result.body.profileId)).toEqual(beforeAssignments)
    expect((await identifiersFor(superAdminToken))[result.body.profileId]).toEqual(beforeIdentifier)
  })
})

describe('purpose-aware handover issuance and preservation', () => {
  it('replaces only a live activation handover after the final assignment set exists', async () => {
    const { result } = await provisionAs(superAdminToken)
    const identifier = (await identifiersFor(superAdminToken))[result.body.profileId]!
    const assignments = await liveAssignments(result.body.profileId)
    const changed = await adminAccounts<AssignmentSetResult>(superAdminToken, {
      action: 'edit-account',
      profileId: result.body.profileId,
      expectedStateFingerprint: identifier.stateFingerprint,
      fullName: 'Probe Staff',
      phone: null,
      roleTitle: null,
      accountEmail: null,
      assignments: [
        assignments[0],
        {
          assignmentId: null,
          outletId: OUTLETS.kanchrapara,
          role: 'employee',
          startedOn: assignments[0]!.startedOn,
        },
      ],
    })
    expect(changed).toMatchObject({
      status: 200,
      body: {
        replacementHandover: {
          profileId: result.body.profileId,
          purpose: 'activation',
          code: expect.any(String),
        },
      },
    })
    expect(changed.body.replacementHandover!.code).not.toBe(result.body.code)
    expect((await redeem({ code: result.body.code, password: NEW_PASSWORD })).status).toBe(400)
    expect(
      (
        await redeem({
          code: changed.body.replacementHandover!.code,
          password: NEW_PASSWORD,
        })
      ).status,
    ).toBe(204)
    expect((await liveAssignments(result.body.profileId)).map((row) => row.outletId)).toEqual([
      OUTLETS.kalyani,
      OUTLETS.kanchrapara,
    ])
  })

  it('issues activation before first sign-in and password reset afterwards', async () => {
    const { username, result } = await provisionAs(superAdminToken)
    expect(result.body.purpose).toBe('activation')
    const setup = await adminAccounts<Provisioned & { purpose: 'activation' }>(superAdminToken, {
      action: 'issue-handover',
      profileId: result.body.profileId,
    })
    expect(setup).toMatchObject({
      status: 200,
      body: { profileId: result.body.profileId, username, purpose: 'activation' },
    })
    expect((await redeem({ code: result.body.code, password: NEW_PASSWORD })).status).toBe(400)
    expect((await redeem({ code: setup.body.code, password: NEW_PASSWORD })).status).toBe(204)
    expect(
      (
        await anonClient().auth.signInWithPassword({
          email: authAlias(username),
          password: NEW_PASSWORD,
        })
      ).error,
    ).toBeNull()

    const reset = await adminAccounts<Provisioned & { purpose: 'password_reset' }>(
      superAdminToken,
      {
        action: 'issue-handover',
        profileId: result.body.profileId,
      },
    )
    expect(reset).toMatchObject({
      status: 200,
      body: { profileId: result.body.profileId, username, purpose: 'password_reset' },
    })
    expect((await identifiersFor(superAdminToken))[result.body.profileId]).toMatchObject({
      hasSignedIn: true,
      invite: { purpose: 'password_reset', expiresAt: reset.body.expiresAt },
    })
  })

  it('preserves a live reset handover through an assignment edit', async () => {
    const { username, result } = await provisionAs(superAdminToken)
    await redeem({ code: result.body.code, password: NEW_PASSWORD })
    await anonClient().auth.signInWithPassword({
      email: authAlias(username),
      password: NEW_PASSWORD,
    })
    const reset = await adminAccounts<Provisioned & { purpose: 'password_reset' }>(
      superAdminToken,
      {
        action: 'issue-handover',
        profileId: result.body.profileId,
      },
    )
    const identifier = (await identifiersFor(superAdminToken))[result.body.profileId]!
    const assignments = await liveAssignments(result.body.profileId)
    const changed = await adminAccounts<AssignmentSetResult>(superAdminToken, {
      action: 'edit-account',
      profileId: result.body.profileId,
      expectedStateFingerprint: identifier.stateFingerprint,
      fullName: 'Probe Staff',
      phone: null,
      roleTitle: null,
      accountEmail: null,
      assignments: [{ ...assignments[0]!, role: 'biller' }],
    })
    expect(changed.status).toBe(200)
    expect(changed.body.replacementHandover).toBeNull()
    expect(
      (await redeem({ code: reset.body.code, username, password: 'reset-after-edit-password' }))
        .status,
    ).toBe(204)
  })

  it('refuses issuance while the account is inactive', async () => {
    const { result } = await provisionAs(superAdminToken)
    await adminAccounts(superAdminToken, {
      action: 'set-active',
      profileId: result.body.profileId,
      isActive: false,
    })
    expect(
      await adminAccounts(superAdminToken, {
        action: 'issue-handover',
        profileId: result.body.profileId,
      }),
    ).toEqual({ status: 409, body: { error: 'account_inactive' } })
  })
})

describe('canonical account-boundary failures', () => {
  it('distinguishes invalid sessions from verified forbidden callers', async () => {
    expect(await adminAccounts(null, { action: 'identifiers' })).toEqual({
      status: 401,
      body: { error: 'session_invalid' },
    })
    // A syntactically valid public credential reaches the function but is not
    // a human session. Kong rejects malformed JWT text before any function can
    // normalize its body, so the boundary we control is proved with anon.
    expect(await adminAccounts(SUPABASE_ANON_KEY, { action: 'identifiers' })).toEqual({
      status: 401,
      body: { error: 'session_invalid' },
    })
    const biller = await tokenFor(PERSONAS.billerKalyani)
    expect(await adminAccounts(biller, { action: 'identifiers' })).toEqual({
      status: 403,
      body: { error: 'forbidden' },
    })
  })
})

describe('deactivation, without waiting for a token to expire', () => {
  it('blocks a live session at the next request', async () => {
    const { email, result } = await provisionAs(superAdminToken)
    await redeem({ code: result.body.code, password: NEW_PASSWORD })

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
    await redeem({ code: result.body.code, password: NEW_PASSWORD })
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
    await redeem({ code: result.body.code, password: NEW_PASSWORD })
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

    // An invite carries no outlet since multi-outlet-people — it is about a
    // person — so what scopes it is who may manage that person.
    const kalyani = await clientFor(PERSONAS.faKalyani)
    const { data: own } = await kalyani
      .from('account_invites')
      .select('id, profile_id')
      .eq('profile_id', result.body.profileId)
    expect(own).toHaveLength(1)

    const kanchrapara = await clientFor(PERSONAS.faKanchrapara)
    const { data: theirs } = await kanchrapara
      .from('account_invites')
      .select('id, profile_id')
      .eq('profile_id', result.body.profileId)
    expect(theirs).toEqual([])

    for (const client of [kalyani, await clientFor(PERSONAS.superAdmin)]) {
      const { error } = await client.from('account_invites').select('code_hash')
      expect(error?.code).toBe('42501')
    }
  })
})

/**
 * The username an account signs in with: readable by the admins who manage it,
 * correctable by them, and — the part that matters most — unreachable from the
 * counter tablet.
 *
 * A Biller is a shared device that whoever is standing at it can pick up.
 * Colleagues' sign-in identifiers must not be ambient on it, which is why the
 * username is never mirrored onto `public.profiles` (a Biller may read their
 * own outlet's profiles) and why this function refuses the request outright
 * rather than answering it with an empty object.
 */
describe('usernames and private Super Admin account emails', () => {
  it('is refused for a Biller — the counter tablet asks and is told no', async () => {
    const biller = await tokenFor(PERSONAS.billerKalyani)
    const result = await adminAccounts<{ error: string }>(biller, { action: 'identifiers' })

    expect(result.status).toBe(403)
    expect(result.body.error).toBe('forbidden')
    // Not "an empty list": a boundary that merely happens to hold is not one.
    expect(result.body).not.toHaveProperty('identifiers')
  })

  it('is refused for an Employee too', async () => {
    const employee = await tokenFor(PERSONAS.employeeKalyani)
    expect((await adminAccounts(employee, { action: 'identifiers' })).status).toBe(403)
  })

  it('gives a Franchise Admin their own outlet, and nothing across the boundary', async () => {
    const { username, result } = await provisionAs(faKalyaniToken)
    expect(result.status).toBe(201)

    const seen = await adminAccounts<{
      identifiers: Record<string, { username: string; accountEmail: string | null }>
    }>(faKalyaniToken, {
      action: 'identifiers',
    })
    expect(seen.status).toBe(200)

    const identifiers = Object.values(seen.body.identifiers)
    expect(identifiers).toContainEqual(expect.objectContaining({ username, accountEmail: null }))
    // The other outlet's manager and staff are outside this caller's authority.
    expect(identifiers.map((item) => item.username)).not.toContain('admin.kanchrapara')
    expect(identifiers.map((item) => item.username)).not.toContain('staff.kanchrapara')
  })

  it('gives the Super Admin every outlet', async () => {
    const seen = await adminAccounts<{
      identifiers: Record<string, { username: string; accountEmail: string | null }>
    }>(superAdminToken, {
      action: 'identifiers',
    })
    const identifiers = Object.values(seen.body.identifiers)

    expect(identifiers.map((item) => item.username)).toContain('admin.kalyani')
    expect(identifiers.map((item) => item.username)).toContain('admin.kanchrapara')
    expect(identifiers.find((item) => item.username === 'admin.kalyani')?.accountEmail).toBeNull()
    expect(identifiers.find((item) => item.username === 'owner')?.accountEmail).toBe(
      'owner.account@example.com',
    )
  })

  it('corrects a mistyped username, and the code already sent still works', async () => {
    // The situation this exists for: an owner fat-fingers a staff username, and
    // the person is left with a code that refuses them and no way to find out
    // why. Everything below is the recovery, entirely through the API.
    const typo = freshUsername('typo')
    const provisioned = await adminAccounts<Provisioned>(faKalyaniToken, {
      action: 'provision',
      fullName: 'Probe Mistyped',
      username: typo,
      role: 'employee',
      outletIds: [OUTLETS.kalyani],
    })
    expect(provisioned.status).toBe(201)

    const corrected = freshUsername('corrected')
    const change = await adminAccounts(faKalyaniToken, {
      action: 'set-username',
      profileId: provisioned.body.profileId,
      username: corrected,
    })
    expect(change.status).toBe(200)

    // The code is bound to the account rather than to the username, so the
    // message the admin already sent still works — and the person who opens it
    // is shown the corrected username rather than the typo.
    const preview = await redeem({ action: 'preview', code: provisioned.body.code })
    expect(preview.status).toBe(200)
    expect(preview.body['username']).toBe(corrected)
    expect(preview.body['username']).not.toBe(typo)

    expect(
      (
        await redeem({
          code: provisioned.body.code,
          username: corrected,
          password: NEW_PASSWORD,
        })
      ).status,
    ).toBe(204)

    const session = await anonClient().auth.signInWithPassword({
      email: authAlias(corrected),
      password: NEW_PASSWORD,
    })
    expect(session.error).toBeNull()
  })

  it('keeps an open session through a rename while only the new username signs in', async () => {
    const { username, email, result } = await provisionAs(faKalyaniToken)
    expect(
      (await redeem({ code: result.body.code, username, password: NEW_PASSWORD })).status,
    ).toBe(204)
    const openClient = anonClient()
    const signedIn = await openClient.auth.signInWithPassword({
      email,
      password: NEW_PASSWORD,
    })
    expect(signedIn.error).toBeNull()

    const renamed = freshUsername('renamed')
    expect(
      (
        await adminAccounts(faKalyaniToken, {
          action: 'set-username',
          profileId: result.body.profileId,
          username: renamed,
        })
      ).status,
    ).toBe(200)

    const sameSession = await openClient
      .from('profiles')
      .select('id')
      .eq('id', result.body.profileId)
    expect(sameSession.data).toEqual([{ id: result.body.profileId }])
    expect(
      (
        await anonClient().auth.signInWithPassword({
          email,
          password: NEW_PASSWORD,
        })
      ).error,
    ).not.toBeNull()
    expect(
      (
        await anonClient().auth.signInWithPassword({
          email: authAlias(renamed),
          password: NEW_PASSWORD,
        })
      ).error,
    ).toBeNull()
  })

  it('lets an admin-issued replacement link reset staff without staff email', async () => {
    const { username, email, result } = await provisionAs(faKalyaniToken)
    expect(
      (await redeem({ code: result.body.code, username, password: NEW_PASSWORD })).status,
    ).toBe(204)

    const replacement = await adminAccounts<Provisioned>(faKalyaniToken, {
      action: 'reissue',
      profileId: result.body.profileId,
    })
    expect(replacement.status).toBe(200)
    const resetPassword = 'a-replacement-password'
    expect(
      (
        await redeem({
          code: replacement.body.code,
          username,
          password: resetPassword,
        })
      ).status,
    ).toBe(204)
    expect(
      (
        await anonClient().auth.signInWithPassword({
          email,
          password: NEW_PASSWORD,
        })
      ).error,
    ).not.toBeNull()
    expect(
      (
        await anonClient().auth.signInWithPassword({
          email,
          password: resetPassword,
        })
      ).error,
    ).toBeNull()
  })

  it('refuses a username another account already holds', async () => {
    const { result } = await provisionAs(faKalyaniToken)
    const clash = await adminAccounts<{ error: string }>(faKalyaniToken, {
      action: 'set-username',
      profileId: result.body.profileId,
      username: 'STAFF.KALYANI',
    })

    expect(clash.status).toBe(409)
    expect(clash.body.error).toBe('username_unavailable')
  })

  it('refuses a correction across the outlet boundary', async () => {
    const kanchrapara = await provisionAs(superAdminToken, {
      outletIds: [OUTLETS.kanchrapara],
      fullName: 'Probe Other Outlet',
    })

    const reach = await adminAccounts<{ error: string }>(faKalyaniToken, {
      action: 'set-username',
      profileId: kanchrapara.result.body.profileId,
      username: freshUsername('stolen'),
    })

    expect(reach.status).toBe(403)
    expect(reach.body.error).toBe('forbidden')
  })

  it('refuses a Biller trying to change anybody’s username', async () => {
    const biller = await tokenFor(PERSONAS.billerKalyani)
    const { result } = await provisionAs(faKalyaniToken)

    expect(
      (
        await adminAccounts(biller, {
          action: 'set-username',
          profileId: result.body.profileId,
          username: freshUsername('nope'),
        })
      ).status,
    ).toBe(403)
  })
})

describe('Super Admin account-email invariants over the privileged boundary', () => {
  it('requires the email, keeps it private, and cleans up a duplicate refusal', async () => {
    const username = freshUsername('owner')
    const accountEmail = `probe.owner.${RUN}.${seq++}@example.com`
    const missing = await adminAccounts(superAdminToken, {
      action: 'provision',
      fullName: 'Probe Owner Missing Email',
      username,
      role: 'super_admin',
      outletIds: [],
    })
    expect(missing.status).toBe(400)

    const created = await adminAccounts<Provisioned>(superAdminToken, {
      action: 'provision',
      fullName: 'Probe Owner',
      username,
      role: 'super_admin',
      outletIds: [],
      accountEmail,
    })
    expect(created.status).toBe(201)

    const identifiers = await adminAccounts<{
      identifiers: Record<string, { username: string; accountEmail: string | null }>
    }>(superAdminToken, { action: 'identifiers' })
    expect(identifiers.body.identifiers[created.body.profileId]).toEqual(
      expect.objectContaining({ username, accountEmail }),
    )

    const duplicateUsername = freshUsername('owndup')
    const duplicate = await adminAccounts<{ error: string }>(superAdminToken, {
      action: 'provision',
      fullName: 'Probe Owner Duplicate Email',
      username: duplicateUsername,
      role: 'super_admin',
      outletIds: [],
      accountEmail,
    })
    expect(duplicate).toMatchObject({
      status: 409,
      body: { error: 'email_unavailable' },
    })

    const retried = await adminAccounts<Provisioned>(superAdminToken, {
      action: 'provision',
      fullName: 'Probe Owner Retry',
      username: duplicateUsername,
      role: 'super_admin',
      outletIds: [],
      accountEmail: `probe.owner.retry.${RUN}.${seq++}@example.com`,
    })
    expect(retried.status).toBe(201)
  })

  it('cannot grant the owner role without its email, and retains it when that role ends', async () => {
    const { username, result } = await provisionAs(superAdminToken)
    expect((await redeem({ code: result.body.code, password: NEW_PASSWORD })).status).toBe(204)
    const refused = await adminAccounts(superAdminToken, {
      action: 'assign',
      personId: result.body.profileId,
      role: 'super_admin',
      outletId: null,
    })
    expect(refused.status).toBe(400)

    const ownerRowsBefore = await clientWithToken(superAdminToken)
      .from('assignments')
      .select('id')
      .eq('person_id', result.body.profileId)
      .eq('role', 'super_admin')
      .is('ended_on', null)
    expect(ownerRowsBefore.data).toEqual([])

    const accountEmail = `probe.grant.${RUN}.${seq++}@example.com`
    const granted = await adminAccounts<AssignmentChanged>(superAdminToken, {
      action: 'assign',
      personId: result.body.profileId,
      role: 'super_admin',
      outletId: null,
      accountEmail,
    })
    expect(granted.status).toBe(201)

    const ended = await adminAccounts(superAdminToken, {
      action: 'end-assignment',
      assignmentId: granted.body.assignmentId,
    })
    expect(ended.status).toBe(200)

    const identifiers = await adminAccounts<{
      identifiers: Record<string, { username: string; accountEmail: string | null }>
    }>(superAdminToken, { action: 'identifiers' })
    expect(identifiers.body.identifiers[result.body.profileId]).toEqual(
      expect.objectContaining({ username, accountEmail: null }),
    )

    const retained = await emailSignIn(accountEmail, NEW_PASSWORD, '198.51.100.45')
    expect(retained.status).toBe(200)
  })
})
