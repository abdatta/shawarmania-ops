/**
 * The whole setup chain, from nothing, through the real adapters.
 *
 * This is the test the project did not have, and its absence is why attendance
 * shipped unreachable: every other suite starts from a business that is already
 * configured. None of them ever asked how a configured world comes to exist, so
 * none of them noticed that the app could not produce one.
 *
 * Staff exist only as accounts, so the chain is shorter than it used to be:
 * an outlet, a manager for it, an employee provisioned by that manager — and
 * the moment the employee activates, they can check in. There is no roster row
 * to create and no link to write, which is the point of staff-as-accounts.
 *
 * Requires the local stack: `npm run db:start && npm run db:reset`, then
 * `npm run test:rls`.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  AccountActionError,
  AttendanceActionError,
  DataActionError,
} from '../../../src/data-access/adapters'
import type { Database } from '../../../src/data-access/database.types'
import { createSupabaseAccountsAdapter } from '../../../src/data-access/supabase-adapters/accounts'
import { createSupabaseAttendanceAdapter } from '../../../src/data-access/supabase-adapters/attendance'
import { createSupabaseOutletsAdapter } from '../../../src/data-access/supabase-adapters/outlets'
import { resolveBusinessDate } from '../../../src/domain/datetime'

const SUPABASE_URL = process.env['SUPABASE_URL'] ?? 'http://127.0.0.1:54321'
const SUPABASE_ANON_KEY =
  process.env['SUPABASE_ANON_KEY'] ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

const SEED_PASSWORD = 'shawarmania-local'
const NEW_PASSWORD = 'a-genuinely-set-password'
/** A Kalyani person, for the cross-outlet edit this suite must be refused. */
const KALYANI_EMPLOYEE_PROFILE = '10000000-0000-4000-a000-000000000006'
const KALYANI_OUTLET = '00000000-0000-4000-a000-000000000001'

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

/** Provision, redeem, sign in — the three steps that make a usable person. */
async function onboard(
  token: string,
  role: string,
  outletId: string,
  fullName: string,
  extras: Record<string, unknown> = {},
): Promise<{ client: Client; profileId: string }> {
  const email = freshEmail(role)
  const provisioned = await call('admin-accounts', token, {
    action: 'provision',
    fullName,
    email,
    role,
    outletIds: [outletId],
    ...extras,
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

  // 3. An Employee, provisioned by their own manager — one act, staff facts
  //    included. There is no roster row and no link: the account is the
  //    person, and the database issues their staff code as the row lands.
  const employeeAccount = await onboard(managerToken, 'employee', outletId, 'Probe Griller', {
    roleTitle: 'Grill',
    joinedOn: '2026-07-01',
  })
  employee = employeeAccount.client
  employeeProfileId = employeeAccount.profileId

  businessDate = resolveBusinessDate(new Date(), '04:00')
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

describe('the person the one act created', () => {
  it('carries the job title the form sent, and the assignment that placed them', async () => {
    const people = await createSupabaseAccountsAdapter(manager).listAccounts()
    const person = people.find((row) => row.id === employeeProfileId)

    expect(person).toBeDefined()
    expect(person?.roleTitle).toBe('Grill')

    // One act wrote both rows: the account, and the assignment that says where
    // they work. An account with neither would be a person who exists and
    // works nowhere.
    const live = (person?.assignments ?? []).filter((a) => a.endedOn === null)
    expect(live).toHaveLength(1)
    expect(live[0]?.role).toBe('employee')
    expect(live[0]?.outletId).toBe(outletId)
    expect(live[0]?.startedOn).toBe('2026-07-01')
  })

  it('can read their own person record the moment they activate', async () => {
    const { data, error } = await employee
      .from('profiles')
      .select('id, full_name, role_title')
      .eq('id', employeeProfileId)
      .single()

    expect(error).toBeNull()
    expect(data?.full_name).toBe('Probe Griller')
    expect(data?.role_title).toBe('Grill')
  })

  it('reads their own assignment, which is what says where they may check in', async () => {
    const { data, error } = await employee
      .from('assignments')
      .select('role, outlet_id, ended_on')
      .eq('person_id', employeeProfileId)

    expect(error).toBeNull()
    expect(data).toEqual([{ role: 'employee', outlet_id: outletId, ended_on: null }])
  })

  it('has staff facts their manager can edit, under RLS', async () => {
    const accounts = createSupabaseAccountsAdapter(manager)
    const updated = await accounts.updateStaffFacts(employeeProfileId, {
      roleTitle: 'Senior Grill',
    })
    expect(updated.roleTitle).toBe('Senior Grill')
  })

  it('whose placement the manager cannot move to an outlet they do not manage', async () => {
    // Where somebody works is not a staff fact any more — it is an assignment,
    // with its own policy. A manager may place people at outlets they manage
    // and nowhere else, whatever the request says.
    const { error } = await manager.from('assignments').insert({
      person_id: employeeProfileId,
      role: 'employee',
      outlet_id: KALYANI_OUTLET,
    })
    expect(error?.code).toBe('42501')
  })

  it('and a person at another outlet is out of the manager’s reach entirely', async () => {
    const accounts = createSupabaseAccountsAdapter(manager)
    await expect(
      accounts.updateStaffFacts(KALYANI_EMPLOYEE_PROFILE, { roleTitle: 'Smuggled' }),
    ).rejects.toBeInstanceOf(AccountActionError)
  })

  it('cannot be deleted over REST by anybody', async () => {
    // Clients hold no delete grant on profiles at all; the FK boundary behind
    // it is proved in pgTAP with hand-crafted deletes at the auth layer too.
    const { error } = await manager.from('profiles').delete().eq('id', employeeProfileId)
    expect(error?.code).toBe('42501')
  })
})

describe('the check-in the whole chain existed for', () => {
  it('is refused while the outlet is marked closed', async () => {
    await createSupabaseOutletsAdapter(owner).updateOutlet(outletId, { isActive: false })

    const attendance = createSupabaseAttendanceAdapter(employee)
    const refusal = attendance.checkIn({
      personId: employeeProfileId,
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
      personId: employeeProfileId,
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
    const day = await attendance.getDay(employeeProfileId, businessDate, outletId)
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

  it('survives the person leaving — the days were worked', async () => {
    const accounts = createSupabaseAccountsAdapter(manager)
    const before = (await accounts.listAccounts()).find((row) => row.id === employeeProfileId)
    const live = (before?.assignments ?? []).find((a) => a.endedOn === null)
    expect(live).toBeDefined()

    await accounts.endAssignment(live!.id)

    // The record is not erased by the departure; the manager still reads it,
    // and so does the person — it is their own history.
    const day = await createSupabaseAttendanceAdapter(manager).getDay(
      employeeProfileId,
      businessDate,
      outletId,
    )
    expect(day?.checkIn).not.toBeNull()
    expect(day?.checkOut).not.toBeNull()

    const ownHistory =
      await createSupabaseAttendanceAdapter(employee).listHistory(employeeProfileId)
    expect(ownHistory.length).toBeGreaterThan(0)

    // Ending their last assignment takes them out of this manager's reach
    // entirely — they no longer share an outlet, and that is the isolation
    // working rather than the account having gone anywhere. The owner can
    // still see them, and still place them back.
    const stillHere = (await accounts.listAccounts()).find((row) => row.id === employeeProfileId)
    expect(stillHere).toBeUndefined()

    const asOwner = createSupabaseAccountsAdapter(owner)
    const seen = (await asOwner.listAccounts()).find((row) => row.id === employeeProfileId)
    expect(seen).toBeDefined()
    // Ended, not deleted: the rows it produced stay explicable.
    expect(seen?.assignments.some((a) => a.endedOn !== null)).toBe(true)

    await asOwner.grantAssignment({ personId: employeeProfileId, role: 'employee', outletId })
    const back = (await asOwner.listAccounts()).find((row) => row.id === employeeProfileId)
    expect(back?.assignments.filter((a) => a.endedOn === null)).toHaveLength(1)
  })
})

/**
 * Outlets are not deletable while anything references them, and this suite
 * makes a real one with real people on every run. Left trading it would
 * clutter the local app's outlet list — so the probe shop is marked closed,
 * which is exactly what "this shop is not trading" is for.
 */
afterAll(async () => {
  if (!outletId) return
  await createSupabaseOutletsAdapter(owner).updateOutlet(outletId, { isActive: false })
})
