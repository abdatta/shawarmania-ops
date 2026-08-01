import type { AttendanceEvent, AttendanceRecord } from '@/data-access/adapters'
import { instantOnBusinessDay } from '@/domain'

/**
 * What a stored attendance row means, derived in one place.
 *
 * Three of the states a day can be in are not columns. "Waiting for a manager",
 * "late" and "absent because nobody came" are all facts the stored evidence and
 * the outlet's clock already answer, and `attendance_status` holds payroll
 * outcomes rather than process states (design D1). They must read identically
 * on the manager's day view, on the person view and on the employee's own
 * history, so all three ask here.
 *
 * **A day belongs to the person, not to the shop**
 * (attendance-one-day-per-person, design D2). Since that change a person holds
 * at most one attendance row per business date across every outlet, and this
 * module is the only place that knows it. No view derives absence, collapses
 * rows, or reasons about outlets on its own.
 *
 * That is deliberate, because the owner accepted the rule on the condition that
 * restoring split shifts later stays cheap. **What reversing it costs:** two
 * migration statements (swap `attendance_one_per_person_day` back to
 * `attendance_one_per_person_outlet_day`, the mirror of what
 * 20260801000001 did) plus this module — `readDay` goes back to judging one
 * outlet at a time, `elsewhere` and `tallyDays`' per-date collapse come out, and
 * the `attendance_elsewhere` function loses its only caller. Rows written under
 * one-per-person-per-day already satisfy one-per-person-per-outlet-per-day, so
 * nothing needs repairing. The cost is here on purpose: it is one file, and a
 * grep for `DayReading` finds every screen that would need re-rendering.
 */

export function isOutOfFence(event: AttendanceEvent | null, radiusMetres: number): boolean {
  return event !== null && event.distanceMetres !== null && event.distanceMetres > radiusMetres
}

/**
 * A phone check-in that carried no position at all — permission refused, or no
 * fix. There is nothing for a manager to weigh but the person's word, which is
 * worth saying out loud on the surfaces.
 */
export function isUnverifiable(event: AttendanceEvent | null): boolean {
  return event !== null && event.latitude === null && event.source === 'phone'
}

/** The fence could not be evaluated: no coordinates, or an outlet never surveyed. */
export function isUnevaluated(event: AttendanceEvent | null): boolean {
  return event !== null && event.distanceMetres === null
}

/**
 * A check-in nobody has vouched for yet.
 *
 * Mirrors the database: an unapproved check-in is stored `absent` whatever its
 * distance, and an approval is what turns it into `present`. Reading the stored
 * status rather than re-judging the fence is what keeps this honest about
 * history too — a day recorded before approval was required carries a check-in,
 * no approval, and status `present`, and it reads as what it is rather than as
 * something that has been waiting for weeks (design D10).
 *
 * A day a manager deliberately marked `absent` while a check-in exists is
 * indistinguishable from a waiting one, which it also was under the old
 * override rule. The way to record "arrived but not counted" is `half_day`.
 */
export function isWaitingForApproval(record: AttendanceRecord): boolean {
  return record.checkIn !== null && record.approval === null && record.status === 'absent'
}

/**
 * Was the approver standing at the outlet when they vouched for this day?
 *
 * Derived rather than stored, so it cannot disagree with the coordinates it is
 * derived from. An unsurveyed outlet has no position to judge anyone against, so
 * every approval there reads as unverified rather than as on-site — which is
 * honest, and matches how check-ins already behave there.
 */
export function wasApprovedOnSite(record: AttendanceRecord, radiusMetres: number): boolean {
  const { approval } = record
  return (
    approval !== null && approval.distanceMetres !== null && approval.distanceMetres <= radiusMetres
  )
}

/**
 * Did this arrival land after the deadline that applied to it?
 *
 * Judged against the deadline stamped on the row, never the outlet's current
 * one, so editing an outlet's rule cannot retroactively relabel a recorded day.
 * A row with no stamped deadline predates the rule and is never called late.
 *
 * @param cutover the row's outlet's `business_day_cutover`, which decides which
 *   calendar day the deadline falls on
 */
export function isLate(record: AttendanceRecord, cutover: string): boolean {
  if (!record.checkIn || record.arrivalDeadline === null) return false
  const deadline = instantOnBusinessDay(record.businessDate, record.arrivalDeadline, cutover)
  return record.checkIn.at > deadline
}

/**
 * How a day reads, whether or not a row exists for it.
 *
 * The absent-by-deadline rule lives here and nowhere else. Nothing writes those
 * rows — no scheduled job manufactures a row per assigned person per day, races
 * the late check-in it is trying to describe, or needs a backfill for every past
 * day (design D6). A stored row always wins, so a day marked `leave` stays
 * leave.
 */
export type DayReading =
  /** Nothing recorded, and no deadline that could still see them has passed. */
  | { kind: 'not-yet-arrived' }
  /** Nothing recorded anywhere, and every deadline has passed. No row exists. */
  | { kind: 'absent' }
  /**
   * Nothing recorded at the outlets in scope, and the database says they hold a
   * row somewhere the reader cannot see. Carries no outlet, time or evidence,
   * because the answer behind it carries none (design D3).
   */
  | { kind: 'elsewhere' }
  /** Recorded, and waiting for a manager to settle it. */
  | { kind: 'waiting'; record: AttendanceRecord }
  /** Recorded and settled. The row's own status is the answer. */
  | { kind: 'recorded'; record: AttendanceRecord }

/** Everything about an outlet that bears on how a day reads. */
export interface OutletClock {
  arrival_deadline: string
  business_day_cutover: string
}

/**
 * The last moment any of these outlets could still see this person arrive.
 *
 * With one outlet this is just its deadline. With several it is the latest of
 * them, which is the only honest answer: somebody staffed at a shop that closes
 * its arrivals at 20:00 has not failed to turn up at 13:30 merely because the
 * other shop they sometimes work at had given up by then. Nothing global is
 * assumed about the clocks (design D7) even though production's two outlets
 * currently agree.
 */
function lastDeadline(clocks: readonly OutletClock[], businessDate: string): string | null {
  let latest: string | null = null
  for (const clock of clocks) {
    const at = instantOnBusinessDay(
      businessDate,
      clock.arrival_deadline,
      clock.business_day_cutover,
    )
    if (latest === null || at > latest) latest = at
  }
  return latest
}

/** What the caller knows beyond the row itself. */
export interface DayContext {
  now?: Date
  /**
   * Does the database say this person holds a row at an outlet outside the
   * reader's scope on this date (design D3)? Only ever true when `record` is
   * null, because one person holds one row a day.
   */
  accountedForElsewhere?: boolean
}

/**
 * @param clocks every outlet whose deadline could still see this person arrive
 *   on this date — for a roll-call, the outlets in scope they are staff at. A
 *   day is not about one shop, so this is plural even where the caller has one.
 */
export function readDay(
  record: AttendanceRecord | null,
  clocks: readonly OutletClock[],
  businessDate: string,
  { now = new Date(), accountedForElsewhere = false }: DayContext = {},
): DayReading {
  if (record) {
    return isWaitingForApproval(record) ? { kind: 'waiting', record } : { kind: 'recorded', record }
  }
  // Ahead of the deadline, because it beats "not yet arrived" as well as
  // "absent": they have arrived, just not here. Saying otherwise would be a
  // false statement about a day somebody is paid for.
  if (accountedForElsewhere) return { kind: 'elsewhere' }
  // No row means no stamped deadline, so the outlets' current ones are used.
  // Acceptable and stated in the spec: whether somebody turned up does not turn
  // on the exact minute the rule was set to.
  const deadline = lastDeadline(clocks, businessDate)
  if (deadline === null) return { kind: 'not-yet-arrived' }
  return now.toISOString() > deadline ? { kind: 'absent' } : { kind: 'not-yet-arrived' }
}

export const STATUS_LABELS = {
  present: 'Present',
  absent: 'Absent',
  half_day: 'Half day',
  leave: 'Leave',
} as const satisfies Record<AttendanceRecord['status'], string>

/**
 * One sentence for how a day stands, from the evidence rather than the bare
 * status — so "Absent" never appears next to a check-in time with no
 * explanation of why the two disagree.
 */
export function describeDay(record: AttendanceRecord): string {
  if (isWaitingForApproval(record)) return 'Waiting for a manager to approve'
  // An approved day says "Present" here and carries its approval in the note
  // beneath it — every surface renders both, and two lines each opening
  // "Approved by" reads like a stutter rather than like two facts.
  return STATUS_LABELS[record.status]
}

/** How a derived, row-less day reads. Worded to match `describeDay`'s register. */
export function describeReading(reading: DayReading): string {
  switch (reading.kind) {
    case 'not-yet-arrived':
      return 'Not yet arrived'
    case 'absent':
      return 'Absent'
    // No outlet is named, and none can be: the fact crossing the boundary is
    // one bit wide (design D3).
    case 'elsewhere':
      return 'Working at another outlet'
    default:
      return describeDay(reading.record)
  }
}

/** Present, late, absent and waiting across a range — the person view's summary. */
export interface AttendanceTally {
  present: number
  late: number
  absent: number
  waiting: number
}

/**
 * Counted once per business date, whatever outlet each day was worked at.
 *
 * The summary exists so somebody can compute pay by hand, and a day worked is
 * one day however many shops the month touched. The rows are already one per
 * date since the collapse, so the guard below is belt and braces rather than
 * the mechanism — but it is the difference between a summary that is a day
 * count and one that is a row count, and only one of those is payable.
 *
 * A day read as `elsewhere` counts as nothing here, deliberately. It is not a
 * present day (this reader cannot see that it was approved) and it is certainly
 * not an absent one. In practice it never reaches a tally at all: the by-staff
 * read already spans every outlet the reader may see, so there is no elsewhere
 * left to point at.
 */
export function tallyDays(
  readings: readonly { businessDate: string; reading: DayReading; late: boolean }[],
): AttendanceTally {
  const tally: AttendanceTally = { present: 0, late: 0, absent: 0, waiting: 0 }
  const counted = new Set<string>()
  for (const { businessDate, reading, late } of readings) {
    if (counted.has(businessDate)) continue
    counted.add(businessDate)
    if (late) tally.late += 1
    if (reading.kind === 'absent') {
      tally.absent += 1
    } else if (reading.kind === 'waiting') {
      tally.waiting += 1
    } else if (reading.kind === 'recorded') {
      if (reading.record.status === 'present') tally.present += 1
      else if (reading.record.status === 'absent') tally.absent += 1
    }
  }
  return tally
}
