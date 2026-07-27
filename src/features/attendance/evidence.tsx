import { CheckCircle2, MapPin, ShieldCheck, TriangleAlert } from 'lucide-react'

import type { AttendanceEvent, AttendanceRecord } from '@/data-access/adapters'
import { formatMetres, formatTime } from '@/domain'

import { describeDay, isAwaitingOverride, isFlaggedCheckOut, isOutOfFence } from './attendance-record'

/**
 * The evidence, rendered once and used by both sides.
 *
 * The employee's own history and the manager's day view import the *same*
 * components deliberately. Asymmetric visibility in a monitoring feature is how
 * it becomes something staff resent, and the cheapest way to keep two views
 * honest is to give them one implementation.
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
        {event.accuracyMetres !== null && <span>±{formatMetres(event.accuracyMetres)} accuracy</span>}
        <span>{event.source === 'counter_tablet' ? 'counter tablet' : 'phone'}</span>
      </div>
    </div>
  )
}

/** Who cleared a blocked check-in, and why. Shown to the employee it concerns. */
export function OverrideNote({ record }: { record: AttendanceRecord }) {
  if (!record.override) return null

  return (
    <div className="mt-2 rounded-lg border border-border bg-surface-raised p-2 text-xs">
      <p className="inline-flex items-center gap-1 font-semibold text-content">
        <ShieldCheck aria-hidden size={13} />
        Approved by {record.override.byName ?? 'a manager'}, {formatTime(record.override.at)}
      </p>
      <p className="mt-0.5 text-content-muted">“{record.override.reason}”</p>
    </div>
  )
}

/**
 * The day's headline: what it counts as, and whether anything about it is
 * unresolved. Identical wording on both surfaces.
 */
export function DayVerdict({
  record,
  radiusMetres,
}: {
  record: AttendanceRecord
  radiusMetres: number
}) {
  const awaiting = isAwaitingOverride(record, radiusMetres)
  const flagged = isFlaggedCheckOut(record, radiusMetres)

  if (awaiting) {
    return (
      <span className="inline-flex items-center gap-1 font-semibold text-warning">
        <TriangleAlert aria-hidden size={14} />
        {describeDay(record, radiusMetres)}
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1">
      {record.status === 'present' ? (
        <CheckCircle2 aria-hidden size={14} className="text-success" />
      ) : null}
      <span className={record.status === 'present' ? 'text-content' : 'text-content-muted'}>
        {describeDay(record, radiusMetres)}
      </span>
      {flagged && (
        <span
          className="inline-flex items-center gap-1 text-xs font-semibold text-warning"
          title="The check-out was recorded away from the outlet"
        >
          <TriangleAlert aria-hidden size={12} />
          check-out flagged
        </span>
      )}
    </span>
  )
}
