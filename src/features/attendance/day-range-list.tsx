import { CalendarCheck } from 'lucide-react'

import { EmptyState } from '@/components/layout/empty-state'
import { formatBusinessDate } from '@/domain'

import { AttendanceCard } from './attendance-card'
import type { AttendanceTally } from './attendance-record'
import type { DayRow } from './attendance-range'
import {
  AbsenceReason,
  ApprovalNote,
  AttendanceHistory,
  DayVerdict,
  DerivedVerdict,
  EventEvidence,
} from './evidence'

/**
 * A span of days, rendered once for both surfaces that show one.
 *
 * The manager's person view and a person's own history are the same list of the
 * same facts, seen from two sides. The spec requires that an employee sees
 * exactly what their manager sees, and one component is the only way to keep
 * that true the next time either side gains a field.
 */

export function TallySummary({ tally }: { tally: AttendanceTally }) {
  const cells: { label: string; value: number; testId: string; warn?: boolean }[] = [
    { label: 'Present', value: tally.present, testId: 'tally-present' },
    { label: 'Late', value: tally.late, testId: 'tally-late', warn: tally.late > 0 },
    { label: 'Absent', value: tally.absent, testId: 'tally-absent' },
    { label: 'Waiting', value: tally.waiting, testId: 'tally-waiting', warn: tally.waiting > 0 },
  ]

  return (
    <dl
      data-testid="attendance-tally"
      className="mb-3 grid grid-cols-4 gap-2 rounded-xl border border-border bg-surface p-2 text-center"
    >
      {cells.map((cell) => (
        <div key={cell.label}>
          <dd
            data-testid={cell.testId}
            className={
              cell.warn ? 'text-lg font-bold text-warning' : 'text-lg font-bold text-content'
            }
          >
            {cell.value}
          </dd>
          <dt className="text-xs text-content-muted">{cell.label}</dt>
        </div>
      ))}
    </dl>
  )
}

export function RangeDayList({
  rows,
  radiusFor,
  personId,
  showOutlet = false,
}: {
  rows: readonly DayRow[]
  /** The radius each day was judged against — its own outlet's, never one number. */
  radiusFor: (row: DayRow) => number
  /**
   * Whose days these are. Both callers know it and they answer differently —
   * their own on `My attendance`, whoever the picker names on the by-staff
   * axis — and a day with no row carries nobody to ask, so it is stated rather
   * than derived.
   */
  personId: string | null
  /** Name the outlet on each day. Noise for one shop; necessary for two. */
  showOutlet?: boolean
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={CalendarCheck}
        title="No days in this range. Try a wider one, or check the dates."
      />
    )
  }

  return (
    <div data-testid="attendance-range" className="space-y-2">
      {rows.map((row) => (
        // Keyed on the date alone since attendance-one-day-per-person: a
        // business date appears once, so anything else in the key would be
        // saying it might not.
        <RangeDayCard
          key={row.businessDate}
          row={row}
          radiusMetres={radiusFor(row)}
          personId={personId}
          outletName={showOutlet ? row.outletName : null}
        />
      ))}
    </div>
  )
}

export function RangeDayCard({
  row,
  radiusMetres,
  personId = null,
  outletName = null,
}: {
  row: DayRow
  radiusMetres: number
  /** Whose day this is, so an absence can be addressed to them. */
  personId?: string | null
  outletName?: string | null
}) {
  const record =
    row.reading.kind === 'waiting' || row.reading.kind === 'recorded' ? row.reading.record : null
  const waiting = row.reading.kind === 'waiting'
  // A day nobody recorded still has one thing to say if it is absent, which is
  // why. It is the only content a derived day has ever had.
  const derivedAbsence = record === null && row.reading.kind === 'absent'

  return (
    <AttendanceCard
      testId={`range-day-${row.businessDate}`}
      toggleTestId={`expand-range-${row.businessDate}`}
      heading="h3"
      waiting={waiting}
      defaultOpen={waiting}
      title={
        <span>
          {formatBusinessDate(row.businessDate)}
          {outletName && (
            <span className="ml-2 text-xs font-normal text-content-muted">{outletName}</span>
          )}
        </span>
      }
      verdict={
        record ? (
          <DayVerdict record={record} late={row.late} />
        ) : (
          <DerivedVerdict reading={row.reading} />
        )
      }
      /*
        A derived day has no evidence and no approval to render beneath its
        verdict: no row exists (design D6). It has no outlet either — a day
        nobody recorded was worked nowhere, and naming a shop beside it would
        invent a fact. What it does have, when it is an absence, is a reason to
        be one, and that is worth a chevron; the other two derived readings still
        open onto nothing and so still show none.
      */
      details={
        record ? (
          <>
            <AbsenceReason reading={row.reading} subjectId={personId} />
            <div className="flex flex-wrap items-center gap-1.5">
              <EventEvidence label="Arrived" event={record.checkIn} radiusMetres={radiusMetres} />
            </div>
            <ApprovalNote record={record} radiusMetres={radiusMetres} />
            <AttendanceHistory record={record} />
          </>
        ) : derivedAbsence ? (
          <AbsenceReason reading={row.reading} subjectId={personId} />
        ) : null
      }
    />
  )
}
