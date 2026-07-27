/**
 * The whole setup chain, from nothing, through the real adapters.
 *
 * This is the test the project did not have, and its absence is why attendance
 * shipped unreachable: every other suite starts from a business that is already
 * configured — `seed.sql` inserts the outlets, the fixtures hard-code
 * `profile_id`, the REST attendance suite signs in as a seeded employee whose
 * link was written by SQL. None of them ever asked how a configured world comes
 * to exist, so none of them noticed that the app could not produce one.
 *
 * So this file creates its own outlet, its own manager, its own employee and
 * its own link, and only then checks somebody in. If any link in that chain
 * needs SQL, this fails.
 *
 * Requires the local stack: `npm run db:start && npm run db:reset`, then
 * `npm run test:rls`.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AttendanceActionError, DataActionError } from '../../../src/data-access/adapters'
import type { Database } from '../../../src/data-access/database.types'
import { createSupabaseAttendanceAdapter } from '../../../src/data-access/supabase-adapters/attendance'
import { createSupabaseEmployeesAdapter } from '../../../src/data-access/supabase-adapters/employees'
import { createSupabaseOutletsAdapter } from '../../../src/data-access/supabase-adapters/outlets'

const SUPABASE_URL = process.env['SUPABASE_URL'] ?? 'http://127.0.0.1:54321'
const SUPABASE_ANON_KEY =
  process.env['SUPABASE_ANON_KEY'] ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

const SEED_PASSWORD = 'shawarmania-local'
const NEW_PASSWORD = 'a-genuinely-set-password'
/** A Kalyani account, for the cross-outlet link this suite must be refused. */
const KALYANI_EMPLOYEE_PROFILE = '10000000-0000-4000-a000-000000000006'

type Client = SupabaseClient<Database>

/** Unique per run, so the suite is re-runnable without a database reset. */
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`
let seq = 0
const freshEmail = (label: string) => `setup.${label}.${RUN}.${seq++}@example.com`

function anonClient(): Client {
  return createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

async function signIn(email: string, password: string): Promise<Client> {
  const client = anonClient()
  const { error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`)
  return client
}

async function call(path: string, token: string | null, payload: Record<string, unknown>) {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  })
  const text = await response.text()
  return { status: response.status, body: (text ? JSON.parse(text) : {}) as Record<string, string> }
}

/** Provision, redeem, sign in — the three steps that make a usable account. */
async function onboard(
  token: string,
  role: string,
  outletId: string,
  fullName: string,
): Promise<{ client: Client; profileId: string }> {
  const email = freshEmail(role)
  const provisioned = await call('admin-accounts', token, {
    action: 'provision',
    fullName,
    email,
    role,
    outletId,
  })
  expect(provisioned.status).toBe(201)

  const redeemed = await call('redeem-invite', null, {
    email,
    code: provisioned.body['code'],
    password: NEW_PASSWORD,
  })
  expect(redeemed.status).toBe(204)

  return {
    client: await signIn(email, NEW_PASSWORD),
    profileId: provisioned.body['profileId']!,
  }
}

let owner: Client
let ownerToken: string
let outletId: string
let manager: Client
let managerToken: string
let employee: Client
let employeeProfileId: string
let employeeId: string
let businessDate: string

/**
 * The chain, once, in order. Each step depends on the previous one existing —
 * which is the property under test, so they share a walk rather than each
 * rebuilding a world.
 */
beforeAll(async () => {
  owner = await signIn('owner@example.com', SEED_PASSWORD)
  ownerToken = (await owner.auth.getSession()).data.session!.access_token

  // 1. An outlet, from nothing.
  const outlets = createSupabaseOutletsAdapter(owner)
  const created = await outlets.createOutlet({
    code: `setup-${RUN}`,
    name: `Shawarmania Probe ${RUN}`,
    locationLabel: 'Probe Lane',
    addressLine1: '1 Synthetic Road',
    city: 'Kalyani',
    phone: '911111111099',
    businessDayCutover: '04:00',
  })
  outletId = created.id

  // 2. A manager for it, who could not have been provisioned a moment ago
  //    because there was no outlet to assign them to.
  const managerAccount = await onboard(ownerToken, 'franchise_admin', outletId, 'Probe Manager')
  manager = managerAccount.client
  managerToken = (await manager.auth.getSession()).data.session!.access_token

  // 3. A person on the roster, with no login.
  const roster = createSupabaseEmployeesAdapter(manager)
  const person = await roster.createEmployee({
    outletId,
    employeeCode: 'PRB-E1',
    fullName: 'Probe Griller',
    roleTitle: 'Grill',
  })
  employeeId = person.id

  // 4. An Employee account for them, provisioned by their own manager.
  const employeeAccount = await onboard(managerToken, 'employee', outletId, 'Probe Griller')
  employee = employeeAccount.client
  employeeProfileId = employeeAccount.profileId

  businessDate = new Date().toISOString().slice(0, 10)
}, 120_000)

describe('creating an outlet', () => {
  it('produces one that judges nobody until somebody stands in it', async () => {
    const outlet = await createSupabaseOutletsAdapter(owner).getOutlet(outletId)

    expect(outlet?.latitude).toBeNull()
    expect(outlet?.location_captured_at).toBeNull()
    expect(outlet?.geofence_radius_m).toBe(150)
    expect(outlet?.is_active).toBe(true)
  })

  it('refuses a code another outlet already holds, legibly', async () => {
    await expect(
      createSupabaseOutletsAdapter(owner).createOutlet({
        code: 'kalyani',
        name: 'Impostor',
        locationLabel: 'Nowhere',
      }),
    ).rejects.toBeInstanceOf(DataActionError)
  })

  it('is refused for a Franchise Admin by the database, not by the form', async () => {
    await expect(
      createSupabaseOutletsAdapter(manager).createOutlet({
        code: `sneaky-${RUN}`,
        name: 'Not Yours',
        locationLabel: 'Nowhere',
      }),
    ).rejects.toBeTruthy()
  })

  it('hides a closed outlet from assignment lists and keeps it for the owner', async () => {
    const outlets = createSupabaseOutletsAdapter(owner)
    await outlets.updateOutlet(outletId, { isActive: false })

    const assignable = await outlets.listOutlets()
    const managed = await outlets.listOutlets({ includeInactive: true })
    expect(assignable.map((o) => o.id)).not.toContain(outletId)
    expect(managed.map((o) => o.id)).toContain(outletId)

    await outlets.updateOutlet(outletId, { isActive: true })
  })
})

describe('linking an account to a roster row', () => {
  it('is invisible to the person until it exists', async () => {
    const own = await createSupabaseEmployeesAdapter(employee).getOwnEmployee()
    expect(own).toBeNull()
  })

  it('refuses an account from another outlet', async () => {
    await expect(
      createSupabaseEmployeesAdapter(manager).linkAccount(employeeId, KALYANI_EMPLOYEE_PROFILE),
    ).rejects.toBeInstanceOf(DataActionError)
  })

  it('joins the two, and the person can then find themselves', async () => {
    const roster = createSupabaseEmployeesAdapter(manager)
    const linked = await roster.linkAccount(employeeId, employeeProfileId)
    expect(linked.profileId).toBe(employeeProfileId)
    // The embedded select is the fragile part: a wrong relationship name gives
    // a row with no `profiles` key at all, and every screen would render the
    // person as having no account.
    expect(linked.linkedAccount).toEqual({
      id: employeeProfileId,
      fullName: 'Probe Griller',
      isActive: true,
    })

    const own = await createSupabaseEmployeesAdapter(employee).getOwnEmployee()
    expect(own?.id).toBe(employeeId)
    expect(own?.employeeCode).toBe('PRB-E1')
    // And the embed resolves for the employee too, whose only readable profile
    // is their own — which is the one their roster row points at.
    expect(own?.linkedAccount?.fullName).toBe('Probe Griller')
  })

  it('refuses to hand the same account to a second person', async () => {
    const roster = createSupabaseEmployeesAdapter(manager)
    const second = await roster.createEmployee({
      outletId,
      employeeCode: 'PRB-E2',
      fullName: 'Probe Helper',
    })

    await expect(roster.linkAccount(second.id, employeeProfileId)).rejects.toBeInstanceOf(
      DataActionError,
    )
    expect(second.linkedAccount).toBeNull()
  })

  it('shows the manager who can and cannot check in', async () => {
    const list = await createSupabaseEmployeesAdapter(manager).listEmployees(outletId)

    expect(list.find((row) => row.employeeCode === 'PRB-E1')?.linkedAccount?.fullName).toBe(
      'Probe Griller',
    )
    expect(list.find((row) => row.employeeCode === 'PRB-E2')?.linkedAccount).toBeNull()
  })
})

describe('the check-in the whole chain existed for', () => {
  it('is refused while the outlet is marked closed', async () => {
    await createSupabaseOutletsAdapter(owner).updateOutlet(outletId, { isActive: false })

    const attendance = createSupabaseAttendanceAdapter(employee)
    const refusal = attendance.checkIn({
      employeeId,
      outletId,
      businessDate,
      reading: {
        latitude: 22.975,
        longitude: 88.4345,
        accuracyMetres: 15,
        at: new Date().toISOString(),
      },
    })

    await expect(refusal).rejects.toBeInstanceOf(AttendanceActionError)
    await expect(refusal).rejects.toThrow(/marked closed/)
  })

  it('works the moment the outlet is reopened', async () => {
    await createSupabaseOutletsAdapter(owner).updateOutlet(outletId, { isActive: true })

    const attendance = createSupabaseAttendanceAdapter(employee)
    const record = await attendance.checkIn({
      employeeId,
      outletId,
      businessDate,
      reading: {
        latitude: 22.975,
        longitude: 88.4345,
        accuracyMetres: 15,
        at: new Date().toISOString(),
      },
    })

    // The outlet was never surveyed, so there is nothing to judge against and
    // nobody is denied for the owner's omission.
    expect(record.status).toBe('present')
    expect(record.checkIn?.distanceMetres).toBeNull()
  })

  it('lets somebody finish a shift that outlived the shop being open', async () => {
    await createSupabaseOutletsAdapter(owner).updateOutlet(outletId, { isActive: false })

    const attendance = createSupabaseAttendanceAdapter(employee)
    const day = await attendance.getDay(employeeId, businessDate)
    const closed = await attendance.checkOut({
      attendanceId: day!.id,
      reading: {
        latitude: 22.975,
        longitude: 88.4345,
        accuracyMetres: 15,
        at: new Date().toISOString(),
      },
    })

    expect(closed.checkOut).not.toBeNull()

    await createSupabaseOutletsAdapter(owner).updateOutlet(outletId, { isActive: true })
  })

  it('stops at unlinking, and keeps the day that was worked', async () => {
    const roster = createSupabaseEmployeesAdapter(manager)
    await roster.unlinkAccount(employeeId)

    // The person cannot find themselves, nor read the day.
    expect(await createSupabaseEmployeesAdapter(employee).getOwnEmployee()).toBeNull()
    expect(await createSupabaseAttendanceAdapter(employee).listHistory(employeeId)).toEqual([])

    // The manager still sees it, because it happened.
    const day = await createSupabaseAttendanceAdapter(manager).getDay(employeeId, businessDate)
    expect(day?.checkIn).not.toBeNull()
    expect(day?.checkOut).not.toBeNull()
  })
})

/**
 * Outlets are not deletable, by design, and this suite makes a real one on every
 * run. Left trading it would clutter the local app's outlet list and every
 * assignment dropdown for whoever opens the app next — so the probe shop is
 * marked closed, which is exactly what "this shop is not trading" is for.
 */
afterAll(async () => {
  if (!outletId) return
  await createSupabaseOutletsAdapter(owner).updateOutlet(outletId, { isActive: false })
})
