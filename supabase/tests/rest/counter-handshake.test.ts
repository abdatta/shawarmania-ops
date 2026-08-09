/**
 * The counter handshake on the wire: the two Edge Functions, and the Realtime
 * channel behind the approval card.
 *
 * The pgTAP suite proves what the database refuses. **This file proves the two
 * things that live above it and were, until the adversarial review, asserted
 * only by comments**:
 *
 *  1. every privileged action derives its caller from the presented token
 *     rather than from anything in the request body, and
 *  2. a change event carries no confirmation code, because Realtime applies the
 *     same column grants a read does.
 *
 * The second one matters more than it looks. `counter_shift_requests` replicates
 * its whole row so a subscriber can tell which request resolved, and `code_hash`
 * is on that row. A migration comment claimed the wire is filtered by grant. A
 * comment is not a test, and this is the one remaining path by which the code
 * could leave the server.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '../../../src/data-access/database.types'

const SUPABASE_URL = process.env['SUPABASE_URL'] ?? 'http://127.0.0.1:54321'
const SUPABASE_ANON_KEY =
  process.env['SUPABASE_ANON_KEY'] ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SEED_PASSWORD = 'shawarmania-local'

const OUTLET_KALYANI = '00000000-0000-4000-a000-000000000001'
const OUTLET_KANCHRAPARA = '00000000-0000-4000-a000-000000000002'
const BILLER_KANCHRAPARA = '10000000-0000-4000-a000-00000000000b'

type Client = SupabaseClient<Database>

function anonClient(): Client {
  return createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

async function tokenFor(alias: string): Promise<string> {
  const { data, error } = await anonClient().auth.signInWithPassword({
    email: `${alias}@login.shawarmania.invalid`,
    password: SEED_PASSWORD,
  })
  if (error || !data.session) throw new Error(`could not sign in as ${alias}: ${error?.message}`)
  return data.session.access_token
}

async function call<T = Record<string, unknown>>(
  name: string,
  payload: Record<string, unknown>,
  token?: string,
): Promise<{ status: number; body: T }> {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
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

let ownerToken: string
let billerKpaToken: string
let billerKalToken: string
let tabletToken: string

beforeAll(async () => {
  ownerToken = await tokenFor('owner')
  billerKpaToken = await tokenFor('biller.kanchrapara')
  billerKalToken = await tokenFor('biller.kalyani')
  // The seeded tablet signs in through the same alias namespace as a person,
  // which is what makes the next block worth asserting: holding a valid token is
  // not the same as being somebody.
  tabletToken = await tokenFor('tablet.kanchrapara')
})

describe('the Edge Function derives its caller from the token', () => {
  it('refuses a request carrying no token at all', async () => {
    const { status } = await call('counter-devices', { action: 'issue-setup-code' })
    expect(status).toBe(403)
  })

  it('refuses a tablet asking for an administrative action', async () => {
    // `callerFrom` looks for a profile, and a tablet has none. The refusal is a
    // consequence of the machine/person separation rather than a check somebody
    // remembered to write, which is why it is worth pinning.
    const { status, body } = await call(
      'counter-devices',
      { action: 'issue-setup-code', outletId: OUTLET_KANCHRAPARA, label: 'Sneaky' },
      tabletToken,
    )
    expect(status).toBe(403)
    expect(body).toEqual({ error: 'forbidden' })
  })

  it('refuses a person asking for a tablet action', async () => {
    // The mirror image: `deviceCallerFrom` finds no `counter_devices` row for a
    // person, so a Biller cannot ask for a shift on a tablet's behalf and read
    // back the code.
    const { status } = await call(
      'counter-devices',
      { action: 'request-shift', username: 'biller.kanchrapara' },
      billerKpaToken,
    )
    expect(status).toBe(403)
  })

  it('scopes an administrative action to the outlets the caller actually manages', async () => {
    const { status } = await call(
      'counter-devices',
      { action: 'issue-setup-code', outletId: OUTLET_KALYANI, label: 'Cross-outlet' },
      billerKalToken,
    )
    // A Biller manages nothing anywhere, whatever outlet the body names.
    expect(status).toBe(403)
  })

  it('ignores any person named in the body and confirms only as the token holder', async () => {
    const asked = await call<{ requestId?: string; code?: string }>(
      'counter-devices',
      { action: 'request-shift', username: 'biller.kanchrapara' },
      tabletToken,
    )
    expect(asked.status).toBe(200)
    expect(asked.body.code).toMatch(/^\d{4}$/)

    // The owner holds a valid token, knows the correct code, and names the
    // intended operator in the body. There is no fallback approver, so the
    // authority that matters is whose token this is — and the body has no say.
    const asOwner = await call(
      'counter-devices',
      {
        action: 'confirm',
        requestId: asked.body.requestId,
        code: asked.body.code,
        personId: BILLER_KANCHRAPARA,
        p_person_id: BILLER_KANCHRAPARA,
      },
      ownerToken,
    )
    expect(asOwner.status).toBe(400)
    expect(asOwner.body).toEqual({ error: 'invalid_request' })

    // And the named person, sending nothing but the code, is accepted.
    const asOperator = await call<{ shiftId?: string }>(
      'counter-devices',
      { action: 'confirm', requestId: asked.body.requestId, code: asked.body.code },
      billerKpaToken,
    )
    expect(asOperator.status).toBe(200)
    expect(asOperator.body.shiftId).toBeTruthy()

    // Ended again so the file leaves the stack as it found it.
    const ended = await call(
      'counter-devices',
      { action: 'end-shift', shiftId: asOperator.body.shiftId },
      billerKpaToken,
    )
    expect(ended.status).toBe(204)
  })

  it('refuses to end a shift the token holder does not hold', async () => {
    const asked = await call<{ requestId?: string; code?: string }>(
      'counter-devices',
      { action: 'request-shift', username: 'biller.kanchrapara' },
      tabletToken,
    )
    const opened = await call<{ shiftId?: string }>(
      'counter-devices',
      { action: 'confirm', requestId: asked.body.requestId, code: asked.body.code },
      billerKpaToken,
    )

    const byOwner = await call(
      'counter-devices',
      { action: 'end-shift', shiftId: opened.body.shiftId },
      ownerToken,
    )
    expect(byOwner.status).toBe(400)

    await call(
      'counter-devices',
      { action: 'end-shift', shiftId: opened.body.shiftId },
      billerKpaToken,
    )
  })
})

describe('setting a tablet up takes no session, and says nothing when it fails', () => {
  it('gives one answer to every bad code', async () => {
    const unknown = await call('counter-setup', { code: 'ZZZZZ-ZZZZZ' })
    const malformed = await call('counter-setup', { code: '?' })
    const missing = await call('counter-setup', {})

    expect(unknown).toEqual({ status: 400, body: { error: 'invalid_code' } })
    expect(malformed).toEqual({ status: 400, body: { error: 'invalid_code' } })
    expect(missing).toEqual({ status: 400, body: { error: 'invalid_code' } })
  })

  it('refuses an outlet that already has a tablet, and consumes nothing doing it', async () => {
    const issued = await call<{ code?: string }>(
      'counter-devices',
      { action: 'issue-setup-code', outletId: OUTLET_KANCHRAPARA, label: 'Second tablet' },
      ownerToken,
    )
    // The refusal comes before a code is ever minted: the outlet is full, and an
    // admin is told at the point of asking rather than after walking to the
    // counter.
    expect(issued.status).toBe(409)
    expect(issued.body).toEqual({ error: 'tablet_exists' })
  })
})

describe('the live channel carries no confirmation code', () => {
  let channelClient: Client

  afterAll(async () => {
    if (channelClient) await channelClient.removeAllChannels()
  })

  it('delivers the row to the person it names, with the code absent', async () => {
    channelClient = anonClient()
    await channelClient.auth.signInWithPassword({
      email: 'biller.kanchrapara@login.shawarmania.invalid',
      password: SEED_PASSWORD,
    })
    await channelClient.realtime.setAuth()

    const events: Record<string, unknown>[] = []
    const channel = channelClient.channel(`probe-${Date.now()}`).on(
      'postgres_changes',
      // **Deliberately unfiltered.** Realtime applies the same column grants a
      // read does, so a server-side filter on `person_id` — which is granted to
      // nobody — matches nothing and the channel goes quiet without erroring.
      // RLS is what scopes this to the reader's own requests, and it is the
      // only thing that was ever the boundary.
      { event: '*', schema: 'public', table: 'counter_shift_requests' },
      (payload) => {
        events.push(payload.new as Record<string, unknown>)
      },
    )

    const subscribed = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 15_000)
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          clearTimeout(timer)
          resolve(true)
        }
      })
    })
    expect(subscribed, 'the Realtime channel did not subscribe').toBe(true)

    const asked = await call<{ requestId?: string }>(
      'counter-devices',
      { action: 'request-shift', username: 'biller.kanchrapara' },
      tabletToken,
    )
    expect(asked.status).toBe(200)

    const arrived = await new Promise<boolean>((resolve) => {
      const started = Date.now()
      const poll = setInterval(() => {
        if (events.length > 0 || Date.now() - started > 15_000) {
          clearInterval(poll)
          resolve(events.length > 0)
        }
      }, 100)
    })

    // If this fails, the migration's REPLICA IDENTITY FULL is not doing what it
    // claims and the approval card is running on the poll alone.
    expect(arrived, 'no change event arrived on the channel').toBe(true)

    const row = events[0]!
    // The whole point. The row replicates in full so a subscriber can tell which
    // request resolved; the code must not be part of "in full".
    expect(row).not.toHaveProperty('code_hash')
    expect(Object.keys(row)).toContain('requested_username')
    expect(JSON.stringify(events)).not.toContain('code_hash')

    // And the column the review found: nothing on the wire says whether the
    // username resolved to anybody.
    expect(row).not.toHaveProperty('person_id')

    await call('counter-devices', { action: 'cancel-request' }, tabletToken)
  })
})
