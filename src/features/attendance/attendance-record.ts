import type { AttendanceEvent, AttendanceRecord } from '@/data-access/adapters'

/**
 * What a stored attendance row means, derived in one place.
 *
 * "Awaiting an override" is not a column — `attendance_status` holds payroll
 * outcomes, and a blocked check-in is not one of those (design D1). It is a
 * fact the evidence already tells us, and it must read identically on the
 * manager's day view and on the employee's own history, so both ask here.
 */

export function isOutOfFence(event: AttendanceEvent | null, radiusMetres: number): boolean {
  return event !== null && event.distanceMetres !== null && event.distanceMetres > radiusMetres
}

/**
 * A phone check-in that carried no position at all — permission refused, or no
 * fix. There is nothing to judge, which is exactly the case the fence exists to
 * care about, so the database does not count it present either.
 */
export function isUnverifiable(event: AttendanceEvent | null): boolean {
  return event !== null && event.latitude === null && event.source === 'phone'
}

/**
 * The fence could not vouch for this check-in, and nobody has decided about it
 * yet.
 *
 * Mirrors `attendance_evaluate_geofence()`: a check-in exists, the database
 * stored `absent` rather than the claimed `present`, and no override has
 * landed. Both reasons the fence can fail to vouch — out of range, or no
 * position at all — read the same way here, because they mean the same thing to
 * the person waiting and to the manager deciding.
 */
export function isAwaitingOverride(record: AttendanceRecord, radiusMetres: number): boolean {
  if (!record.checkIn || record.override || record.status !== 'absent') return false
  return isOutOfFence(record.checkIn, radiusMetres) || isUnverifiable(record.checkIn)
}

/**
 * A check-out recorded far from the outlet. Flagged for a manager to look at,
 * never blocked — the work is already done, and the row carries one override
 * slot which belongs to the check-in (design D3).
 */
export function isFlaggedCheckOut(record: AttendanceRecord, radiusMetres: number): boolean {
  return isOutOfFence(record.checkOut, radiusMetres)
}

/** The fence could not be evaluated: no coordinates, or an outlet never surveyed. */
export function isUnevaluated(event: AttendanceEvent | null): boolean {
  return event !== null && event.distanceMetres === null
}

export type DayPhase =
  /** Nothing recorded: the day has not started. */
  | 'not-started'
  /** Checked in, still open. */
  | 'open'
  /** Checked in and out. */
  | 'complete'
  /** A row with no check-in at all — leave, or a manager-marked absence. */
  | 'marked'

export function dayPhase(record: AttendanceRecord | null): DayPhase {
  if (!record) return 'not-started'
  if (!record.checkIn) return 'marked'
  return record.checkOut ? 'complete' : 'open'
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
export function describeDay(record: AttendanceRecord, radiusMetres: number): string {
  if (isAwaitingOverride(record, radiusMetres)) return 'Waiting for a manager to approve'
  // An overridden day says "Present" here and carries its approval in the note
  // beneath it — every surface renders both, and two lines each opening
  // "Approved by" reads like a stutter rather than like two facts.
  return STATUS_LABELS[record.status]
}
