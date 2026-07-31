import {
  CheckCircle2,
  CircleSlash,
  Clock,
  MapPin,
  MapPinOff,
  PencilLine,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react'

import type { AttendanceEvent, AttendanceRecord } from '@/data-access/adapters'
import { formatMetres, formatTime } from '@/domain'

import {
  describeDay,
  isOutOfFence,
  isWaitingForApproval,
  wasApprovedOnSite,
  type DayReading,
} from './attendance-record'

/**
 * The evidence, rendered once and used by every side.
 *
 * The employee's own history, the manager's day view and the person view import
 * the *same* components deliberately. Asymmetric visibility in a monitoring
 * feature is how it becomes something staff resent, and the cheapest way to keep
 * three views honest is to give them one implementation.
 */

/** Where a reading was taken, how good it was, and what recorded it. */
export function EventEvidence({
  label,
  event,
  radiusMetres,
}: {
  label: string
  event: AttendanceEvent | null
  radiusMetres: number
}) {
  if (!event) {
    return (
      <div className="text-sm">
        <span className="font-semibold text-content">{label}</span>{' '}
        <span className="text-content-muted">— not recorded</span>
      </div>
    )
  }

  const outside = isOutOfFence(event, radiusMetres)

  // A manual entry has no evidence to show — the admin typed it in, and the
  // enterer stamp is the accountability in evidence's place. It must read as
  // visibly not a self check-in wherever attendance is rendered.
  if (event.source === 'manual') {
    return (
      <div className="text-sm">
        <span className="font-semibold text-content">{label}</span>{' '}
        <span className="text-content">{formatTime(event.at)}</span>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-content-muted">
          <span data-testid="entered-by" className="inline-flex items-center gap-1 font-semibold">
            <PencilLine aria-hidden size={12} />
            Entered by {event.enteredByName ?? 'a manager'}
          </span>
          <span>manual entry</span>
        </div>
      </div>
    )
  }

  return (
    <div className="text-sm">
      <span className="font-semibold text-content">{label}</span>{' '}
      <span className="text-content">{formatTime(event.at)}</span>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-content-muted">
        <span className="inline-flex items-center gap-1">
          <MapPin aria-hidden size={12} />
          {event.latitude === null ? (
            <span>No position was recorded from the device</span>
          ) : event.distanceMetres === null ? (
            <span>Distance unknown — this outlet has no captured position</span>
          ) : (
            <span className={outside ? 'font-semibold text-warning' : undefined}>
              {formatMetres(event.distanceMetres)} from the outlet
            </span>
          )}
        </span>
        {event.accuracyMetres !== null && (
          <span>±{formatMetres(event.accuracyMetres)} accuracy</span>
        )}
        <span>{event.source === 'counter_tablet' ? 'counter tablet' : 'phone'}</span>
      </div>
    </div>
  )
}

/**
 * Who settled this day, whether they were standing at the outlet when they did,
 * and any reason they gave. Shown to the employee it concerns, because a record
 * that vouches for somebody should be readable by them.
 */
export function ApprovalNote({
  record,
  radiusMetres,
}: {
  record: AttendanceRecord
  radiusMetres: number
}) {
  const { approval } = record
  if (!approval) return null

  const onSite = wasApprovedOnSite(record, radiusMetres)
  const manual = record.checkIn?.source === 'manual'

  return (
    <div
      data-testid="approval-note"
      className="mt-2 rounded-lg border border-border bg-surface-raised p-2 text-xs"
    >
      <p className="inline-flex items-center gap-1 font-semibold text-content">
        <ShieldCheck aria-hidden size={13} />
        Approved by {approval.byName ?? 'a manager'}, {formatTime(approval.at)}
      </p>
      {/*
        A manual entry was settled by the act of recording it, so there is no
        approver position to report — claiming "not at the outlet" about somebody
        who never took a reading would be a fact the row does not hold.
      */}
      {!manual && (
        <p
          data-testid="approver-place"
          className={
            onSite
              ? 'mt-0.5 inline-flex items-center gap-1 text-content-muted'
              : 'mt-0.5 inline-flex items-center gap-1 font-semibold text-warning'
          }
        >
          {onSite ? <MapPin aria-hidden size={12} /> : <MapPinOff aria-hidden size={12} />}
          {onSite
            ? 'They were at the outlet'
            : approval.distanceMetres === null
              ? 'Their position was not recorded'
              : `They were ${formatMetres(approval.distanceMetres)} from the outlet`}
        </p>
      )}
      {approval.reason && <p className="mt-0.5 text-content-muted">“{approval.reason}”</p>}
    </div>
  )
}

/**
 * What each settled status reads as at a glance. Present and absent are the two
 * a person scanning a month is looking for, so they carry the colour; half day
 * and leave are neither good news nor bad and stay neutral.
 */
const STATUS_TONE = {
  present: 'text-content',
  absent: 'font-semibold text-danger',
  half_day: 'text-content-muted',
  leave: 'text-content-muted',
} as const satisfies Record<AttendanceRecord['status'], string>

/**
 * The day's headline: what it counts as, and whether anything about it is
 * unresolved. Identical wording on every surface.
 */
export function DayVerdict({ record, late = false }: { record: AttendanceRecord; late?: boolean }) {
  const waiting = isWaitingForApproval(record)

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {waiting ? (
        <span className="inline-flex items-center gap-1 font-semibold text-warning">
          <TriangleAlert aria-hidden size={14} />
          {describeDay(record)}
        </span>
      ) : (
        <span className="inline-flex items-center gap-1">
          {record.status === 'present' ? (
            <CheckCircle2 aria-hidden size={14} className="text-success" />
          ) : record.status === 'absent' ? (
            <CircleSlash aria-hidden size={14} className="text-danger" />
          ) : null}
          <span className={STATUS_TONE[record.status]}>{describeDay(record)}</span>
        </span>
      )}
      {late && <LateTag />}
    </span>
  )
}

/**
 * Late is a tag, never a status: an approved late day is present and late, and
 * whether that costs half a day stays a manager's decision recorded in the
 * status.
 */
export function LateTag() {
  return (
    <span
      data-testid="late-tag"
      className="inline-flex items-center gap-1 rounded-full border border-warning px-1.5 py-0.5 text-xs font-semibold text-warning"
      title="This arrival was after the outlet's deadline for the day"
    >
      <Clock aria-hidden size={11} />
      late
    </span>
  )
}

/**
 * How a day with no row reads. Derived from the outlet's clock at the moment of
 * reading — nothing writes these, so there is no row to render and no status to
 * quote (design D6).
 */
export function DerivedVerdict({ reading }: { reading: DayReading }) {
  if (reading.kind === 'absent') {
    return (
      <span
        data-testid="derived-absent"
        className="inline-flex items-center gap-1 font-semibold text-danger"
      >
        <CircleSlash aria-hidden size={14} />
        Absent
      </span>
    )
  }
  return (
    <span
      data-testid="not-yet-arrived"
      className="inline-flex items-center gap-1 text-content-muted"
    >
      <Clock aria-hidden size={14} />
      Not yet arrived
    </span>
  )
}
