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
  /** Nothing recorded, and the outlet's deadline for this day has not passed. */
  | { kind: 'not-yet-arrived' }
  /** Nothing recorded, and it has. Derived at read time; no row exists. */
  | { kind: 'absent' }
  /** Recorded, and waiting for a manager to settle it. */
  | { kind: 'waiting'; record: AttendanceRecord }
  /** Recorded and settled. The row's own status is the answer. */
  | { kind: 'recorded'; record: AttendanceRecord }

export function readDay(
  record: AttendanceRecord | null,
  outlet: { arrival_deadline: string; business_day_cutover: string },
  businessDate: string,
  now: Date = new Date(),
): DayReading {
  if (record) {
    return isWaitingForApproval(record) ? { kind: 'waiting', record } : { kind: 'recorded', record }
  }
  // No row means no stamped deadline, so the outlet's current one is used.
  // Acceptable and stated in the spec: whether somebody turned up does not turn
  // on the exact minute the rule was set to.
  const deadline = instantOnBusinessDay(
    businessDate,
    outlet.arrival_deadline,
    outlet.business_day_cutover,
  )
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

export function tallyDays(
  readings: readonly { reading: DayReading; late: boolean }[],
): AttendanceTally {
  const tally: AttendanceTally = { present: 0, late: 0, absent: 0, waiting: 0 }
  for (const { reading, late } of readings) {
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
