import { useState } from 'react'

import { FormSheet } from '@/components/layout/form-sheet'
import { formatBusinessWeekday, formatTime, shiftBusinessDate } from '@/domain'
import { cn } from '@/lib/cn'

import type { AttendanceTally } from './attendance-record'
import type { DateRange, DayRow } from './attendance-range'
import {
  AbsenceReason,
  ApprovalNote,
  AttendanceHistory,
  DayVerdict,
  DerivedVerdict,
  EventEvidence,
} from './evidence'
import { PlaceChip } from './today-pass'

/**
 * A month on one screen, drawn as a calendar: the day numbers in a week grid,
 * each day's state in how its number is drawn, and the month's counts above it
 * doubling as the key (a-check-in-at-the-shop-approves-itself, design D8;
 * `refreshed-staff-screens`).
 *
 * **Never colour alone, without a letter on every day.** Every day is an open
 * ring in its status chip's colour, and the states differ by shape as well:
 * present a green ring, late the same ring with the late clock, absent a red
 * ring with the chip's slash, waiting a ring of yellow dashes, leave a grey
 * ring, today before anything is recorded a grey ring as its chip, a day
 * still to come a bare number. Each day also names its state to a screen reader. The
 * first version spelled it out with an icon and a letter in every cell, and read
 * as a table of symbols rather than as a month [owner, 2026-10-26].
 *
 * One component for a person's own month and for the manager's By staff, as the
 * list it replaces was: an employee sees exactly what their manager sees, and
 * two renderers would drift apart the first time either gained a field. Tapping
 * a day opens its detail with the same shared evidence components as before.
 */

type Mark = 'present' | 'late' | 'absent' | 'waiting' | 'leave' | 'half' | 'elsewhere' | 'not-yet'

const MARKS: Record<Mark, { label: string; disc: string }> = {
  // Every day is an open ring in the colour of its status chip in the day's
  // detail: filled discs flooded a good month [co-owner, 2026-10-29]. Present
  // is green, as the chip's tick; absent red, with the chip's slash, so it
  // never rests on red against green; waiting a dashed yellow ring, as the
  // chip's warning. The dashes are drawn, not a CSS border: a dotted or dashed
  // border on a small circle comes out as a fine row of specks [owner,
  // 2026-10-26], so DashedRing sets a few long dashes whatever the size.
  present: { label: 'Present', disc: 'border-2 border-success text-content font-semibold' },
  late: {
    label: 'Present, arrived late',
    disc: 'border-2 border-success text-content font-semibold',
  },
  absent: {
    label: 'Absent',
    disc: 'border-2 border-danger text-danger font-semibold',
  },
  waiting: {
    label: 'Waiting for a manager',
    disc: 'text-content',
  },
  leave: { label: 'Leave', disc: 'border-2 border-content-muted text-content-muted' },
  half: { label: 'Half day', disc: 'border-2 border-content-muted text-content-muted' },
  elsewhere: {
    label: 'At another outlet',
    disc: 'border-2 border-content-muted text-content-muted',
  },
  // Today with nothing recorded yet: a grey ring, as the Not yet arrived chip, until
  // the day has a status of its own [co-owner, 2026-10-29].
  'not-yet': {
    label: 'Not checked in yet',
    disc: 'border-2 border-content-muted text-content font-semibold',
  },
}

function markOf(row: DayRow): Mark {
  const { reading } = row
  switch (reading.kind) {
    case 'not-yet-arrived':
      return 'not-yet'
    case 'absent':
      return 'absent'
    case 'elsewhere':
      return 'elsewhere'
    case 'waiting':
      return 'waiting'
    case 'recorded': {
      const { status } = reading.record
      if (status === 'present') return row.late ? 'late' : 'present'
      if (status === 'leave') return 'leave'
      if (status === 'half_day') return 'half'
      return 'absent'
    }
  }
}

/**
 * A count drawn in the very circle the days it counts are drawn in, so the
 * counts are the key: no separate swatch beside a label [owner, 2026-10-27].
 */
function CountDisc({ mark, value }: { mark: Mark; value: number }) {
  return (
    <span
      className={cn(
        'relative flex size-10 items-center justify-center rounded-full text-base',
        MARKS[mark].disc,
      )}
    >
      {value}
      {mark === 'late' && <LateClock />}
      {mark === 'waiting' && <DashedRing dashes={8} strokeWidth={1} />}
      {mark === 'absent' && <Slash />}
    </span>
  )
}

/**
 * The absent chip's slash, across the ring but broken where the number sits, so
 * the number stays readable and absent differs from present by shape.
 */
function Slash() {
  return (
    <svg aria-hidden viewBox="0 0 36 36" className="absolute inset-0 size-full text-danger">
      <path
        d="M6.3 6.3 10.5 10.5M25.5 25.5 29.7 29.7"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
      />
    </svg>
  )
}

/**
 * A ring of a few long dashes, sized to its disc. `pathLength` makes the dash
 * pattern a share of the circle rather than pixels, so a day and its key both
 * read as dashes, never as dots.
 */
function DashedRing({ dashes, strokeWidth }: { dashes: number; strokeWidth: number }) {
  const step = 100 / dashes
  return (
    <svg aria-hidden viewBox="0 0 36 36" className="absolute inset-0 size-full text-warning">
      <circle
        cx="18"
        cy="18"
        r={18 - strokeWidth}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth * 2}
        strokeLinecap="round"
        pathLength={100}
        strokeDasharray={`${step * 0.55} ${step * 0.45}`}
        transform="rotate(-90 18 18)"
      />
    </svg>
  )
}

/**
 * The mark of a late arrival: the late tag's clock, filled, so it still reads
 * as a dot at a glance and as lateness up close [owner, 2026-10-29]. In the
 * yellow lateness has everywhere else (the late tag, the Late count), ringed
 * in the page's colour so it sits clear of the day's disc. It sits on any day
 * with an arrival after the deadline, a waiting one included, since late and
 * waiting are separate facts.
 */
function LateClock() {
  return (
    <svg
      aria-hidden
      data-testid="late-clock"
      viewBox="0 0 24 24"
      className="absolute -top-0.5 -right-0.5 size-3.5 text-warning"
    >
      <circle
        cx="12"
        cy="12"
        r="10.5"
        fill="currentColor"
        className="stroke-surface"
        strokeWidth="3"
      />
      <path
        d="M12 7v5l3 2"
        fill="none"
        className="stroke-surface"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** The month's counts, each inside the disc it counts, so they double as the key. */
export function MonthTally({ tally }: { tally: AttendanceTally }) {
  const cells: { mark: Mark; label: string; value: number; testId: string }[] = [
    { mark: 'present', label: 'Present', value: tally.present, testId: 'tally-present' },
    { mark: 'late', label: 'Late', value: tally.late, testId: 'tally-late' },
    { mark: 'absent', label: 'Absent', value: tally.absent, testId: 'tally-absent' },
    { mark: 'waiting', label: 'Waiting', value: tally.waiting, testId: 'tally-waiting' },
  ]
  return (
    <dl data-testid="attendance-tally" className="mb-3 grid grid-cols-4 gap-2 text-center">
      {cells.map((cell) => (
        <div
          key={cell.label}
          className="flex flex-col items-center gap-1 rounded-xl border border-border bg-surface px-1 py-2"
        >
          <dd data-testid={cell.testId}>
            <CountDisc mark={cell.mark} value={cell.value} />
          </dd>
          <dt className="text-xs text-content-muted">{cell.label}</dt>
        </div>
      ))}
    </dl>
  )
}

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const
const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

/** Monday-first column of a business date, 0–6. */
function column(businessDate: string): number {
  return (new Date(`${businessDate}T00:00:00Z`).getUTCDay() + 6) % 7
}

export function MonthCalendar({
  rows,
  range,
  radiusFor,
  personId,
  showOutlet = false,
  today = null,
}: {
  rows: readonly DayRow[]
  range: DateRange
  /** The radius each day was judged against — its own outlet's, never one number. */
  radiusFor: (row: DayRow) => number
  /** Whose days these are, so an absence can be addressed to them. */
  personId: string | null
  /** Name the outlet on a day. Noise for one shop; necessary for two. */
  showOutlet?: boolean
  /**
   * Today's business date, named to a screen reader. Ringed grey, as its chip,
   * only while it has no status of its own (`not-yet`); once it has
   * one, its ring is that status's [co-owner, 2026-10-29].
   */
  today?: string | null
}) {
  const [open, setOpen] = useState<string | null>(null)
  const byDate = new Map(rows.map((row) => [row.businessDate, row]))
  const dates: string[] = []
  for (let date = range.from; date <= range.to; date = shiftBusinessDate(date, 1)) dates.push(date)
  const opened = open ? (byDate.get(open) ?? null) : null

  return (
    <div
      data-testid="attendance-calendar"
      className="rounded-xl border border-border bg-surface p-3"
    >
      <div
        className="grid grid-cols-7 gap-y-1 text-center"
        role="grid"
        aria-label="Days of the month"
      >
        {WEEKDAYS.map((day, index) => (
          <abbr
            key={WEEKDAY_NAMES[index]}
            title={WEEKDAY_NAMES[index]}
            role="columnheader"
            className="pb-1 text-xs font-semibold text-content-muted no-underline"
          >
            {day}
          </abbr>
        ))}
        {/* The month starts on its own weekday, so the grid leads with blanks. */}
        {Array.from({ length: column(range.from) }, (_, index) => (
          <span key={`lead-${index}`} aria-hidden />
        ))}
        {dates.map((date) => {
          const row = byDate.get(date)
          const dayNumber = Number(date.slice(8))
          const isToday = date === today
          if (!row) {
            // A day not reached yet, or before they joined: just the number.
            return (
              <span
                key={date}
                className="flex h-11 items-center justify-center text-sm text-content-muted opacity-50"
                aria-label={formatBusinessWeekday(date)}
              >
                {dayNumber}
              </span>
            )
          }
          const mark = markOf(row)
          return (
            <button
              key={date}
              type="button"
              data-testid={`calendar-day-${date}`}
              data-mark={mark}
              onClick={() => setOpen(date)}
              aria-label={`${formatBusinessWeekday(date)}: ${MARKS[mark].label}${mark === 'waiting' && row.late ? ', arrived late' : ''}${isToday ? ', today' : ''}`}
              className="flex h-11 items-center justify-center rounded-full focus-visible:focus-ring"
            >
              <span
                className={cn(
                  'relative flex size-9 items-center justify-center rounded-full text-sm',
                  MARKS[mark].disc,
                )}
              >
                {dayNumber}
                {(mark === 'late' || (mark === 'waiting' && row.late)) && <LateClock />}
                {mark === 'waiting' && <DashedRing dashes={8} strokeWidth={1} />}
                {mark === 'absent' && <Slash />}
              </span>
            </button>
          )
        })}
      </div>

      <FormSheet
        open={opened !== null}
        onClose={() => setOpen(null)}
        title={
          opened
            ? `${formatBusinessWeekday(opened.businessDate)}${showOutlet && opened.outletName ? ` · ${opened.outletName}` : ''}`
            : ''
        }
      >
        {opened && <DayDetail row={opened} radiusMetres={radiusFor(opened)} personId={personId} />}
      </FormSheet>
    </div>
  )
}

/** One day's verdict and evidence, from the same components the list used. */
function DayDetail({
  row,
  radiusMetres,
  personId,
}: {
  row: DayRow
  radiusMetres: number
  personId: string | null
}) {
  const record =
    row.reading.kind === 'waiting' || row.reading.kind === 'recorded' ? row.reading.record : null
  return (
    <div data-testid={`calendar-detail-${row.businessDate}`} className="space-y-2 text-sm">
      <div>
        {record ? (
          <DayVerdict record={record} late={row.late} />
        ) : (
          <DerivedVerdict reading={row.reading} />
        )}
      </div>
      <AbsenceReason reading={row.reading} subjectId={personId} />
      {record && (
        <>
          {/* A day marked by a manager with no arrival says so, not "not recorded". */}
          {record.checkIn ? (
            <>
              <p className="flex flex-wrap items-center gap-2 text-content">
                Checked in {formatTime(record.checkIn.at).replace(/^0/, '')}
                <PlaceChip event={record.checkIn} outlet={{ geofence_radius_m: radiusMetres }} />
              </p>
              {/* The numbers the plain word stands for, for whoever asks. */}
              <details data-testid="calendar-why">
                <summary className="cursor-pointer text-xs font-semibold text-content-muted">
                  Why?
                </summary>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <EventEvidence
                    label="Arrived"
                    event={record.checkIn}
                    radiusMetres={radiusMetres}
                  />
                </div>
              </details>
            </>
          ) : (
            <p className="text-content-muted">Recorded by a manager, with no check-in.</p>
          )}
          <ApprovalNote record={record} radiusMetres={radiusMetres} />
          <AttendanceHistory record={record} />
        </>
      )}
    </div>
  )
}
