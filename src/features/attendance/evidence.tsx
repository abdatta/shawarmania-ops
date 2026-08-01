import {
  CheckCircle2,
  CircleSlash,
  Clock,
  Crosshair,
  MapPin,
  MapPinOff,
  PencilLine,
  ShieldCheck,
  Smartphone,
  Store,
  Tablet,
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
 *
 * **Chips rather than sentences since attendance-one-day-per-person**
 * (design D9). A row used to spend three lines of prose on four short facts, and
 * a combined roll-call across two outlets makes that a page of scrolling. What
 * compressed is the presentation and nothing else: every fact the spec requires
 * is still here, every icon still carries a name, and colour is still never the
 * only signal. Because these components are shared, the employee's own screen
 * got the same redesign — which is correct, and is why they are shared.
 */

/**
 * One short fact, with its icon and a name for the icon.
 *
 * `name` is not decoration. A chip reading "127 m" tells a sighted reader what
 * it is from the pin beside it and tells a screen reader nothing at all, so the
 * name is read first and the value second.
 */
function Chip({
  icon: Icon,
  name,
  children,
  warn = false,
  ...rest
}: {
  icon: typeof MapPin
  name: string
  children: React.ReactNode
  /** Something a manager should weigh. Never the only signal — the icon changes too. */
  warn?: boolean
} & { 'data-testid'?: string }) {
  return (
    <span
      className={
        warn
          ? 'inline-flex items-center gap-1 rounded-md border border-warning px-1.5 py-0.5 font-semibold text-warning'
          : 'inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-content-muted'
      }
      {...rest}
    >
      <Icon aria-hidden size={11} />
      <span className="sr-only">{name}: </span>
      {children}
    </span>
  )
}

/** Which shop a row belongs to. Rendered only where more than one is in scope. */
export function OutletChip({ name }: { name: string | null }) {
  if (!name) return null
  return (
    <Chip icon={Store} name="Outlet" data-testid="outlet-chip">
      {name}
    </Chip>
  )
}

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
      <p className="text-xs text-content-muted">
        <span className="font-semibold text-content">{label}</span> not recorded
      </p>
    )
  }

  const outside = isOutOfFence(event, radiusMetres)
  const manual = event.source === 'manual'

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="text-sm font-semibold text-content">{formatTime(event.at)}</span>
      <span className="sr-only">{label}</span>

      {/*
        A manual entry has no evidence to show — the admin typed it in, and the
        enterer stamp is the accountability in evidence's place. It must read as
        visibly not a self check-in wherever attendance is rendered, which is why
        it gets its own icon rather than a quieter version of the same chip.
      */}
      {manual ? (
        <Chip icon={PencilLine} name="Entered by" data-testid="entered-by">
          {event.enteredByName ?? 'a manager'}
        </Chip>
      ) : (
        <>
          {event.latitude === null ? (
            <Chip icon={MapPinOff} name="Position" warn>
              no position
            </Chip>
          ) : event.distanceMetres === null ? (
            <Chip icon={MapPinOff} name="Distance from the outlet">
              not measured
            </Chip>
          ) : (
            <Chip icon={MapPin} name="Distance from the outlet" warn={outside}>
              {formatMetres(event.distanceMetres)}
            </Chip>
          )}
          {event.accuracyMetres !== null && (
            <Chip icon={Crosshair} name="Reading accuracy">
              ±{formatMetres(event.accuracyMetres)}
            </Chip>
          )}
          <Chip icon={event.source === 'counter_tablet' ? Tablet : Smartphone} name="Recorded on">
            {event.source === 'counter_tablet' ? 'tablet' : 'phone'}
          </Chip>
        </>
      )}
    </div>
  )
}

/**
 * Who settled this day, whether they were standing at the outlet when they did,
 * and any reason they gave. Shown to the employee it concerns, because a record
 * that vouches for somebody should be readable by them.
 *
 * One line, plus a second only when a reason exists. It used to be three lines
 * in a bordered panel; a reason is the only part of it that is ever more than a
 * few words, so it is the only part that gets a line of its own.
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
    <div data-testid="approval-note" className="space-y-1 text-xs">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1 text-content-muted">
          <ShieldCheck aria-hidden size={12} />
          {approval.byName ?? 'a manager'}, {formatTime(approval.at)}
        </span>
        {/*
          A manual entry was settled by the act of recording it, so there is no
          approver position to report — claiming "not at the outlet" about
          somebody who never took a reading would be a fact the row does not
          hold.
        */}
        {!manual &&
          (onSite ? (
            <Chip icon={MapPin} name="Approver" data-testid="approver-place">
              on site
            </Chip>
          ) : (
            <Chip icon={MapPinOff} name="Approver" warn data-testid="approver-place">
              {approval.distanceMetres === null
                ? 'position not recorded'
                : formatMetres(approval.distanceMetres)}
            </Chip>
          ))}
      </div>
      {approval.reason && (
        <p className="text-content-muted">
          <span className="sr-only">Approval reason: </span>“{approval.reason}”
        </p>
      )}
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
  /*
    Accounted for at an outlet this reader cannot see (design D3). Neutral, not
    warning: nothing is wrong and nothing is waiting on anybody here. The outlet
    is not named because the database does not disclose it — one bit crossed the
    boundary, and this is that bit rendered.
  */
  if (reading.kind === 'elsewhere') {
    return (
      <span
        data-testid="working-elsewhere"
        className="inline-flex items-center gap-1 text-content-muted"
      >
        <Store aria-hidden size={14} />
        Working at another outlet
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
