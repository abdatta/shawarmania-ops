/**
 * The attendance adapters, run against the real stack.
 *
 * Everything else proves a different layer: pgTAP proves the policies and the
 * geofence trigger with simulated claims, the component suites prove the
 * screens against mocks, and the Playwright walk proves the demo tree. None of
 * them ever executes `createSupabaseAttendanceAdapter` — so an embedded select
 * that PostgREST rejects, a column renamed in a migration, or a mapping that
 * quietly yields undefined would ship green. This closes that gap.
 *
 * Requires the local stack: `npm run db:start && npm run db:reset`, then
 * `npm run test:rls`.
 *
 * Unlike rls-probes.test.ts, this file **writes**. It is written to survive a
 * re-run against the same reset: a check-in that is already recorded is read
 * back and asserted instead of being made twice.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { beforeAll, describe, expect, it } from 'vitest'

import { AttendanceActionError } from '../../../src/data-access/adapters'
import type { Database } from '../../../src/data-access/database.types'
import { createSupabaseAttendanceAdapter } from '../../../src/data-access/supabase-adapters/attendance'
import { createSupabaseEmployeesAdapter } from '../../../src/data-access/supabase-adapters/employees'
import { createSupabaseOutletsAdapter } from '../../../src/data-access/supabase-adapters/outlets'

const SUPABASE_URL = process.env['SUPABASE_URL'] ?? 'http://127.0.0.1:54321'
const SUPABASE_ANON_KEY =
  process.env['SUPABASE_ANON_KEY'] ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

const PASSWORD = 'shawarmania-local'
const OUTLET_KALYANI = '00000000-0000-4000-a000-000000000001'
const KAL_E1 = '20000000-0000-4000-a000-000000000001'
const FA_KALYANI_SUB = '10000000-0000-4000-a000-000000000002'

type Client = SupabaseClient<Database>

async function signIn(email: string): Promise<Client> {
  const client = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD })
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`)
  return client
}

/** Yesterday's business date, which the seed populated. */
function yesterday(): string {
  const date = new Date()
  date.setDate(date.getDate() - 1)
  return date.toISOString().slice(0, 10)
}

let employeeClient: Client
let managerClient: Client

beforeAll(async () => {
  employeeClient = await signIn('staff.kalyani@example.com')
  managerClient = await signIn('admin.kalyani@example.com')
}, 30_000)

describe('the employees adapter', () => {
  it('finds the signed-in person’s own roster row', async () => {
    const employees = createSupabaseEmployeesAdapter(employeeClient)
    const own = await employees.getOwnEmployee()

    expect(own).not.toBeNull()
    expect(own?.id).toBe(KAL_E1)
    expect(own?.employeeCode).toBe('KAL-E1')
    expect(own?.employmentStatus).toBe('active')
  })

  it('lists an outlet’s roster for its manager', async () => {
    const employees = createSupabaseEmployeesAdapter(managerClient)
    const roster = await employees.listEmployees(OUTLET_KALYANI)

    expect(roster.length).toBeGreaterThanOrEqual(2)
    expect(roster.every((row) => row.outletId === OUTLET_KALYANI)).toBe(true)
    // Explicit columns, and the mapping produces no undefined fields.
    for (const row of roster) {
      expect(row.fullName).toBeTruthy()
      expect(row.employeeCode).toBeTruthy()
      expect(row.employmentStatus).toBeTruthy()
    }
  })
})

describe('the attendance adapter', () => {
  it('reads a day with the employee’s name joined in', async () => {
    const attendance = createSupabaseAttendanceAdapter(managerClient)
    const day = await attendance.listOutletDay(OUTLET_KALYANI, yesterday())

    expect(day.length).toBeGreaterThan(0)
    const own = day.find((record) => record.employeeId === KAL_E1)
    expect(own).toBeDefined()
    // The embedded select is the fragile part: PostgREST would return the row
    // with no `employees` key at all if the relationship name were wrong, and
    // the surfaces would render blank names.
    expect(own?.employeeName).toBe('Synthetic Staff Kal')
    expect(own?.employeeCode).toBe('KAL-E1')
  })

  it('maps the evidence the database computed, not what a client claimed', async () => {
    const attendance = createSupabaseAttendanceAdapter(employeeClient)
    const day = await attendance.getDay(KAL_E1, yesterday())

    expect(day?.checkIn).not.toBeNull()
    // The seed claimed 12 m; the trigger stored what the coordinates imply.
    expect(day?.checkIn?.distanceMetres).toBeCloseTo(11.65, 1)
    expect(day?.checkIn?.accuracyMetres).toBe(18)
    expect(day?.checkIn?.source).toBe('phone')
    expect(day?.status).toBe('present')
  })

  it('reads an employee’s own history, and nothing else', async () => {
    const attendance = createSupabaseAttendanceAdapter(employeeClient)
    const history = await attendance.listHistory(KAL_E1)

    expect(history.length).toBeGreaterThan(0)
    expect(history.every((record) => record.employeeId === KAL_E1)).toBe(true)
    // Most recent first, as the history screen renders them.
    const dates = history.map((record) => record.businessDate)
    expect([...dates].sort().reverse()).toEqual(dates)
  })

  it('records a check-in, and the database adjudicates the claim', async () => {
    const attendance = createSupabaseAttendanceAdapter(employeeClient)
    const outlets = createSupabaseOutletsAdapter(employeeClient)
    const outlet = await outlets.getOutlet(OUTLET_KALYANI)
    expect(outlet).not.toBeNull()

    const today = new Date().toISOString().slice(0, 10)
    const existing = await attendance.getDay(KAL_E1, today)

    const record =
      existing ??
      (await attendance.checkIn({
        employeeId: KAL_E1,
        outletId: OUTLET_KALYANI,
        businessDate: today,
        // Beyond the 150 m fence: the adapter sends `present`, and the row
        // must come back `absent`.
        reading: {
          latitude: 22.984,
          longitude: 88.4345,
          accuracyMetres: 20,
          at: new Date().toISOString(),
        },
      }))

    expect(record.checkIn).not.toBeNull()
    expect(record.checkIn?.distanceMetres).toBeGreaterThan(outlet!.geofence_radius_m)
    expect(record.status).toBe('absent')
  })

  it('refuses an override with a blank reason before it reaches the database', async () => {
    const attendance = createSupabaseAttendanceAdapter(managerClient)
    const day = await attendance.listOutletDay(OUTLET_KALYANI, yesterday())

    await expect(attendance.approveOverride(day[0]!.id, '   ', FA_KALYANI_SUB)).rejects.toThrow(
      AttendanceActionError,
    )
  })

  it('turns a policy refusal into something worth reading at a counter', async () => {
    // An employee attempting to approve their own day: the guard raises, and
    // the adapter must not surface a raw Postgres message.
    const attendance = createSupabaseAttendanceAdapter(employeeClient)
    const day = await attendance.getDay(KAL_E1, yesterday())

    await expect(
      attendance.approveOverride(day!.id, 'self approved', KAL_E1),
    ).rejects.toBeInstanceOf(AttendanceActionError)
  })
})

describe('the outlets adapter', () => {
  it('exposes the capture evidence the owner screen reads', async () => {
    const outlets = createSupabaseOutletsAdapter(managerClient)
    const outlet = await outlets.getOutlet(OUTLET_KALYANI)

    expect(outlet?.location_accuracy_m).toBe(9)
    expect(outlet?.location_captured_at).toBeTruthy()
  })

  it('cannot save a position as anyone but the Super Admin', async () => {
    const outlets = createSupabaseOutletsAdapter(managerClient)

    // `.single()` on a filtered-away update: PostgREST returns no rows, which
    // the adapter surfaces as an error rather than as a silent success.
    await expect(
      outlets.saveLocation(OUTLET_KALYANI, {
        latitude: 1,
        longitude: 1,
        accuracyMetres: 5,
        radiusMetres: 5000,
      }),
    ).rejects.toBeTruthy()
  })
})
