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
import { createSupabaseOutletsAdapter } from '../../../src/data-access/supabase-adapters/outlets'
import { resolveBusinessDate } from '../../../src/domain/datetime'

const SUPABASE_URL = process.env['SUPABASE_URL'] ?? 'http://127.0.0.1:54321'
const SUPABASE_ANON_KEY =
  process.env['SUPABASE_ANON_KEY'] ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

const PASSWORD = 'shawarmania-local'
const OUTLET_KALYANI = '00000000-0000-4000-a000-000000000001'
const OUTLET_KANCHRAPARA = '00000000-0000-4000-a000-000000000002'
// Staff are accounts: attendance keys on the person's own profile id.
const KALYANI = '00000000-0000-4000-a000-000000000001'
const STAFF_KAL = '10000000-0000-4000-a000-000000000006'
const STAFF_KPA = '10000000-0000-4000-a000-000000000007'
/** Works at both outlets, which is what makes the person-range read testable. */
const SPLIT_SHIFT = '10000000-0000-4000-a000-00000000000e'
/** Kalyani's radius, from the seed. Named so an assertion reads as a claim. */
const outletRadius = 150
// Pending Staff Kal: nothing else in any suite writes attendance for them,
// which is what makes the manual-entry test's re-run check sufficient.
const PENDING_STAFF_KAL = '10000000-0000-4000-a000-00000000000c'
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

/** A range wide enough to cover everything the seed wrote. */
const WIDE_RANGE = { from: '2000-01-01', to: '2100-01-01' } as const

let employeeClient: Client
let managerClient: Client
/** The one session that reads both outlets, for the cross-outlet assertions. */
let ownerClient: Client

beforeAll(async () => {
  employeeClient = await signIn('staff.kalyani@login.shawarmania.invalid')
  managerClient = await signIn('admin.kalyani@login.shawarmania.invalid')
  ownerClient = await signIn('owner@login.shawarmania.invalid')
}, 30_000)

describe('the attendance adapter', () => {
  it('reads a day with the person’s name joined in', async () => {
    const attendance = createSupabaseAttendanceAdapter(managerClient)
    const day = await attendance.listOutletDay(OUTLET_KALYANI, yesterday())

    expect(day.length).toBeGreaterThan(0)
    const own = day.find((record) => record.personId === STAFF_KAL)
    expect(own).toBeDefined()
    // The embedded select is the fragile part: PostgREST would return the row
    // with no `profiles` key at all if the relationship name were wrong, and
    // the surfaces would render blank names.
    expect(own?.personName).toBe('Synthetic Staff Kal')
    // The outlet is named on the row too, and by the same embedded select: a
    // person may work a morning at one outlet and an evening at another, so
    // their own history has to say which day was where.
    expect(own?.outletName).toBe('Shawarmania Kalyani')
  })

  it('maps the evidence the database computed, not what a client claimed', async () => {
    const attendance = createSupabaseAttendanceAdapter(employeeClient)
    const day = await attendance.getDay(STAFF_KAL, yesterday(), KALYANI)

    expect(day?.checkIn).not.toBeNull()
    // The seed claimed 12 m; the trigger stored what the coordinates imply.
    expect(day?.checkIn?.distanceMetres).toBeCloseTo(11.65, 1)
    expect(day?.checkIn?.accuracyMetres).toBe(18)
    expect(day?.checkIn?.source).toBe('phone')
    expect(day?.checkIn?.enteredBy).toBeNull()
    expect(day?.status).toBe('present')
    // The approval that made it present, with the approver's own evidence — and
    // the deadline the outlet had when the arrival landed.
    expect(day?.approval?.byName).toBe('Synthetic Admin Kal')
    expect(day?.approval?.reason).toBeNull()
    expect(day?.approval?.distanceMetres).toBeLessThan(outletRadius)
    expect(day?.arrivalDeadline).toBe('13:00:00')
  })

  it('maps an approval taken away from the outlet, with the reason it cost', async () => {
    const attendance = createSupabaseAttendanceAdapter(ownerClient)
    const day = await attendance.listOutletDay(OUTLET_KANCHRAPARA, yesterday())
    const off = day.find((record) => record.personId === STAFF_KPA)

    expect(off?.approval).not.toBeNull()
    expect(off?.approval?.reason).toContain('called in from home')
    // Over a kilometre out: recorded, not refused, and visible as such.
    expect(off?.approval?.distanceMetres).toBeGreaterThan(1000)
  })

  it('reads a person’s own history over a range, and nothing else', async () => {
    const attendance = createSupabaseAttendanceAdapter(employeeClient)
    const history = await attendance.listHistory(STAFF_KAL, WIDE_RANGE.from, WIDE_RANGE.to)

    expect(history.length).toBeGreaterThan(0)
    expect(history.every((record) => record.personId === STAFF_KAL)).toBe(true)
    // Most recent first, as the history screen renders them.
    const dates = history.map((record) => record.businessDate)
    expect([...dates].sort().reverse()).toEqual(dates)

    // And the range bounds it: a window that excludes every seeded day is empty
    // rather than quietly ignored.
    const none = await attendance.listHistory(STAFF_KAL, '1999-01-01', '1999-12-31')
    expect(none).toHaveLength(0)
  })

  it('reads one person at one named outlet, and refuses to reach the other', async () => {
    const attendance = createSupabaseAttendanceAdapter(managerClient)

    const here = await attendance.listPersonRange(
      SPLIT_SHIFT,
      OUTLET_KALYANI,
      WIDE_RANGE.from,
      WIDE_RANGE.to,
    )
    expect(here.length).toBeGreaterThan(0)
    expect(here.every((record) => record.outletId === OUTLET_KALYANI)).toBe(true)

    // The hand-crafted request the surface never makes. The Kalyani manager
    // names the other outlet directly, and the policy returns nothing — the
    // outlet argument is the first line of defence, not the only one (D7).
    const elsewhere = await attendance.listPersonRange(
      SPLIT_SHIFT,
      OUTLET_KANCHRAPARA,
      WIDE_RANGE.from,
      WIDE_RANGE.to,
    )
    expect(elsewhere).toHaveLength(0)
  })

  it('counts the days stranded at each outlet the caller can reach', async () => {
    const attendance = createSupabaseAttendanceAdapter(managerClient)
    const counts = await attendance.countWaitingByOutlet()

    // A Franchise Admin's answer is scoped by policy to their own outlet, with
    // no filter written here to do it.
    expect(counts.every((count) => count.outletId === OUTLET_KALYANI)).toBe(true)
    for (const count of counts) {
      expect(count.waiting).toBeGreaterThan(0)
      expect(count.oldest).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  it('records a check-in, and the database adjudicates the claim', async () => {
    const attendance = createSupabaseAttendanceAdapter(employeeClient)
    const outlets = createSupabaseOutletsAdapter(employeeClient)
    const outlet = await outlets.getOutlet(OUTLET_KALYANI)
    expect(outlet).not.toBeNull()

    const today = resolveBusinessDate(new Date(), outlet!.business_day_cutover)
    const existing = await attendance.getDay(STAFF_KAL, today, KALYANI)

    const record =
      existing ??
      (await attendance.checkIn({
        personId: STAFF_KAL,
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
    // Recorded, and counting for nothing until somebody vouches for it.
    expect(record.approval).toBeNull()
    // The deadline that applied, stamped by the database as the row landed.
    expect(record.arrivalDeadline).toBe(outlet!.arrival_deadline)
  })

  it('records a manual entry as the manager, and the database stamps the enterer', async () => {
    const attendance = createSupabaseAttendanceAdapter(managerClient)
    const today = resolveBusinessDate(new Date(), '04:00')

    // Survives a re-run against the same reset: the manual check-in is read
    // back rather than made twice.
    const existing = await attendance.getDay(PENDING_STAFF_KAL, today, KALYANI)
    const record =
      existing?.checkIn?.source === 'manual'
        ? existing
        : await attendance.recordManualEntry({
            personId: PENDING_STAFF_KAL,
            outletId: OUTLET_KALYANI,
            businessDate: today,
            at: new Date(Date.now() - 60_000).toISOString(),
            enteredBy: FA_KALYANI_SUB,
          })

    expect(record.checkIn?.source).toBe('manual')
    expect(record.checkIn?.enteredBy).toBe(FA_KALYANI_SUB)
    expect(record.checkIn?.enteredByName).toBe('Synthetic Admin Kal')
    // No evidence, no denial: the enterer stamp is the accountability.
    expect(record.checkIn?.latitude).toBeNull()
    expect(record.status).toBe('present')
    // Recording it settled it, under the enterer's own name and with no claimed
    // position — nobody read one.
    expect(record.approval?.by).toBe(FA_KALYANI_SUB)
    expect(record.approval?.distanceMetres).toBeNull()
  })

  it('settles the outlet’s waiting days in one call, with the manager’s reason', async () => {
    const attendance = createSupabaseAttendanceAdapter(managerClient)
    const outlets = createSupabaseOutletsAdapter(managerClient)
    const outlet = await outlets.getOutlet(OUTLET_KALYANI)
    const today = resolveBusinessDate(new Date(), outlet!.business_day_cutover)

    const day = await attendance.listOutletDay(OUTLET_KALYANI, today)
    const waiting = day.filter(
      (record) => record.checkIn !== null && record.approval === null && record.status === 'absent',
    )
    // Survives a re-run against the same reset: with nothing left waiting there
    // is nothing to settle, and the earlier assertions already covered the map.
    if (waiting.length === 0) return

    const settled = await attendance.approve(
      waiting.map((record) => record.id),
      {
        // Away from the outlet, so the rule requires this.
        reason: 'Confirmed by phone with the counter (adapter suite)',
        reading: {
          latitude: 28.6139,
          longitude: 77.209,
          accuracyMetres: 25,
          at: new Date().toISOString(),
        },
        approverId: FA_KALYANI_SUB,
      },
    )

    expect(settled).toHaveLength(waiting.length)
    for (const record of settled) {
      expect(record.status).toBe('present')
      expect(record.approval?.byName).toBe('Synthetic Admin Kal')
      expect(record.approval?.reason).toContain('Confirmed by phone')
      // The approver's distance is the database's number, from the coordinates
      // sent — never a figure the client chose.
      expect(record.approval?.distanceMetres).toBeGreaterThan(1_000_000)
    }
  })

  it('refuses an off-site approval with no reason, in words a counter can read', async () => {
    const attendance = createSupabaseAttendanceAdapter(managerClient)
    const day = await attendance.listOutletDay(OUTLET_KALYANI, yesterday())
    const target = day.find((record) => record.checkIn !== null)!

    // Yesterday is a closed business day, so the rule wants a reason whatever
    // the reading says. The adapter must turn the guard's raise into a sentence.
    const refusal = attendance.approve([target.id], {
      reason: null,
      reading: {
        latitude: 22.97505,
        longitude: 88.4346,
        accuracyMetres: 12,
        at: new Date().toISOString(),
      },
      approverId: FA_KALYANI_SUB,
    })
    await expect(refusal).rejects.toBeInstanceOf(AttendanceActionError)
    await expect(refusal).rejects.toThrow(/needs a reason|already been approved/)
  })

  it('turns a policy refusal into something worth reading at a counter', async () => {
    // An employee attempting to approve their own day: the guard raises, and
    // the adapter must not surface a raw Postgres message.
    const attendance = createSupabaseAttendanceAdapter(employeeClient)
    const day = await attendance.getDay(STAFF_KAL, yesterday(), KALYANI)

    await expect(
      attendance.approve([day!.id], {
        reason: 'self approved',
        reading: null,
        approverId: STAFF_KAL,
      }),
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
