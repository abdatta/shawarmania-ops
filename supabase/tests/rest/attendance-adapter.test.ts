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
import type { AttendanceRecord } from '../../../src/data-access/adapters'
import type { Database } from '../../../src/data-access/database.types'
import { createSupabaseAttendanceAdapter } from '../../../src/data-access/supabase-adapters/attendance'
import { createSupabaseOutletsAdapter } from '../../../src/data-access/supabase-adapters/outlets'
import {
  instantOnBusinessDay,
  resolveBusinessDate,
  shiftBusinessDate,
} from '../../../src/domain/datetime'

const SUPABASE_URL = process.env['SUPABASE_URL'] ?? 'http://127.0.0.1:54321'
const SUPABASE_ANON_KEY =
  process.env['SUPABASE_ANON_KEY'] ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

/**
 * The selected set, in the shape one command takes. Identities are generated
 * here, once, exactly as the surface generates them once per action — so a
 * retry replays the same command rather than minting a second one.
 */
function items(records: readonly AttendanceRecord[]) {
  return records.map((record) => ({
    attendanceId: record.id,
    expectedAttemptId: record.currentAttemptId as string,
    expectedVersion: record.stateVersion,
    decisionId: crypto.randomUUID(),
  }))
}

const PASSWORD = 'shawarmania-local'
const OUTLET_KALYANI = '00000000-0000-4000-a000-000000000001'
const OUTLET_KANCHRAPARA = '00000000-0000-4000-a000-000000000002'
// Staff are accounts: attendance keys on the person's own profile id.
const STAFF_KAL = '10000000-0000-4000-a000-000000000006'
const STAFF_KPA = '10000000-0000-4000-a000-000000000007'
/** Works at both outlets, which is what makes the person-range read testable. */
const TWO_OUTLETS = '10000000-0000-4000-a000-00000000000e'
/** Kalyani's radius, from the seed. Named so an assertion reads as a claim. */
const outletRadius = 150
// Pending Staff Kal: nothing else in any suite writes attendance for them,
// which is what makes the manual-entry test's re-run check sufficient.
const PENDING_STAFF_KAL = '10000000-0000-4000-a000-00000000000c'
const FA_KALYANI_SUB = '10000000-0000-4000-a000-000000000002'
/**
 * One live Employee assignment at Kalyani, and no row for today in any suite —
 * which is what makes them the persona for the position-free check-in. The
 * two-outlet person's today is already written by the command-races suite, and
 * one person holds one row a day.
 */
const GRILLER_KAL = '20000000-0000-4000-a000-000000000002'

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

/** The day the two-outlet person worked at Kanchrapara, per the seed. */
function dayBeforeYesterday(): string {
  const date = new Date()
  date.setDate(date.getDate() - 2)
  return date.toISOString().slice(0, 10)
}

/** A range wide enough to cover everything the seed wrote. */
const WIDE_RANGE = { from: '2000-01-01', to: '2100-01-01' } as const

function instantValue(value: string): number {
  return new Date(value).getTime()
}

let employeeClient: Client
let managerClient: Client
/** The one session that reads both outlets, for the cross-outlet assertions. */
let ownerClient: Client
/** The employee whose day is claimed with no position at all. */
let grillerClient: Client

beforeAll(async () => {
  employeeClient = await signIn('staff.kalyani@login.shawarmania.invalid')
  managerClient = await signIn('admin.kalyani@login.shawarmania.invalid')
  ownerClient = await signIn('owner@login.shawarmania.invalid')
  grillerClient = await signIn('griller.kalyani@login.shawarmania.invalid')
}, 30_000)

describe('the attendance adapter', () => {
  it('reads a day with the person’s name joined in', async () => {
    const attendance = createSupabaseAttendanceAdapter(managerClient)
    const day = await attendance.listOutletDay([OUTLET_KALYANI], yesterday())

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
    const day = await attendance.getDay(STAFF_KAL, yesterday())

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
    const day = await attendance.listOutletDay([OUTLET_KANCHRAPARA], yesterday())
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

  it('reads one person across every outlet the reader may see, and no further', async () => {
    // The read names no outlet at all since attendance-one-day-per-person
    // (design D4): what comes back is the policy's answer, so this asserts the
    // policy rather than a filter the client wrote.
    const asManager = createSupabaseAttendanceAdapter(managerClient)
    const here = await asManager.listPersonRange(TWO_OUTLETS, WIDE_RANGE.from, WIDE_RANGE.to)

    expect(here.length).toBeGreaterThan(0)
    // The Kalyani manager holds one assignment, so one outlet is what they get —
    // and the day this person worked at Kanchrapara is not in it, though they
    // asked for no outlet and could not have excluded it if they wanted to.
    expect(here.every((record) => record.outletId === OUTLET_KALYANI)).toBe(true)

    // The owner asks exactly the same question and gets both, which is the
    // by-staff axis working: one person's month, wherever it was worked.
    const asOwner = createSupabaseAttendanceAdapter(ownerClient)
    const everywhere = await asOwner.listPersonRange(TWO_OUTLETS, WIDE_RANGE.from, WIDE_RANGE.to)
    expect(new Set(everywhere.map((record) => record.outletId))).toEqual(
      new Set([OUTLET_KALYANI, OUTLET_KANCHRAPARA]),
    )

    // And one row per business date, whatever outlet each was worked at. This is
    // the whole point: the summary above it is a day count, and a day counted
    // twice is a day paid twice.
    const dates = everywhere.map((record) => record.businessDate)
    expect(new Set(dates).size).toBe(dates.length)
  })

  it('tells a manager that somebody is accounted for elsewhere, and nothing more', async () => {
    const attendance = createSupabaseAttendanceAdapter(managerClient)

    // The two-outlet person worked at Kanchrapara the day before yesterday, and
    // the Kalyani manager cannot see that row — so without this they would read
    // as absent on a day they were paid for (design D3).
    const away = await attendance.listElsewhere([OUTLET_KALYANI], dayBeforeYesterday())
    expect(away).toContain(TWO_OUTLETS)

    // Person ids and nothing else. There is no shape of this answer that could
    // carry an outlet, a time or an approval, which is the bound.
    expect(away.every((id) => typeof id === 'string')).toBe(true)

    // Naming an outlet they do not manage borrows nothing from it.
    const borrowed = await attendance.listElsewhere([OUTLET_KANCHRAPARA], dayBeforeYesterday())
    expect(borrowed).toHaveLength(0)

    // And with both outlets in scope the real row is on screen, so there is no
    // elsewhere left to report.
    const asOwner = createSupabaseAttendanceAdapter(ownerClient)
    const covered = await asOwner.listElsewhere(
      [OUTLET_KALYANI, OUTLET_KANCHRAPARA],
      dayBeforeYesterday(),
    )
    expect(covered).not.toContain(TWO_OUTLETS)
  })

  it('counts the days stranded at each outlet the caller can reach', async () => {
    const attendance = createSupabaseAttendanceAdapter(managerClient)
    const counts = await attendance.countWaitingByOutlet()

    // A Franchise Admin's answer is scoped by policy to their own outlet, with
    // no filter written here to do it. This is the tenancy every badge in the
    // app rests on: a count must never reveal work somewhere the reader could
    // not open (notification-badges, design D-RLS).
    expect(counts.every((count) => count.outletId === OUTLET_KALYANI)).toBe(true)
    for (const count of counts) {
      expect(count.waiting).toBeGreaterThan(0)
      expect(count.oldest).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      // `newest` rides along on the same already-sorted query, and is what tells
      // the day view there is unsettled work after the day on screen.
      expect(count.newest).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(count.newest >= count.oldest).toBe(true)
      // An outlet whose only unsettled day is a single date is its own oldest
      // and newest — the degenerate case the two marks have to get right.
      if (count.waiting === 1) expect(count.newest).toBe(count.oldest)
    }
  })

  it('accepts the deployed eight-argument RPC payload but stamps server time and date', async () => {
    const attemptId = 'f1000000-0000-4000-a000-000000000090'
    const before = Date.now()
    const { data, error } = await employeeClient.rpc('attendance_submit_attempt', {
      p_attempt_id: attemptId,
      p_outlet_id: OUTLET_KALYANI,
      // Both are deliberately wrong legacy clock facts. PostgREST must still
      // find the unchanged signature, while the database must not trust them.
      p_business_date: '2099-01-01',
      p_attempted_at: '2099-01-01T00:00:00.000Z',
      p_lat: 22.984,
      p_lng: 88.4345,
      p_accuracy_m: 20,
    })
    const after = Date.now()

    expect(error).toBeNull()
    expect(data).not.toBeNull()
    const { data: attempt, error: readError } = await employeeClient
      .from('attendance_attempts')
      .select('attempted_at, business_date')
      .eq('id', attemptId)
      .single()
    expect(readError).toBeNull()
    expect(attempt?.business_date).not.toBe('2099-01-01')
    expect(attempt?.attempted_at).not.toBe('2099-01-01T00:00:00+00:00')
    // The local database container can be a few seconds behind the Node host;
    // this is a transport compatibility test, while pgTAP pins the database
    // statement clock exactly. Keep the transport assertion broad enough not
    // to confuse container drift with the 2099 device clock it rejects.
    expect(new Date(attempt!.attempted_at).getTime()).toBeGreaterThanOrEqual(before - 60_000)
    expect(new Date(attempt!.attempted_at).getTime()).toBeLessThanOrEqual(after + 60_000)
    expect(new Date(data!.check_in_at!).getTime()).toBe(new Date(attempt!.attempted_at).getTime())
  })

  it('records a check-in, and the database adjudicates the claim', async () => {
    const attendance = createSupabaseAttendanceAdapter(employeeClient)
    const outlets = createSupabaseOutletsAdapter(employeeClient)
    const outlet = await outlets.getOutlet(OUTLET_KALYANI)
    expect(outlet).not.toBeNull()

    const today = resolveBusinessDate(new Date(), outlet!.business_day_cutover)
    const existing = await attendance.getDay(STAFF_KAL, today)

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
    // A re-run may find the same day already settled by the approval test
    // below. A newly written claim must be absent; a found row may now be the
    // append-only present outcome from that later decision.
    if (existing === null) expect(record.status).toBe('absent')
    else expect(['absent', 'present']).toContain(record.status)
    // A new claim counts for nothing until somebody vouches for it. On a
    // deliberate re-run the later approval test may already have settled it.
    if (existing === null) expect(record.approval).toBeNull()
    else if (record.status === 'present') expect(record.approval).not.toBeNull()
    // The deadline that applied, stamped by the database as the row landed.
    expect(record.arrivalDeadline).toBe(outlet!.arrival_deadline)
  })

  it('records a historical manual entry as the manager, and the database stamps the enterer', async () => {
    const attendance = createSupabaseAttendanceAdapter(managerClient)
    const today = resolveBusinessDate(new Date(), '04:00')
    const businessDate = shiftBusinessDate(today, -3)
    const at = instantOnBusinessDay(businessDate, '09:00', '04:00')

    // Survives a re-run against the same reset: the manual check-in is read
    // back rather than made twice.
    const existing = await attendance.getDay(PENDING_STAFF_KAL, businessDate)
    const record =
      existing?.checkIn?.source === 'manual'
        ? existing
        : await attendance.recordManualEntry({
            personId: PENDING_STAFF_KAL,
            outletId: OUTLET_KALYANI,
            businessDate,
            at,
            enteredBy: FA_KALYANI_SUB,
          })

    expect(record.businessDate).toBe(businessDate)
    expect(instantValue(record.checkIn!.at)).toBe(instantValue(at))
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

  it('records a manual entry on the current business day through the same call', async () => {
    // The historical case above rewrote what used to be this test rather than
    // joining it. One RPC now serves both dates, so the date that was always
    // allowed has to keep its own proof over PostgREST — otherwise a future
    // narrowing of the command would only be caught on the branch that was
    // added last.
    const attendance = createSupabaseAttendanceAdapter(managerClient)
    const businessDate = resolveBusinessDate(new Date(), '04:00')
    // The first moment of the named day: never in the future, and never on the
    // day before, which the command refuses as an instant outside its date.
    const at = instantOnBusinessDay(businessDate, '04:00', '04:00')

    // Survives a re-run against the same reset, as the historical case does.
    const existing = await attendance.getDay(PENDING_STAFF_KAL, businessDate)
    const record =
      existing?.checkIn?.source === 'manual'
        ? existing
        : await attendance.recordManualEntry({
            personId: PENDING_STAFF_KAL,
            outletId: OUTLET_KALYANI,
            businessDate,
            at,
            enteredBy: FA_KALYANI_SUB,
          })

    expect(record.businessDate).toBe(businessDate)
    expect(record.checkIn?.source).toBe('manual')
    expect(record.checkIn?.enteredBy).toBe(FA_KALYANI_SUB)
    expect(record.checkIn?.latitude).toBeNull()
    expect(record.status).toBe('present')
    expect(record.approval?.by).toBe(FA_KALYANI_SUB)
  })

  it('settles the outlet’s waiting days in one call, with the manager’s reason', async () => {
    const attendance = createSupabaseAttendanceAdapter(managerClient)
    const outlets = createSupabaseOutletsAdapter(managerClient)
    const outlet = await outlets.getOutlet(OUTLET_KALYANI)
    const today = resolveBusinessDate(new Date(), outlet!.business_day_cutover)

    const day = await attendance.listOutletDay([OUTLET_KALYANI], today)
    const waiting = day.filter(
      (record) =>
        record.checkIn !== null &&
        record.currentAttemptId !== null &&
        record.approval === null &&
        record.status === 'absent',
    )
    // Survives a re-run against the same reset: with nothing left waiting there
    // is nothing to settle, and the earlier assertions already covered the map.
    if (waiting.length === 0) return

    const settled = await attendance.approve(items(waiting), {
      commandId: crypto.randomUUID(),
      // Away from the outlet, so the rule requires this.
      reason: 'Confirmed by phone with the counter (adapter suite)',
      reading: {
        latitude: 28.6139,
        longitude: 77.209,
        accuracyMetres: 25,
        at: new Date().toISOString(),
      },
      approverId: FA_KALYANI_SUB,
    })

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
    const day = await attendance.listOutletDay([OUTLET_KALYANI], yesterday())
    const target = day.find((record) => record.checkIn !== null)!

    // Yesterday is a closed business day, so the rule wants a reason whatever
    // the reading says. The adapter must turn the guard's raise into a sentence.
    const refusal = attendance.approve(items([target]), {
      commandId: crypto.randomUUID(),
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

  it('refuses to send an approval for a day with nothing waiting on it', async () => {
    // Yesterday's row is settled, so there is no current attempt to decide. The
    // adapter answers that itself rather than asking the database to.
    //
    // Asserted by code, not merely "it rejected". While this asserted nothing
    // but rejection it could not tell a refusal apart from a request the app
    // was incapable of sending — which is exactly how a bug that broke every
    // position-free command sat here unnoticed. Who may approve is proved
    // below, against a row that is genuinely waiting.
    const attendance = createSupabaseAttendanceAdapter(employeeClient)
    const day = await attendance.getDay(STAFF_KAL, yesterday())

    const refusal = attendance.approve(items([day!]), {
      commandId: crypto.randomUUID(),
      reason: 'self approved',
      reading: null,
      approverId: STAFF_KAL,
    })
    await expect(refusal).rejects.toBeInstanceOf(AttendanceActionError)
    await expect(refusal).rejects.toMatchObject({ code: 'nothing_to_approve' })
  })

  it('records a check-in with no position at all, and settles it with no position either', async () => {
    // The production bug this file could have caught: with no reading, the
    // adapter used to drop `p_lat`, `p_lng` and `p_accuracy_m` from the payload
    // entirely, and PostgREST could not resolve a command function that declares
    // no default for them. Every unlocated check-in failed while writing nothing.
    //
    // The persona is the Kalyani griller: one live Employee assignment there, and
    // no row for today from any other suite. How many outlets the person had is
    // not something the transport can see — the payload is identical — so the
    // which-outlet question stays covered in the component suite, and this proves
    // the part only a real database can.
    const asEmployee = createSupabaseAttendanceAdapter(grillerClient)
    const asManager = createSupabaseAttendanceAdapter(managerClient)
    const outlets = createSupabaseOutletsAdapter(grillerClient)
    const outlet = await outlets.getOutlet(OUTLET_KALYANI)
    const today = resolveBusinessDate(new Date(), outlet!.business_day_cutover)

    // Survives a re-run against the same reset: the unlocated day is read back
    // rather than claimed twice.
    const existing = await asEmployee.getDay(GRILLER_KAL, today)
    const recorded =
      existing ??
      (await asEmployee.checkIn({
        personId: GRILLER_KAL,
        outletId: OUTLET_KALYANI,
        businessDate: today,
        reading: null,
      }))

    expect(recorded.outletId).toBe(OUTLET_KALYANI)
    expect(recorded.checkIn).not.toBeNull()
    // Unknown, and stored as unknown: there is no reading to vouch for anybody,
    // and nothing invented one.
    expect(recorded.checkIn?.latitude).toBeNull()
    expect(recorded.checkIn?.longitude).toBeNull()
    expect(recorded.checkIn?.accuracyMetres).toBeNull()
    expect(recorded.checkIn?.distanceMetres).toBeNull()
    expect(recorded.checkIn?.source).toBe('phone')
    // A claim, not a day: it counts for nothing until a manager settles it.
    if (existing === null) {
      expect(recorded.status).toBe('absent')
      expect(recorded.approval).toBeNull()
      expect(recorded.currentAttemptId).not.toBeNull()
    }

    if (recorded.currentAttemptId === null) return

    // The row is genuinely waiting, so a position-free approval now reaches the
    // policy rather than stopping at the adapter's own guard — which is what
    // makes this the place to prove an Employee cannot settle their own day. It
    // is also the proof that the payload arrives: a request the backend could
    // not resolve would read as `unsendable`, not as a refusal.
    await expect(
      asEmployee.approve(items([recorded]), {
        commandId: crypto.randomUUID(),
        reason: 'Approving my own day',
        reading: null,
        approverId: GRILLER_KAL,
      }),
    ).rejects.toMatchObject({ code: 'not_permitted' })

    // And the manager settles it from a phone that cannot find a position
    // either — the other half of the same bug. With no reading the rule treats
    // this exactly as an off-site approval, so it costs a reason.
    const [settled] = await asManager.approve(items([recorded]), {
      commandId: crypto.randomUUID(),
      reason: 'Griller was on the grill; neither phone could find a position',
      reading: null,
      approverId: FA_KALYANI_SUB,
    })

    expect(settled?.status).toBe('present')
    expect(settled?.approval?.byName).toBe('Synthetic Admin Kal')
    expect(settled?.approval?.reason).toContain('neither phone could find a position')
    // The approver's position is unknown, and the distance with it. An approval
    // that recorded a distance here would be claiming a place nobody read.
    expect(settled?.approval?.latitude).toBeNull()
    expect(settled?.approval?.longitude).toBeNull()
    expect(settled?.approval?.accuracyMetres).toBeNull()
    expect(settled?.approval?.distanceMetres).toBeNull()
  })

  it('audits historical time corrections without rewriting arrival evidence or tenancy', async () => {
    const asManager = createSupabaseAttendanceAdapter(managerClient)
    const asOwner = createSupabaseAttendanceAdapter(ownerClient)
    const asEmployee = createSupabaseAttendanceAdapter(employeeClient)
    const before = await asManager.getDay(STAFF_KAL, yesterday())
    expect(before?.outcomeAttemptId).not.toBeNull()
    expect(before?.checkIn).not.toBeNull()
    const originalAttempt = before!.attempts.find(
      (attempt) => attempt.id === before!.outcomeAttemptId,
    )!
    const originalApproval = before!.approval
    const originalRetry = before!.retry
    /*
      Corrections are append-only, so a deliberate re-run against the same reset
      finds the ones the previous run made. What this test owns is the two it is
      about to add; counting the total would pass only on the first run, which is
      not the promise this file makes at the top.
    */
    const correctionsBefore = before!.decisions.filter(
      (decision) => decision.kind === 'correct_time',
    ).length
    const correctedAt = instantOnBusinessDay(yesterday(), '12:30', '04:00')
    const firstDecisionId = crypto.randomUUID()

    const first = await asManager.correct({
      attendanceId: before!.id,
      expectedVersion: before!.stateVersion,
      action: 'time',
      reason: 'Paper register confirms 12:30',
      reading: null,
      correctedAt,
      decisionId: firstDecisionId,
    })

    expect(instantValue(first.checkIn!.at)).toBe(instantValue(correctedAt))
    expect(first.attempts.find((attempt) => attempt.id === originalAttempt.id)?.at).toBe(
      originalAttempt.at,
    )
    expect(first.approval).toEqual(originalApproval)
    expect(first.retry).toEqual(originalRetry)
    expect(first.decisions.at(-1)).toMatchObject({
      id: firstDecisionId,
      kind: 'correct_time',
      byName: 'Synthetic Admin Kal',
      reason: 'Paper register confirms 12:30',
    })
    expect(instantValue(first.decisions.at(-1)!.previousCheckInAt!)).toBe(
      instantValue(before!.checkIn!.at),
    )
    expect(instantValue(first.decisions.at(-1)!.newCheckInAt!)).toBe(instantValue(correctedAt))

    // Exact command replay is a read; a changed command id payload and stale
    // version are both refused without appending partial history.
    const replay = await asManager.correct({
      attendanceId: before!.id,
      expectedVersion: before!.stateVersion,
      action: 'time',
      reason: 'Paper register confirms 12:30',
      reading: null,
      correctedAt,
      decisionId: firstDecisionId,
    })
    expect(replay.stateVersion).toBe(first.stateVersion)
    await expect(
      asManager.correct({
        attendanceId: before!.id,
        expectedVersion: before!.stateVersion,
        action: 'time',
        reason: 'Different payload under the same id',
        reading: null,
        correctedAt,
        decisionId: firstDecisionId,
      }),
    ).rejects.toMatchObject({ code: 'changed_request' })
    await expect(
      asManager.correct({
        attendanceId: before!.id,
        expectedVersion: before!.stateVersion,
        action: 'time',
        reason: 'Stale correction probe',
        reading: null,
        correctedAt: instantOnBusinessDay(yesterday(), '12:45', '04:00'),
      }),
    ).rejects.toMatchObject({ code: 'stale_state' })

    const correctedLateAt = instantOnBusinessDay(yesterday(), '14:30', '04:00')
    const second = await asOwner.correct({
      attendanceId: first.id,
      expectedVersion: first.stateVersion,
      action: 'time',
      reason: 'Owner confirmed the final arrival time',
      reading: null,
      correctedAt: correctedLateAt,
    })
    expect(instantValue(second.checkIn!.at)).toBe(instantValue(correctedLateAt))
    expect(second.decisions.slice(-2).map((decision) => decision.kind)).toEqual([
      'correct_time',
      'correct_time',
    ])
    expect(second.decisions.at(-1)?.byName).toBe('Synthetic Owner')
    expect(instantValue(second.decisions.at(-1)!.previousCheckInAt!)).toBe(
      instantValue(correctedAt),
    )
    expect(instantValue(second.decisions.at(-1)!.newCheckInAt!)).toBe(instantValue(correctedLateAt))

    // The affected employee reads the same immutable attempt and correction
    // trail as management, but cannot create another correction themselves.
    const employeeView = await asEmployee.getDay(STAFF_KAL, yesterday())
    expect(instantValue(employeeView!.checkIn!.at)).toBe(instantValue(correctedLateAt))
    expect(employeeView?.attempts.find((attempt) => attempt.id === originalAttempt.id)?.at).toBe(
      originalAttempt.at,
    )
    expect(
      employeeView?.decisions.filter((decision) => decision.kind === 'correct_time'),
    ).toHaveLength(correctionsBefore + 2)
    await expect(
      asEmployee.correct({
        attendanceId: second.id,
        expectedVersion: second.stateVersion,
        action: 'time',
        reason: 'Employee must not self-correct',
        reading: null,
        correctedAt,
      }),
    ).rejects.toMatchObject({ code: 'not_permitted' })

    await expect(
      asManager.correct({
        attendanceId: second.id,
        expectedVersion: second.stateVersion,
        action: 'time',
        reason: 'Future-time probe',
        reading: null,
        correctedAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    ).rejects.toMatchObject({ code: 'time_future' })
    await expect(
      asManager.correct({
        attendanceId: second.id,
        expectedVersion: second.stateVersion,
        action: 'time',
        reason: 'Wrong-business-day probe',
        reading: null,
        correctedAt: instantOnBusinessDay(shiftBusinessDate(yesterday(), -1), '12:30', '04:00'),
      }),
    ).rejects.toMatchObject({ code: 'time_wrong_day' })

    const otherOutlet = (await asOwner.listOutletDay([OUTLET_KANCHRAPARA], yesterday())).find(
      (record) => record.checkIn && record.outcomeAttemptId && !record.currentAttemptId,
    )!
    const crossOutlet = await managerClient.rpc('attendance_correct', {
      p_attendance_id: otherOutlet.id,
      p_decision_id: crypto.randomUUID(),
      p_expected_version: otherOutlet.stateVersion,
      p_action: 'time',
      p_reason: 'Cross-outlet probe',
      p_corrected_at: instantOnBusinessDay(yesterday(), '15:00', '04:00'),
    })
    expect(crossOutlet.error?.code).toBe('42501')
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
