import { execSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '../../../src/data-access/database.types'

/**
 * #69 the-day-change-finishes-paid-orders, over HTTP.
 *
 * The day change finishes a paid order nobody ticked, and records itself as
 * the one that did. Both halves are the database's alone: no signed-in person
 * or tablet may run the sweep, and none may write `prepared_source` by hand.
 * pgTAP proves the rules; these probes prove them through the same door a
 * hand-crafted request would use.
 */

const url = process.env['SUPABASE_URL'] ?? 'http://127.0.0.1:54321'
type Client = SupabaseClient<Database>

const localKeys = () =>
  JSON.parse(
    execSync('npx supabase status -o json', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  ) as { ANON_KEY: string; SERVICE_ROLE_KEY: string }

describe('the day change is the database’s alone', () => {
  const callers: [string, Client][] = []
  let service: Client

  beforeAll(async () => {
    if (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) {
      throw new Error('day change probes require the local Supabase stack')
    }
    const keys = localKeys()
    const client = (key: string) =>
      createClient<Database>(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    service = client(keys.SERVICE_ROLE_KEY)
    for (const [label, email] of [
      ['owner', 'owner@login.shawarmania.invalid'],
      ['franchise admin', 'admin.kalyani@login.shawarmania.invalid'],
      ['biller', 'biller.kalyani@login.shawarmania.invalid'],
      ['employee', 'staff.kalyani@login.shawarmania.invalid'],
      ['counter tablet', 'tablet.kalyani@login.shawarmania.invalid'],
    ] as const) {
      const signedIn = client(keys.ANON_KEY)
      const { error } = await signedIn.auth.signInWithPassword({
        email,
        password: 'shawarmania-local',
      })
      if (error) throw new Error(`local ${label} could not sign in`)
      callers.push([label, signedIn])
    }
  })

  afterAll(async () => {
    await Promise.all(callers.map(([, c]) => c.auth.signOut({ scope: 'local' })))
  })

  it('refuses the sweep to every signed-in caller and to the service role', async () => {
    for (const [label, caller] of [...callers, ['service role', service] as [string, Client]]) {
      const { error } = await caller.rpc('finish_paid_orders_at_day_change', {})
      expect(error, `${label} ran the sweep`).not.toBeNull()
    }
  })

  it('refuses a hand-written source from every signed-in caller', async () => {
    // No client role holds UPDATE on orders: every change is a billing command.
    // So the request is refused outright, whether or not the row exists -- the
    // probe needs no order of its own, and leaves no immutable history behind.
    for (const [label, caller] of callers) {
      const { error } = await caller
        .from('orders')
        .update({ prepared_source: 'day_change' })
        .eq('id', randomUUID())
      expect(error, `${label} wrote the source`).not.toBeNull()
      expect(error?.code).toBe('42501')
    }
  })
})
