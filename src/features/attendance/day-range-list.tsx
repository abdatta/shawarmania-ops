import { CalendarCheck } from 'lucide-react'

import { EmptyState } from '@/components/layout/empty-state'
import { Card } from '@/components/ui/card'
import { formatBusinessDate } from '@/domain'

import type { AttendanceTally } from './attendance-record'
import type { DayRow } from './attendance-range'
import { ApprovalNote, DayVerdict, DerivedVerdict, EventEvidence, OutletChip } from './evidence'

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
  showOutlet = false,
}: {
  rows: readonly DayRow[]
  /** The radius each day was judged against — its own outlet's, never one number. */
  radiusFor: (row: DayRow) => number
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
          outletName={showOutlet ? row.outletName : null}
        />
      ))}
    </div>
  )
}

export function RangeDayCard({
  row,
  radiusMetres,
  outletName = null,
}: {
  row: DayRow
  radiusMetres: number
  outletName?: string | null
}) {
  const record =
    row.reading.kind === 'waiting' || row.reading.kind === 'recorded' ? row.reading.record : null

  return (
    <Card
      data-testid={`range-day-${row.businessDate}`}
      className={
        row.reading.kind === 'waiting' ? 'space-y-1.5 p-3 border-warning' : 'space-y-1.5 p-3'
      }
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
        <h3 className="text-sm font-bold text-content">{formatBusinessDate(row.businessDate)}</h3>
        <span className="text-sm">
          {record ? (
            <DayVerdict record={record} late={row.late} />
          ) : (
            <DerivedVerdict reading={row.reading} />
          )}
        </span>
      </div>

      {/*
        A derived day has nothing to render beneath its verdict, and that is the
        honest amount: no row exists, so there is no evidence and no approval to
        show (design D6). It has no outlet either — a day nobody recorded was
        worked nowhere, and naming a shop beside it would invent a fact.
      */}
      {record && (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            <OutletChip name={outletName} />
            <EventEvidence label="Arrived" event={record.checkIn} radiusMetres={radiusMetres} />
          </div>
          <ApprovalNote record={record} radiusMetres={radiusMetres} />
        </>
      )}
    </Card>
  )
}
