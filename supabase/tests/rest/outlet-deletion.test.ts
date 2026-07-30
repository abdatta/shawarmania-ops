/**
 * Deleting an outlet, through the real adapter and over the wire.
 *
 * `11_outlet_deletion.sql` proves the policy and the foreign keys in SQL, and
 * the component tests prove the screen. Neither covers the seam between them,
 * and that seam has two parts a signed-in session reaches differently from a
 * `psql` connection:
 *
 *   * **`outlet_reference_counts` as a PostgREST RPC.** pgTAP calls it as a
 *     function; the app calls it as `client.rpc(...)`. A `security definer`
 *     function that works in SQL and is unreachable over REST — wrong grant,
 *     wrong argument name, not exposed — fails only here.
 *   * **A refusal that is not an error.** A DELETE matching no row through RLS
 *     succeeds and removes nothing. The adapter turns that silence into a
 *     refusal by asking what came back; nothing below the adapter can prove it
 *     does, because at the SQL level there is nothing to see.
 *
 * Requires the local stack: `npm run db:start && npm run db:reset`, then
 * `npm run test:rls`.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { beforeAll, describe, expect, it } from 'vitest'

import { DataActionError } from '../../../src/data-access/adapters'
import type { Database } from '../../../src/data-access/database.types'
import { createSupabaseOutletsAdapter } from '../../../src/data-access/supabase-adapters/outlets'

const SUPABASE_URL = process.env['SUPABASE_URL'] ?? 'http://127.0.0.1:54321'
const SUPABASE_ANON_KEY =
  process.env['SUPABASE_ANON_KEY'] ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

const SEED_PASSWORD = 'shawarmania-local'
/** Seeded, and populated: a roster, accounts, a tablet and a traded day. */
const KALYANI = '00000000-0000-4000-a000-000000000001'

type Client = SupabaseClient<Database>

/** Unique per run, so the suite is re-runnable without a database reset. */
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`
let seq = 0

async function signIn(email: string): Promise<Client> {
  const client = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error } = await client.auth.signInWithPassword({ email, password: SEED_PASSWORD })
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`)
  return client
}

let owner: ReturnType<typeof createSupabaseOutletsAdapter>
let manager: ReturnType<typeof createSupabaseOutletsAdapter>

beforeAll(async () => {
  owner = createSupabaseOutletsAdapter(await signIn('owner@login.shawarmania.invalid'))
  manager = createSupabaseOutletsAdapter(await signIn('admin.kalyani@login.shawarmania.invalid'))
})

/** A throwaway outlet nothing references. Deleted by the test that made it. */
async function freshOutlet() {
  return owner.createOutlet({
    code: `del-${RUN}-${seq++}`,
    name: 'Throwaway Outlet',
    locationLabel: 'Created by the deletion suite',
  })
}

describe('deleting an outlet over REST', () => {
  it('removes an outlet nothing references', async () => {
    const outlet = await freshOutlet()
    expect(await owner.outletReferences(outlet.id)).toEqual([])

    await owner.deleteOutlet(outlet.id)

    expect(await owner.getOutlet(outlet.id)).toBeNull()
  })

  it('refuses a populated one, and says what is attached', async () => {
    // The RPC, reached the way the app reaches it. Nothing below this line has
    // ever been exercised through PostgREST.
    const references = await owner.outletReferences(KALYANI)

    expect(references.length).toBeGreaterThan(0)
    // Identifiers the surface can map to words, and counts it can render.
    // Since multi-outlet-people it is the ASSIGNMENT that points at an outlet,
    // so that is the row that refuses its deletion.
    expect(references.map((reference) => reference.table)).toContain('assignments')
    for (const reference of references) {
      expect(reference.count).toBeGreaterThan(0)
      expect(Number.isInteger(reference.count)).toBe(true)
    }
    // Only what is attached — never a row of zeroes for the caller to filter.
    expect(references.every((reference) => reference.count > 0)).toBe(true)

    await expect(owner.deleteOutlet(KALYANI)).rejects.toMatchObject({
      code: 'outlet_in_use',
    })

    // And the outlet is still there. A refusal removes nothing.
    expect(await owner.getOutlet(KALYANI)).not.toBeNull()
  })

  it('reports a policy refusal rather than reporting success', async () => {
    // The case SQL cannot show. A Franchise Admin holds the table-level DELETE
    // grant, so PostgREST issues the statement; `outlets_delete` matches no
    // row, so it removes nothing and returns 204. Without the adapter checking
    // what came back, this resolves — and the screen drops an outlet that is
    // still in the database.
    const outlet = await freshOutlet()

    await expect(manager.deleteOutlet(outlet.id)).rejects.toBeInstanceOf(DataActionError)
    await expect(manager.deleteOutlet(outlet.id)).rejects.toMatchObject({
      code: 'not_permitted',
    })

    expect(await owner.getOutlet(outlet.id)).not.toBeNull()
    await owner.deleteOutlet(outlet.id)
  })

  it('refuses a manager the reference counts entirely', async () => {
    // The function checks the caller's role itself rather than trusting the
    // grant, so this is a raised exception and not an empty result — an empty
    // result would read as "nothing is attached, go ahead and delete".
    await expect(manager.outletReferences(KALYANI)).rejects.toBeDefined()
  })
})
