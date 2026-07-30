/**
 * Username activation and provider-alias protection over the real local
 * stack. The database suites prove the internals; this file proves Kong, Edge
 * Functions, and GoTrue agree on the wire contract.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '../../../src/data-access/database.types'

const SUPABASE_URL = process.env['SUPABASE_URL'] ?? 'http://127.0.0.1:54321'
const SUPABASE_ANON_KEY =
  process.env['SUPABASE_ANON_KEY'] ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYXNlLWRlbW8iLCJyb2xlIjoiYW5vbiIsImV4cCI6MTk4MzgxMjk5Nn0.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SEED_PASSWORD = 'shawarmania-local'
const NEW_PASSWORD = 'a-genuinely-set-password'
const OUTLET_KALYANI = '00000000-0000-4000-a000-000000000001'
const OWNER_ALIAS = 'owner@login.shawarmania.invalid'

type Client = SupabaseClient<Database>
interface Result<T = Record<string, unknown>> {
  status: number
  body: T
}

const RUN = Date.now().toString(36).slice(-8)
let sequence = 0
const freshUsername = () => `act.${RUN}.${sequence++}`
const authAlias = (username: string) => `${username}@login.shawarmania.invalid`
const freshIp = () => `203.0.113.${sequence++ % 250}-${RUN}`

function anonClient(): Client {
  return createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

async function callFunction<T = Record<string, unknown>>(
  name: string,
  payload: Record<string, unknown>,
  options: { token?: string; ip?: string; headers?: Record<string, string> } = {},
): Promise<Result<T>> {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.ip ? { 'x-forwarded-for': options.ip } : {}),
      ...(options.headers ?? {}),
    },
    body: JSON.stringify(payload),
  })
  const text = await response.text()
  return { status: response.status, body: (text ? JSON.parse(text) : {}) as T }
}

const preview = (code: string, ip?: string) =>
  callFunction<{ username?: string; error?: string }>(
    'redeem-invite',
    { action: 'preview', code },
    ip ? { ip } : {},
  )

const redeem = (code: string, username: string, password: string, ip?: string) =>
  callFunction<{ error?: string }>(
    'redeem-invite',
    { action: 'redeem', code, username, password },
    ip ? { ip } : {},
  )

let ownerToken: string

async function provision(): Promise<{ username: string; code: string; profileId: string }> {
  const username = freshUsername()
  const result = await callFunction<{ username: string; code: string; profileId: string }>(
    'admin-accounts',
    {
      action: 'provision',
      fullName: 'Probe Activation',
      username,
      role: 'employee',
      outletIds: [OUTLET_KALYANI],
    },
    { token: ownerToken },
  )
  expect(result.status).toBe(201)
  return { username, code: result.body.code, profileId: result.body.profileId }
}

beforeAll(async () => {
  const { data, error } = await anonClient().auth.signInWithPassword({
    email: OWNER_ALIAS,
    password: SEED_PASSWORD,
  })
  if (error || !data.session) throw new Error(`owner sign-in failed: ${error?.message}`)
  ownerToken = data.session.access_token
}, 60_000)

describe('opening and redeeming an activation link', () => {
  it('shows only the canonical username and consumes nothing on preview', async () => {
    const { username, code } = await provision()
    expect(await preview(code, freshIp())).toMatchObject({
      status: 200,
      body: { username },
    })
    expect(await preview(code, freshIp())).toMatchObject({
      status: 200,
      body: { username },
    })
  })

  it('requires the shown username without consuming on mismatch', async () => {
    const { username, code } = await provision()
    const mismatch = await redeem(code, 'different.person', NEW_PASSWORD, freshIp())
    expect(mismatch).toMatchObject({
      status: 409,
      body: { error: 'username_mismatch' },
    })

    expect((await redeem(code, username.toUpperCase(), NEW_PASSWORD, freshIp())).status).toBe(204)
    const session = await anonClient().auth.signInWithPassword({
      email: authAlias(username),
      password: NEW_PASSWORD,
    })
    expect(session.error).toBeNull()
  })

  it('normalizes a hand-typed code and identifies weak passwords specifically', async () => {
    const { username, code } = await provision()
    const mangled = ` ${code.toLowerCase().replace('-', '  ')} `
    const weak = await redeem(mangled, username, 'short', freshIp())
    expect(weak).toMatchObject({ status: 400, body: { error: 'weak_password' } })
    expect((await redeem(mangled, username, NEW_PASSWORD, freshIp())).status).toBe(204)
  })

  it('keeps unknown, spent, inactive, and superseded codes uniform', async () => {
    const live = await provision()
    const spent = await provision()
    expect((await redeem(spent.code, spent.username, NEW_PASSWORD, freshIp())).status).toBe(204)

    const unknown = await preview('ZZZZZ-ZZZZZ', freshIp())
    const consumed = await preview(spent.code, freshIp())
    expect(unknown).toMatchObject({ status: 400, body: { error: 'invalid_code' } })
    expect(consumed).toEqual(unknown)

    const reissued = await callFunction<{ code: string }>(
      'admin-accounts',
      { action: 'reissue', profileId: live.profileId },
      { token: ownerToken },
    )
    expect(reissued.status).toBe(200)
    expect(await preview(live.code, freshIp())).toEqual(unknown)
  })

  it('rate-limits failed callers without disclosing a username', async () => {
    const attacker = freshIp()
    for (let attempt = 0; attempt < 20; attempt += 1) {
      expect((await preview('ZZZZZ-ZZZZZ', attacker)).status).toBe(400)
    }
    const refused = await preview('ZZZZZ-ZZZZZ', attacker)
    expect(refused).toMatchObject({ status: 429, body: { error: 'rate_limited' } })
    expect(refused.body.username).toBeUndefined()
  }, 60_000)
})

describe('provider alias protection', () => {
  it('requires both inaccessible alias confirmations before an email change can complete', async () => {
    const client = anonClient()
    const originalAlias = 'staff.kalyani@login.shawarmania.invalid'
    const attemptedAlias = `hijack.${RUN}@login.shawarmania.invalid`
    const signedIn = await client.auth.signInWithPassword({
      email: originalAlias,
      password: SEED_PASSWORD,
    })
    expect(signedIn.error).toBeNull()

    const changed = await client.auth.updateUser({ email: attemptedAlias })
    expect(changed.data.user?.email).toBe(originalAlias)

    const current = await client.auth.getUser()
    expect(current.data.user?.email).toBe(originalAlias)
    expect(
      (
        await anonClient().auth.signInWithPassword({
          email: attemptedAlias,
          password: SEED_PASSWORD,
        })
      ).error,
    ).not.toBeNull()
  })
})
