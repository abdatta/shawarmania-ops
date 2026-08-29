/**
 * The drawer over HTTP, with real tokens.
 *
 * `supabase/tests/41_cash_drawer.sql` proves the policies exhaustively with
 * simulated claims. This layer proves the deployed stack injects those claims
 * into real tokens and enforces them over PostgREST — which is the only place
 * the roadmap gate's "hand-crafted request with a valid session" is literally
 * true.
 *
 * Two claims here are worth the round trip and cannot be made in pgTAP:
 *
 *   * **A Super Admin holding no assignment anywhere reaches both drawers**, and
 *     the reach survives the journey through GoTrue. Confirmed against
 *     production twice (2026-08-26, 2026-08-27) that this is the only path that
 *     works: no live Franchise Admin assignment exists at either outlet, so a
 *     drawer reachable only through one would be reachable by nobody.
 *
 *   * **A Biller and an Employee are refused every drawer verb at their OWN
 *     outlet**, by the absence of a policy branch. Silent over-permission passes
 *     every functional test in this repo; this and the pgTAP file are the only
 *     things that catch it.
 *
 * Requires the local stack: `npm run db:start && npm run db:reset`.
 *
 * **This file makes real writes, which is why it runs in its own phase**
 * (`vitest.drawer-writes.config.ts`) rather than beside the other probes. Its
 * central claim is that the Super Admin path genuinely works over HTTP, and a
 * denied write would prove the opposite of the thing being asserted.
 *
 * It therefore cleans up after itself with the service-role key. Without that,
 * the committed rows are visible to `test:db`'s pgTAP suite on a later run
 * against the same reset, and Kanchrapara's anchor assertions start failing
 * against an outlet that already has an observation — which is what happened
 * before this cleanup existed, and is a better argument for it than any comment.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, describe, expect, it } from 'vitest'

import type { Database } from '../../../src/data-access/database.types'

const SUPABASE_URL = process.env['SUPABASE_URL'] ?? 'http://127.0.0.1:54321'
const SUPABASE_ANON_KEY =
  process.env['SUPABASE_ANON_KEY'] ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

const PASSWORD = 'shawarmania-local'

const OUTLETS = {
  kalyani: '00000000-0000-4000-a000-000000000001',
  kanchrapara: '00000000-0000-4000-a000-000000000002',
} as const

const EMAILS = {
  superAdmin: 'owner@login.shawarmania.invalid',
  faKalyani: 'admin.kalyani@login.shawarmania.invalid',
  billerKalyani: 'biller.kalyani@login.shawarmania.invalid',
  employeeKalyani: 'staff.kalyani@login.shawarmania.invalid',
} as const

/** Kalyani's surveyed position, so a probe is on site deliberately. */
const KALYANI_POSITION = { lat: 22.975, lng: 88.4345 }

type Client = SupabaseClient<Database>

const sessions = new Map<string, Promise<Client>>()

function signIn(email: string): Promise<Client> {
  const existing = sessions.get(email)
  if (existing) return existing

  const opened = (async () => {
    const client = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD })
    if (error) throw new Error(`could not sign in ${email}: ${error.message}`)
    return client
  })()

  sessions.set(email, opened)
  return opened
}

/**
 * The service-role client, used for nothing but the cleanup below. It bypasses
 * RLS entirely, so it is deliberately never handed to a probe that is asserting
 * a refusal — that would test nothing.
 */
function serviceClient(): Client {
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required to clean up after this file')
  return createClient<Database>(SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/**
 * Put the seed back exactly as it was.
 *
 * Deletion order follows the foreign keys: adjustments and cash-out rows both
 * point at observations, so those go first. The drawer tables are the only ones
 * this file writes — no bill, expense or assignment is touched.
 */
afterAll(async () => {
  const service = serviceClient()
  const outlets = [OUTLETS.kalyani, OUTLETS.kanchrapara]

  await service.from('drawer_observation_adjustments').delete().in('outlet_id', outlets)
  await service.from('drawer_cash_out').delete().in('outlet_id', outlets)
  await service.from('drawer_observations').delete().in('outlet_id', outlets)
  await service.from('ledger_day_verifications').delete().in('outlet_id', outlets)

  // Proved rather than assumed: a cleanup that silently failed would leave the
  // next `test:db` run failing somewhere else entirely, which is a long way from
  // the cause.
  for (const table of [
    'drawer_observations',
    'drawer_cash_out',
    'drawer_observation_adjustments',
    'ledger_day_verifications',
  ] as const) {
    const { data, error } = await service.from(table).select('id')
    if (error) throw error
    if ((data?.length ?? 0) > 0) {
      throw new Error(`${table} still holds ${data?.length} row(s) after cleanup`)
    }
  }
})

/** A count instant guaranteed to be after any this file has already used. */
let instantCursor = 0
function freshInstant(): string {
  instantCursor += 1
  return new Date(Date.now() - 60_000 + instantCursor * 1000).toISOString()
}

describe('a Super Admin holding no assignment reaches every drawer', () => {
  it('records an observation at an outlet they are not assigned to', async () => {
    const owner = await signIn(EMAILS.superAdmin)

    const { data, error } = await owner.rpc('record_drawer_observation', {
      p_outlet_id: OUTLETS.kanchrapara,
      p_counted_at: freshInstant(),
      p_counted_total_paise: 450000,
      p_certain: true,
      p_lat: KALYANI_POSITION.lat,
      p_lng: KALYANI_POSITION.lng,
      p_accuracy_m: 10,
      // Kalyani's position is 3 km from Kanchrapara, so this probe is off site
      // on purpose: being elsewhere is recorded, never refused.
      p_away_reason: 'REST probe, deliberately off site',
    })

    expect(error).toBeNull()
    expect(data).toBeTruthy()
  })

  it('records a collection, a spend and reads both back, at both outlets', async () => {
    const owner = await signIn(EMAILS.superAdmin)

    const collection = await owner.rpc('record_drawer_cash_out', {
      p_outlet_id: OUTLETS.kalyani,
      p_amount_paise: 300000,
      p_kind: 'collection',
      p_lat: KALYANI_POSITION.lat,
      p_lng: KALYANI_POSITION.lng,
      p_accuracy_m: 10,
    })
    expect(collection.error).toBeNull()

    const spend = await owner.rpc('record_drawer_cash_out', {
      p_outlet_id: OUTLETS.kalyani,
      p_amount_paise: 250000,
      p_kind: 'spend',
      p_reason: 'Gas cylinder, paid from the till',
      p_lat: KALYANI_POSITION.lat,
      p_lng: KALYANI_POSITION.lng,
      p_accuracy_m: 10,
    })
    expect(spend.error).toBeNull()

    const { data, error } = await owner
      .from('drawer_cash_out')
      .select('outlet_id, kind, amount_paise')
      .in('outlet_id', [OUTLETS.kalyani, OUTLETS.kanchrapara])
    expect(error).toBeNull()
    expect(data?.length ?? 0).toBeGreaterThan(0)
  })

  it('a negative collection is accepted over HTTP, with no reason', async () => {
    const owner = await signIn(EMAILS.superAdmin)

    const { data, error } = await owner.rpc('record_drawer_cash_out', {
      p_outlet_id: OUTLETS.kalyani,
      // A minus is cash ADDED to a thin drawer. There is deliberately no second
      // endpoint, kind or parameter for it.
      p_amount_paise: -100000,
      p_kind: 'collection',
      p_lat: KALYANI_POSITION.lat,
      p_lng: KALYANI_POSITION.lng,
      p_accuracy_m: 10,
    })

    expect(error).toBeNull()
    expect(data).toBeTruthy()
  })

  it('verifies a business date', async () => {
    const owner = await signIn(EMAILS.superAdmin)
    const { error } = await owner.rpc('verify_ledger_day', {
      p_outlet_id: OUTLETS.kanchrapara,
      p_business_date: '2026-08-20',
      p_note: 'REST probe',
    })
    expect(error).toBeNull()
  })
})

describe('a Franchise Admin reaches their own outlet and no other', () => {
  it('reads their own outlet and gets nothing for the other', async () => {
    const manager = await signIn(EMAILS.faKalyani)

    const own = await manager.from('drawer_cash_out').select('id').eq('outlet_id', OUTLETS.kalyani)
    expect(own.error).toBeNull()
    expect(own.data?.length ?? 0).toBeGreaterThan(0)

    const other = await manager
      .from('drawer_cash_out')
      .select('id')
      .eq('outlet_id', OUTLETS.kanchrapara)
    expect(other.error).toBeNull()
    // Not an error — an empty result. The row is invisible rather than forbidden,
    // which is what stops a probe learning that it exists.
    expect(other.data).toEqual([])
  })

  it('is refused a hand-crafted write at the outlet they do not manage', async () => {
    const manager = await signIn(EMAILS.faKalyani)
    const { error } = await manager.rpc('record_drawer_observation', {
      p_outlet_id: OUTLETS.kanchrapara,
      p_counted_at: freshInstant(),
      p_counted_total_paise: 100000,
      p_certain: true,
      p_lat: KALYANI_POSITION.lat,
      p_lng: KALYANI_POSITION.lng,
      p_accuracy_m: 10,
      p_away_reason: 'probe',
    })
    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/Franchise Admin assigned to this outlet/)
  })
})

describe('a Biller and an Employee are refused every drawer verb, at their own outlet', () => {
  const tables = [
    'drawer_observations',
    'drawer_cash_out',
    'drawer_observation_adjustments',
    'ledger_day_verifications',
  ] as const

  for (const persona of ['billerKalyani', 'employeeKalyani'] as const) {
    describe(persona, () => {
      it.each(tables)('reads no row from %s at any outlet', async (table) => {
        const client = await signIn(EMAILS[persona])
        const { data, error } = await client.from(table).select('id')
        expect(error).toBeNull()
        expect(data).toEqual([])
      })

      it.each(tables)('cannot insert into %s with a valid session', async (table) => {
        const client = await signIn(EMAILS[persona])
        // A hand-crafted insert. The shape is deliberately plausible: what
        // refuses it is the missing grant and the absent policy, not a
        // validation error it could correct.
        const { error } = await client.from(table).insert({
          outlet_id: OUTLETS.kalyani,
        } as never)
        expect(error).not.toBeNull()
      })

      it.each(tables)('cannot update or delete %s', async (table) => {
        const client = await signIn(EMAILS[persona])

        const updated = await client
          .from(table)
          .update({ outlet_id: OUTLETS.kalyani } as never)
          .eq('outlet_id', OUTLETS.kalyani)
          .select('id')
        // Either refused outright, or matched nothing because the select side of
        // the policy hides every row. Both are the refusal; what must never
        // happen is a row coming back changed.
        expect(updated.error !== null || (updated.data?.length ?? 0) === 0).toBe(true)

        const deleted = await client
          .from(table)
          .delete()
          .eq('outlet_id', OUTLETS.kalyani)
          .select('id')
        expect(deleted.error !== null || (deleted.data?.length ?? 0) === 0).toBe(true)
      })

      it('is refused the count command at their own outlet', async () => {
        const client = await signIn(EMAILS[persona])
        const { error } = await client.rpc('record_drawer_observation', {
          p_outlet_id: OUTLETS.kalyani,
          p_counted_at: freshInstant(),
          p_counted_total_paise: 100000,
          p_certain: true,
          p_lat: KALYANI_POSITION.lat,
          p_lng: KALYANI_POSITION.lng,
          p_accuracy_m: 10,
        })
        expect(error).not.toBeNull()
        expect(error?.message).toMatch(/Super Admin/)
      })

      it('is refused the cash-out command at their own outlet', async () => {
        const client = await signIn(EMAILS[persona])
        const { error } = await client.rpc('record_drawer_cash_out', {
          p_outlet_id: OUTLETS.kalyani,
          p_amount_paise: 100000,
        })
        expect(error).not.toBeNull()
      })

      it('is refused day verification at their own outlet', async () => {
        const client = await signIn(EMAILS[persona])
        const { error } = await client.rpc('verify_ledger_day', {
          p_outlet_id: OUTLETS.kalyani,
          p_business_date: '2026-08-20',
        })
        expect(error).not.toBeNull()
      })
    })
  }
})

describe('no client supplies a derived figure', () => {
  it('the observation table refuses a direct insert even from a Super Admin', async () => {
    const owner = await signIn(EMAILS.superAdmin)

    // Every derived figure is computed inside the transaction that writes the
    // row. This is the request that would bypass that, and there is no grant for
    // it — so an opening, an expected total and a difference cannot be dictated
    // by a screen even with the most privileged session in the business.
    const { error } = await owner.from('drawer_observations').insert({
      outlet_id: OUTLETS.kalyani,
      counted_at: freshInstant(),
      counted_total_paise: 999999,
      opening_paise: 0,
      expected_paise: 0,
      difference_paise: 999999,
      is_approximate: false,
      recorded_by: '10000000-0000-4000-a000-000000000001',
    } as never)

    expect(error).not.toBeNull()
  })

  it('the command exposes no parameter for an expected total or a difference', async () => {
    const owner = await signIn(EMAILS.superAdmin)

    const { error } = await owner.rpc('record_drawer_observation', {
      p_outlet_id: OUTLETS.kalyani,
      p_counted_at: freshInstant(),
      p_counted_total_paise: 100000,
      p_certain: true,
      p_lat: KALYANI_POSITION.lat,
      p_lng: KALYANI_POSITION.lng,
      p_accuracy_m: 10,
      // There is no p_expected_paise and no p_difference_paise. PostgREST
      // refuses an unknown named argument rather than ignoring it, so this
      // assertion is about the function's signature and not about validation.
      p_expected_paise: 0,
    } as never)

    expect(error).not.toBeNull()
  })
})
