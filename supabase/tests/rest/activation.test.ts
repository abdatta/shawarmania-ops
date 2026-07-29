/**
 * Activation as a person actually performs it: open a link, look at an
 * address, choose a password. Over real HTTP, through Kong, through the Edge
 * Function, through GoTrue.
 *
 * The pgTAP suite (supabase/tests/10_activation.sql) proves the semantics
 * inside the database, where the rate-limit arithmetic can be set up exactly.
 * This proves the deployed pieces agree — including the parts only HTTP has:
 * the `action` shape, the status codes a client branches on, and the
 * `x-forwarded-for` plumbing the per-address limit rides on.
 *
 * The global bound is deliberately NOT exercised here. It is shared with every
 * other suite that produces a failure, and a test that spends a shared budget
 * makes its neighbours flaky. The per-address bound is self-contained, because
 * this file makes up its own addresses.
 *
 * Requires the local stack: `npm run db:start && npm run db:reset`, then
 * `npm run test:rls`.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '../../../src/data-access/database.types'

const SUPABASE_URL = process.env['SUPABASE_URL'] ?? 'http://127.0.0.1:54321'
const SUPABASE_ANON_KEY =
  process.env['SUPABASE_ANON_KEY'] ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

const SEED_PASSWORD = 'shawarmania-local'
const NEW_PASSWORD = 'a-genuinely-set-password'
const OUTLET_KALYANI = '00000000-0000-4000-a000-000000000001'

type Client = SupabaseClient<Database>

/** Unique per run, so the suite is re-runnable without a database reset. */
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`
let seq = 0
const freshEmail = () => `activate.${RUN}.${seq++}@example.com`
/** A caller address of our own, so this file's failures land on nobody else. */
const freshIp = () => `203.0.113.${seq++ % 250}-${RUN}`

function anonClient(): Client {
  return createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

interface Result<T = Record<string, unknown>> {
  status: number
  body: T
}

/** The activation endpoint, which takes no session — that is the whole point. */
async function activation(
  payload: Record<string, unknown>,
  ip?: string,
): Promise<Result<{ email?: string; error?: string }>> {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/redeem-invite`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(ip ? { 'x-forwarded-for': ip } : {}),
    },
    body: JSON.stringify(payload),
  })
  const text = await response.text()
  return { status: response.status, body: text ? JSON.parse(text) : {} }
}

const preview = (code: string, ip?: string) => activation({ action: 'preview', code }, ip)
const redeem = (code: string, password: string, ip?: string) =>
  activation({ action: 'redeem', code, password }, ip)

let ownerToken: string

/** A brand-new account with an outstanding code, as an admin would make one. */
async function provision(): Promise<{ email: string; code: string; profileId: string }> {
  const email = freshEmail()
  const response = await fetch(`${SUPABASE_URL}/functions/v1/admin-accounts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${ownerToken}`,
    },
    body: JSON.stringify({
      action: 'provision',
      fullName: 'Probe Activation',
      email,
      role: 'employee',
      outletIds: [OUTLET_KALYANI],
    }),
  })
  expect(response.status).toBe(201)
  const body = (await response.json()) as { code: string; profileId: string }
  return { email, code: body.code, profileId: body.profileId }
}

beforeAll(async () => {
  const { data, error } = await anonClient().auth.signInWithPassword({
    email: 'owner@example.com',
    password: SEED_PASSWORD,
  })
  if (error || !data.session) throw new Error(`owner sign-in failed: ${error?.message}`)
  ownerToken = data.session.access_token
}, 60_000)

describe('opening the link', () => {
  it('resolves the code to the address, so nothing has to be typed', async () => {
    const { email, code } = await provision()

    const shown = await preview(code, freshIp())
    expect(shown.status).toBe(200)
    expect(shown.body.email).toBe(email)
  })

  it('leaves the code exactly as redeemable as it found it', async () => {
    const { code } = await provision()
    const ip = freshIp()

    // Three looks — somebody opening the link, closing it, opening it again.
    await preview(code, ip)
    await preview(code, ip)
    await preview(code, ip)

    expect((await redeem(code, NEW_PASSWORD, ip)).status).toBe(204)
  })

  it('says nothing about a code that is not live, whatever made it dead', async () => {
    const { code } = await provision()
    const spent = await provision()
    expect((await redeem(spent.code, NEW_PASSWORD, freshIp())).status).toBe(204)

    const ip = freshIp()
    const unknown = await preview('ZZZZZ-ZZZZZ', ip)
    const consumed = await preview(spent.code, ip)

    expect(unknown.status).toBe(400)
    expect(unknown.body.error).toBe('invalid_code')
    expect(JSON.stringify(consumed)).toBe(JSON.stringify(unknown))

    // …and the live one is untouched by the two failures beside it.
    expect((await preview(code, freshIp())).status).toBe(200)
  })
})

describe('setting the password', () => {
  it('takes a code and a password and nothing else', async () => {
    const { email, code } = await provision()

    expect((await redeem(code, NEW_PASSWORD, freshIp())).status).toBe(204)

    const session = await anonClient().auth.signInWithPassword({ email, password: NEW_PASSWORD })
    expect(session.error).toBeNull()
    expect(session.data.user?.email).toBe(email)
  })

  it('accepts a code however sloppily it was retyped', async () => {
    const { code } = await provision()
    // Lower case, the grouping mangled, spaces around it: what a code looks
    // like when somebody types it off a phone screen rather than tapping a link.
    const mangled = ` ${code.toLowerCase().replace('-', '  ')} `

    expect((await redeem(mangled, NEW_PASSWORD, freshIp())).status).toBe(204)
  })

  it('names the password when the password is the problem', async () => {
    const { code } = await provision()
    const ip = freshIp()

    const weak = await redeem(code, 'short', ip)
    expect(weak.status).toBe(400)
    expect(weak.body.error).toBe('weak_password')

    // Distinct from a dead code, which is the whole complaint this change
    // exists to answer: one field left, and it says which one was wrong.
    expect((await preview('ZZZZZ-ZZZZZ', ip)).body.error).toBe('invalid_code')
    expect((await redeem(code, NEW_PASSWORD, ip)).status).toBe(204)
  })
})

describe('the endpoint`s own bound', () => {
  it('refuses a caller who has failed twenty times, and says that is why', async () => {
    const { code } = await provision()
    const attacker = freshIp()

    for (let attempt = 0; attempt < 20; attempt++) {
      expect((await preview('ZZZZZ-ZZZZZ', attacker)).status).toBe(400)
    }

    const refused = await preview(code, attacker)
    expect(refused.status).toBe(429)
    expect(refused.body.error).toBe('rate_limited')
    // Rate limiting describes the caller, never an account — which is why it
    // is allowed to be specific where a code refusal is not.
    expect(refused.body.email).toBeUndefined()

    // Somebody else is unaffected, and the code they were guessing at is fine.
    expect((await preview(code, freshIp())).status).toBe(200)
    expect((await redeem(code, NEW_PASSWORD, freshIp())).status).toBe(204)
  }, 60_000)

  it('spends nothing on activations that work', async () => {
    const shop = freshIp()

    // A morning of onboarding from one connection: ten people, no failures.
    for (let person = 0; person < 10; person++) {
      const { code } = await provision()
      expect((await preview(code, shop)).status).toBe(200)
      expect((await redeem(code, NEW_PASSWORD, shop)).status).toBe(204)
    }

    // Still allowed — the eleventh person is not turned away for the shop
    // having been busy.
    const { code } = await provision()
    expect((await preview(code, shop)).status).toBe(200)
  }, 120_000)
})

describe('what a signed-in client may ask', () => {
  it('tells the owner how much failed activation there has been', async () => {
    const owner = anonClient()
    await owner.auth.signInWithPassword({ email: 'owner@example.com', password: SEED_PASSWORD })

    const { data, error } = await owner.rpc('invite_failure_pressure')
    expect(error).toBeNull()
    expect(typeof data).toBe('number')
  })

  it('refuses a manager, who has no business with a brand-wide signal', async () => {
    const manager = anonClient()
    await manager.auth.signInWithPassword({
      email: 'admin.kalyani@example.com',
      password: SEED_PASSWORD,
    })

    const { error } = await manager.rpc('invite_failure_pressure')
    expect(error).not.toBeNull()
  })

  it('refuses the counter tablet outright', async () => {
    const biller = anonClient()
    await biller.auth.signInWithPassword({
      email: 'biller.kalyani@example.com',
      password: SEED_PASSWORD,
    })

    const { error } = await biller.rpc('invite_failure_pressure')
    expect(error).not.toBeNull()
  })

  it('never exposes redemption itself as an RPC', async () => {
    // PostgREST would happily publish these to whoever held execute, and
    // preview in particular would become an address oracle.
    const { error } = await anonClient().rpc('preview_account_invite', {
      p_code_hash: 'whatever',
    })
    expect(error).not.toBeNull()
  })
})
