/**
 * Username activation, owner recovery, and the signed mail boundary over the
 * real local stack. The database suites prove the internals; this file proves
 * Kong, Edge Functions, GoTrue, and Mailpit agree on the wire contract.
 */
import { createHmac, randomUUID } from 'node:crypto'

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
const OWNER_ID = '10000000-0000-4000-a000-000000000001'
const OWNER_ALIAS = 'owner@login.shawarmania.invalid'
const LOCAL_HOOK_SECRET = 'c2hhd2FybWFuaWEtbG9jYWwtaG9vay12MQ=='

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

function signedHookHeaders(body: string): Record<string, string> {
  const id = randomUUID()
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const secret = Buffer.from(LOCAL_HOOK_SECRET, 'base64')
  const signature = createHmac('sha256', secret)
    .update(`${id}.${timestamp}.${body}`)
    .digest('base64')
  return {
    'webhook-id': id,
    'webhook-timestamp': timestamp,
    'webhook-signature': `v1,${signature}`,
  }
}

describe('the signed Send Email Hook', () => {
  const recoveryPayload = {
    user: { id: OWNER_ID, email: OWNER_ALIAS },
    email_data: {
      token_hash: 'integration-test-token',
      redirect_to: 'https://ops.shawarmania.in/recover',
      email_action_type: 'recovery',
    },
  }

  it('rejects an invalid signature', async () => {
    const result = await callFunction('send-email-hook', recoveryPayload, {
      headers: {
        'webhook-id': randomUUID(),
        'webhook-timestamp': Math.floor(Date.now() / 1000).toString(),
        'webhook-signature': 'v1,invalid',
      },
    })
    expect(result.status).toBe(401)
  })

  it('fails closed for email changes and wrong redirects', async () => {
    for (const emailData of [
      { ...recoveryPayload.email_data, email_action_type: 'email_change' },
      { ...recoveryPayload.email_data, redirect_to: 'https://attacker.invalid/recover' },
    ]) {
      const payload = { ...recoveryPayload, email_data: emailData }
      const body = JSON.stringify(payload)
      const response = await fetch(`${SUPABASE_URL}/functions/v1/send-email-hook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...signedHookHeaders(body) },
        body,
      })
      expect(response.status).toBe(403)
    }
  })

  it('delivers only an active live owner recovery through the local mail sink', async () => {
    const body = JSON.stringify(recoveryPayload)
    const response = await fetch(`${SUPABASE_URL}/functions/v1/send-email-hook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...signedHookHeaders(body) },
      body,
    })
    expect(response.status).toBe(200)

    const formerPayload = {
      ...recoveryPayload,
      user: {
        id: '10000000-0000-4000-a000-000000000008',
        email: 'deactivated.kalyani@login.shawarmania.invalid',
      },
    }
    const formerBody = JSON.stringify(formerPayload)
    const refused = await fetch(`${SUPABASE_URL}/functions/v1/send-email-hook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...signedHookHeaders(formerBody) },
      body: formerBody,
    })
    expect(refused.status).toBe(403)
  })
})

describe('public owner recovery', () => {
  it('returns one response for a live owner, unknown address, and ordinary staff', async () => {
    const responses = await Promise.all(
      ['owner.recovery@example.com', 'nobody@example.com', 'staff.kalyani@example.com'].map(
        (recoveryEmail, index) =>
          callFunction(
            'owner-recovery',
            { action: 'request', recoveryEmail },
            { ip: `198.51.100.${index + 10}` },
          ),
      ),
    )
    expect(new Set(responses.map((result) => JSON.stringify(result))).size).toBe(1)
    expect(responses[0]).toMatchObject({ status: 202, body: { accepted: true } })
  })

  it('does not let an ordinary signed-in account use the callback status oracle', async () => {
    const employee = await anonClient().auth.signInWithPassword({
      email: 'staff.kalyani@login.shawarmania.invalid',
      password: SEED_PASSWORD,
    })
    const result = await callFunction(
      'owner-recovery',
      { action: 'status' },
      { token: employee.data.session!.access_token },
    )
    expect(result.status).toBe(403)
  })
})
