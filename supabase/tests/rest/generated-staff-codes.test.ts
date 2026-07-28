/**
 * Issued staff codes, through the real adapter and over the wire.
 *
 * `13_generated_staff_codes.sql` proves the triggers in SQL and the component
 * tests prove the screens. The seam between them is where this change is most
 * fragile, for one specific reason: **`asRosterError` recognises the owner-only
 * refusal by matching the trigger's message text.** There is no constraint name
 * to match and no SQLSTATE that distinguishes it from any other
 * `insufficient_privilege`, so if PostgREST reformats, truncates or wraps that
 * message, the match silently fails and a manager gets "That did not work. Try
 * again in a moment." instead of being told the owner has to do it. Nothing
 * below the adapter can catch that, because in SQL the message is exactly what
 * the trigger raised.
 *
 * The other half is issuing itself: the app omits `employee_code` from the
 * insert entirely, and a trigger fills it. If the column were ever sent as an
 * empty string, or the grant did not permit omitting it, this is the only place
 * that shows.
 *
 * Requires the local stack: `npm run db:start && npm run db:reset`, then
 * `npm run test:rls`.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { beforeAll, describe, expect, it } from 'vitest'

import { DataActionError } from '../../../src/data-access/adapters'
import type { Database } from '../../../src/data-access/database.types'
import { createSupabaseEmployeesAdapter } from '../../../src/data-access/supabase-adapters/employees'
import { createSupabaseOutletsAdapter } from '../../../src/data-access/supabase-adapters/outlets'

const SUPABASE_URL = process.env['SUPABASE_URL'] ?? 'http://127.0.0.1:54321'
const SUPABASE_ANON_KEY =
  process.env['SUPABASE_ANON_KEY'] ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

const SEED_PASSWORD = 'shawarmania-local'
const KALYANI = '00000000-0000-4000-a000-000000000001'

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

let ownerRoster: ReturnType<typeof createSupabaseEmployeesAdapter>
let managerRoster: ReturnType<typeof createSupabaseEmployeesAdapter>
let ownerOutlets: ReturnType<typeof createSupabaseOutletsAdapter>

beforeAll(async () => {
  const owner = await signIn('owner@example.com')
  const manager = await signIn('admin.kalyani@example.com')
  ownerRoster = createSupabaseEmployeesAdapter(owner)
  managerRoster = createSupabaseEmployeesAdapter(manager)
  ownerOutlets = createSupabaseOutletsAdapter(owner)
})

describe('issuing a staff code over REST', () => {
  it('issues one when the app sends no code at all', async () => {
    // Exactly what the Staff form does now: name and done.
    const created = await managerRoster.createEmployee({
      outletId: KALYANI,
      fullName: `REST Issued ${RUN}-${seq++}`,
    })

    // Shape, never a literal. The database picks it.
    expect(created.employeeCode).toMatch(/^KAL-[0-9A-HJKMNP-TV-Z]{4}$/)
  })

  it('gives two people at one outlet two different codes', async () => {
    const a = await managerRoster.createEmployee({
      outletId: KALYANI,
      fullName: `REST Twin A ${RUN}-${seq++}`,
    })
    const b = await managerRoster.createEmployee({
      outletId: KALYANI,
      fullName: `REST Twin B ${RUN}-${seq++}`,
    })
    expect(a.employeeCode).not.toBe(b.employeeCode)
  })

  it('keeps a code that was actually supplied', async () => {
    // Carries RUN so the suite is genuinely re-runnable against the same
    // database: `employees_code_unique_per_outlet` is what a fixed literal
    // would collide with on the second run.
    const explicit = `KAL-X${RUN}${seq++}`.toUpperCase()
    const created = await managerRoster.createEmployee({
      outletId: KALYANI,
      fullName: `REST Explicit ${RUN}`,
      employeeCode: explicit,
    })
    expect(created.employeeCode).toBe(explicit)
  })
})

describe('changing a staff code over REST', () => {
  it('refuses a manager, as a sentence rather than a raw trigger message', async () => {
    // The case this file exists for. `asRosterError` matches the trigger's
    // message text — there is no constraint name and no distinguishing
    // SQLSTATE — so this is the only place that proves the match survives the
    // trip through PostgREST.
    const row = await managerRoster.createEmployee({
      outletId: KALYANI,
      fullName: `REST Manager Edit ${RUN}-${seq++}`,
    })

    await expect(
      managerRoster.updateEmployee(row.id, { employeeCode: 'KAL-ZZZ9' }),
    ).rejects.toBeInstanceOf(DataActionError)
    await expect(
      managerRoster.updateEmployee(row.id, { employeeCode: 'KAL-ZZZ9' }),
    ).rejects.toMatchObject({ code: 'code_not_yours' })

    // And the code did not move.
    const after = await managerRoster.listEmployees(KALYANI)
    expect(after.find((candidate) => candidate.id === row.id)?.employeeCode).toBe(row.employeeCode)
  })

  it('lets a manager edit everything else on the same row', async () => {
    // The guard is about one column, not the row. A manager still runs the
    // roster, and a change that broke that would be far worse than the one it
    // was meant to prevent.
    const row = await managerRoster.createEmployee({
      outletId: KALYANI,
      fullName: `REST Manager Rename ${RUN}-${seq++}`,
    })
    const updated = await managerRoster.updateEmployee(row.id, {
      fullName: `REST Renamed ${RUN}`,
      roleTitle: 'Shift lead',
    })
    expect(updated.fullName).toBe(`REST Renamed ${RUN}`)
    expect(updated.employeeCode).toBe(row.employeeCode)
  })

  it('lets the owner change one', async () => {
    const row = await managerRoster.createEmployee({
      outletId: KALYANI,
      fullName: `REST Owner Edit ${RUN}-${seq++}`,
    })
    const next = `KAL-O${RUN}${seq++}`.toUpperCase()
    const updated = await ownerRoster.updateEmployee(row.id, { employeeCode: next })
    expect(updated.employeeCode).toBe(next)
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
    // Asserted against Kalyani, which already has a roster, rather than by
    // hiring somebody into a throwaway outlet.
    //
    // That alternative writes a roster row this suite could never remove:
    // `employees` has no client delete path, so the row would survive, pin its
    // outlet as permanently undeletable, and hold its three-character prefix
    // out of a very small space — leaking one more on every run and failing the
    // second one. This version writes nothing and cleans up nothing.
    await expect(
      ownerOutlets.updateOutlet(KALYANI, { staffCodePrefix: 'ZR9' }),
    ).rejects.toMatchObject({ code: 'prefix_frozen' })

    const unchanged = await ownerOutlets.getOutlet(KALYANI)
    expect(unchanged?.staff_code_prefix).toBe('KAL')
  })
})
