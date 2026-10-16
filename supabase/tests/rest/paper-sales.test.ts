/**
 * a-sale-taken-on-paper-says-so (#77), over HTTP: only an outlet's admins may
 * record a paper sale, and a crafted request from anyone else is refused by
 * the database with a valid session and a well-formed payload. Nothing here is
 * accepted, so nothing is left behind for the suites that follow.
 */
import { execSync } from 'node:child_process'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Database } from '../../../src/data-access/database.types'

const kalyani = '00000000-0000-4000-a000-000000000001'
type Client = SupabaseClient<Database>
const keys = JSON.parse(
  execSync('npx supabase status -o json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
) as { ANON_KEY: string }

const make = () =>
  createClient<Database>('http://127.0.0.1:54321', keys.ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

/** A well-formed written order: the refusal must be about who, not what. */
function writtenOrder(): Database['public']['Functions']['record_paper_bill']['Args'] {
  const day = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10)
  return {
    p_bill_id: crypto.randomUUID(),
    p_outlet_id: kalyani,
    p_payload: {
      businessDate: day,
      orderedAt: `${day}T19:40:00+05:30`,
      lines: [{ menuItemId: '31000000-0000-4000-a000-000000000001', quantity: 1 }],
      payments: [{ method: 'cash', amountPaise: 13_900 }],
    },
  }
}

describe('who may record a paper sale, over HTTP', () => {
  const callers: [string, Client][] = []

  beforeAll(async () => {
    for (const [label, email] of [
      ['another outlet’s manager', 'admin.kanchrapara@login.shawarmania.invalid'],
      ['a biller', 'biller.kalyani@login.shawarmania.invalid'],
      ['an employee', 'staff.kalyani@login.shawarmania.invalid'],
      ['the counter tablet', 'tablet.kalyani@login.shawarmania.invalid'],
    ] as const) {
      const client = make()
      const { error } = await client.auth.signInWithPassword({
        email,
        password: 'shawarmania-local',
      })
      if (error) throw new Error(`local ${label} could not sign in`)
      callers.push([label, client])
    }
  })

  afterAll(async () => {
    await Promise.all(callers.map(([, client]) => client.auth.signOut({ scope: 'local' })))
  })

  it('refuses everyone but the owner and the outlet’s own managers', async () => {
    for (const [label, client] of callers) {
      const { data, error } = await client.rpc('record_paper_bill', writtenOrder())
      expect(data, label).toBeNull()
      expect(error?.code, label).toBe('42501')
    }
  })

  it('refuses an anonymous caller', async () => {
    const { data, error } = await make().rpc('record_paper_bill', writtenOrder())
    expect(data).toBeNull()
    expect(error).not.toBeNull()
  })
})
