/**
 * Issued staff codes, through the real adapter and over the wire.
 *
 * `13_generated_staff_codes.sql` proves the triggers in SQL and the component
 * tests prove the screens. The seam between them is where this change is most
 * fragile, for one specific reason: **`toStaffFactsError` recognises the
 * owner-only refusal by matching the trigger's message text.** There is no
 * constraint name to match and no SQLSTATE that distinguishes it from any
 * other `insufficient_privilege`, so if PostgREST reformats, truncates or
 * wraps that message, the match silently fails and a manager gets "That did
 * not work. Try again in a moment." instead of being told the owner has to do
 * it. Nothing below the adapter can catch that, because in SQL the message is
 * exactly what the trigger raised.
 *
 * Issuing itself is proved where creation happens: the provision path in
 * outlet-and-staff-setup.test.ts, whose one act yields a person already
 * carrying a code. What remains here is who may change one afterwards —
 * asserted against the seeded Kalyani staff, and always restored, because the
 * pgTAP positive controls key on the seeded codes.
 *
 * Requires the local stack: `npm run db:start && npm run db:reset`, then
 * `npm run test:rls`.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { beforeAll, describe, expect, it } from 'vitest'

import { AccountActionError } from '../../../src/data-access/adapters'
import type { Database } from '../../../src/data-access/database.types'
import { createSupabaseAccountsAdapter } from '../../../src/data-access/supabase-adapters/accounts'
import { createSupabaseOutletsAdapter } from '../../../src/data-access/supabase-adapters/outlets'

const SUPABASE_URL = process.env['SUPABASE_URL'] ?? 'http://127.0.0.1:54321'
const SUPABASE_ANON_KEY =
  process.env['SUPABASE_ANON_KEY'] ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

const SEED_PASSWORD = 'shawarmania-local'
const KALYANI = '00000000-0000-4000-a000-000000000001'
/** Synthetic Staff Kal — seeded with staff code KAL-E1, which must survive. */
const STAFF_KAL = '10000000-0000-4000-a000-000000000006'

/** Unique per run, so the suite is re-runnable without a database reset. */
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`
let seq = 0

type Client = SupabaseClient<Database>

async function signIn(email: string): Promise<Client> {
  const client = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error } = await client.auth.signInWithPassword({ email, password: SEED_PASSWORD })
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`)
  return client
}

let ownerPeople: ReturnType<typeof createSupabaseAccountsAdapter>
let managerPeople: ReturnType<typeof createSupabaseAccountsAdapter>
let ownerOutlets: ReturnType<typeof createSupabaseOutletsAdapter>

beforeAll(async () => {
  const owner = await signIn('owner@example.com')
  const manager = await signIn('admin.kalyani@example.com')
  ownerPeople = createSupabaseAccountsAdapter(owner)
  managerPeople = createSupabaseAccountsAdapter(manager)
  ownerOutlets = createSupabaseOutletsAdapter(owner)
})

describe('changing a staff code over REST', () => {
  it('refuses a manager, as a sentence rather than a raw trigger message', async () => {
    // The case this file exists for. `toStaffFactsError` matches the
    // trigger's message text — there is no constraint name and no
    // distinguishing SQLSTATE — so this is the only place that proves the
    // match survives the trip through PostgREST.
    await expect(
      managerPeople.updateStaffFacts(STAFF_KAL, { staffCode: 'KAL-ZZZ9' }),
    ).rejects.toBeInstanceOf(AccountActionError)
    await expect(
      managerPeople.updateStaffFacts(STAFF_KAL, { staffCode: 'KAL-ZZZ9' }),
    ).rejects.toMatchObject({ code: 'code_not_yours' })

    // And the code did not move.
    const after = await managerPeople.listAccounts()
    expect(after.find((candidate) => candidate.id === STAFF_KAL)?.staffCode).toBe('KAL-E1')
  })

  it('lets a manager edit everything else on the same record', async () => {
    // The guard is about one column, not the row. A manager still maintains
    // the staff facts, and a change that broke that would be far worse than
    // the one it was meant to prevent.
    const renamed = await managerPeople.updateStaffFacts(STAFF_KAL, {
      roleTitle: `Shift lead ${RUN}`,
    })
    expect(renamed.roleTitle).toBe(`Shift lead ${RUN}`)
    expect(renamed.staffCode).toBe('KAL-E1')

    // Put the seeded fact back; this suite leaves the world as it found it.
    await managerPeople.updateStaffFacts(STAFF_KAL, { roleTitle: 'Counter staff' })
  })

  it('lets the owner change one — and restores it, because the seeds key on it', async () => {
    const next = `KAL-O${RUN}${seq++}`.toUpperCase().slice(0, 12)
    const updated = await ownerPeople.updateStaffFacts(STAFF_KAL, { staffCode: next })
    expect(updated.staffCode).toBe(next)

    const restored = await ownerPeople.updateStaffFacts(STAFF_KAL, { staffCode: 'KAL-E1' })
    expect(restored.staffCode).toBe('KAL-E1')
  })

  it('refuses blanking an issued code, even for the owner, legibly', async () => {
    await expect(
      ownerPeople.updateStaffFacts(STAFF_KAL, { staffCode: '   ' }),
    ).rejects.toMatchObject({ code: 'code_required' })
  })

  it('refuses a code already worn at the same outlet, legibly', async () => {
    await expect(
      ownerPeople.updateStaffFacts(STAFF_KAL, { staffCode: 'KAL-E2' }),
    ).rejects.toMatchObject({ code: 'code_taken' })
  })
})

describe('the outlet prefix over REST', () => {
  it('derives one when the app sends none', async () => {
    const outlet = await ownerOutlets.createOutlet({
      code: `pfx${RUN}${seq++}`,
      name: 'Prefix Derived',
      locationLabel: 'Nowhere',
    })
    // `not null` with no value sent: only the trigger can have filled this.
    expect(outlet.staff_code_prefix).toMatch(/^[A-Z0-9]{3}$/)
    await ownerOutlets.deleteOutlet(outlet.id)
  })

  it('keeps the prefix the form supplied, uppercased', async () => {
    const outlet = await ownerOutlets.createOutlet({
      code: `pfx${RUN}${seq++}`,
      name: 'Prefix Supplied',
      locationLabel: 'Nowhere',
      staffCodePrefix: 'zq7',
    })
    expect(outlet.staff_code_prefix).toBe('ZQ7')
    await ownerOutlets.deleteOutlet(outlet.id)
  })

  it('names the prefix, not the outlet code, when the prefix is taken', async () => {
    // Both refusals arrive as 23505. Reporting this one as a duplicate outlet
    // code would send the owner to correct a field that is perfectly fine.
    const first = await ownerOutlets.createOutlet({
      code: `pfx${RUN}${seq++}`,
      name: 'Prefix Holder',
      locationLabel: 'Nowhere',
      staffCodePrefix: 'ZQ8',
    })

    await expect(
      ownerOutlets.createOutlet({
        code: `pfx${RUN}${seq++}`,
        name: 'Prefix Clash',
        locationLabel: 'Nowhere',
        staffCodePrefix: 'ZQ8',
      }),
    ).rejects.toMatchObject({ code: 'prefix_taken' })

    await ownerOutlets.deleteOutlet(first.id)
  })

  it('lets the prefix move while nobody has been hired', async () => {
    const outlet = await ownerOutlets.createOutlet({
      code: `pfx${RUN}${seq++}`,
      name: 'Prefix Movable',
      locationLabel: 'Nowhere',
    })
    const first = outlet.staff_code_prefix

    // Derived from the code, so pick something that cannot be what it already
    // is. Free to change, because no code has been issued from it yet — which
    // is exactly when an owner notices they would rather have something else.
    const wanted = first === 'ZR1' ? 'ZR2' : 'ZR1'
    const moved = await ownerOutlets.updateOutlet(outlet.id, { staffCodePrefix: wanted })
    expect(moved.staff_code_prefix).toBe(wanted)

    await ownerOutlets.deleteOutlet(outlet.id)
  })

  it('freezes the prefix once a code has been issued from it', async () => {
    // Asserted against Kalyani, whose seeded people already carry KAL- codes,
    // rather than by provisioning somebody into a throwaway outlet: people
    // are not deletable, so that outlet could never be cleaned up, and it
    // would hold a three-character prefix out of a very small space on every
    // run. This version writes nothing and cleans up nothing.
    await expect(
      ownerOutlets.updateOutlet(KALYANI, { staffCodePrefix: 'ZR9' }),
    ).rejects.toMatchObject({ code: 'prefix_frozen' })

    const unchanged = await ownerOutlets.getOutlet(KALYANI)
    expect(unchanged?.staff_code_prefix).toBe('KAL')
  })
})
