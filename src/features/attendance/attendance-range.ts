import type { AttendanceRecord } from '@/data-access/adapters'
import { resolveBusinessDate, shiftBusinessDate } from '@/domain'

import { isLate, readDay, type DayReading, type OutletClock } from './attendance-record'

/**
 * Reading attendance as a pattern rather than a roll-call.
 *
 * A day view answers "who was here today". This answers "how has this person
 * been", which is the question a manager actually asks and which reading one day
 * at a time does not answer at all. The awkward part is that the interesting days
 * are the ones with no row: a month of attendance is mostly absences, and
 * absences are derived (design D6), so the range has to be walked date by date
 * rather than mapped over the rows that happen to exist.
 *
 * **One row per business date, across every outlet in scope**
 * (attendance-one-day-per-person). The range used to be assembled once per
 * outlet and the results concatenated, which is what produced a person reading
 * present at one shop and absent at the other on the same day. There is one day,
 * and it names the outlet it was worked at.
 */

export interface DateRange {
  /** Inclusive, `YYYY-MM-DD`. */
  from: string
  /** Inclusive. */
  to: string
}

/** One business date in a range, as it reads. */
export interface DayRow {
  businessDate: string
  reading: DayReading
  late: boolean
  /**
   * Which outlet this day was worked at. Named where a person works at several.
   * Null on a day with no row, because a day nobody recorded was worked
   * nowhere — the old code named the outlet the absence was assembled against,
   * which is how one person acquired two contradictory verdicts for one date.
   */
  outletId: string | null
  outletName: string | null
}

/**
 * A ceiling on how many days one read may paint. A range is a pair of dates a
 * person can type, and a decade of derived absences is neither useful nor
 * something any surface should try to render.
 */
export const MAX_RANGE_DAYS = 400

const pad = (value: number) => String(value).padStart(2, '0')

function parseMonth(businessDate: string): { year: number; month: number } {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(businessDate)
  if (!match) {
    throw new TypeError(`Expected a YYYY-MM-DD business date, got "${businessDate}"`)
  }
  return { year: Number(match[1]), month: Number(match[2]) }
}

/** The calendar month a business date falls in. The default range everywhere. */
export function monthRange(businessDate: string): DateRange {
  const { year, month } = parseMonth(businessDate)
  // Day 0 of the next month is the last day of this one, which avoids having to
  // know about leap years.
  const last = new Date(Date.UTC(year, month, 0))
  return {
    from: `${year}-${pad(month)}-01`,
    to: `${last.getUTCFullYear()}-${pad(last.getUTCMonth() + 1)}-${pad(last.getUTCDate())}`,
  }
}

/** The same month, shifted. `-1` is last month, which is the other ask. */
export function shiftMonthRange(range: DateRange, months: number): DateRange {
  const { year, month } = parseMonth(range.from)
  const shifted = new Date(Date.UTC(year, month - 1 + months, 1))
  return monthRange(
    `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`,
  )
}

/** An outlet a range may be read across: its identity and its clock. */
export interface RangeOutlet extends OutletClock {
  id: string
  name: string
}

/** One live stretch of somebody's employment at one outlet. */
export interface AssignmentWindow {
  outletId: string
  startedOn: string
  endedOn: string | null
}

/** Was this person on this outlet's books on this date? */
function assignedAt(
  businessDate: string,
  outletId: string,
  windows: readonly AssignmentWindow[],
): boolean {
  return windows.some(
    (window) =>
      window.outletId === outletId &&
      businessDate >= window.startedOn &&
      (window.endedOn === null || businessDate <= window.endedOn),
  )
}

/**
 * Every business date in a range, as it reads for one person across the outlets
 * in scope.
 *
 * Bounded by the person's assignment windows, so no day before they joined or
 * after they left is painted at all — otherwise a month view of somebody hired
 * on the 20th would open with nineteen absences they had nothing to do with. A
 * day carrying a real row is listed whatever the windows say, because the day
 * was worked and the row outlives the assignment it was worked under.
 *
 * Bounded above by today as the outlets reckon it — the latest of them, so a day
 * that has started somewhere is not hidden, and one that has started nowhere is
 * not called an absence.
 *
 * Most recent first, matching every other attendance read.
 */
export function assembleRange({
  records,
  outlets,
  range,
  windows,
  now = new Date(),
}: {
  records: readonly AttendanceRecord[]
  /** Every outlet this read covers. One for nearly everybody. */
  outlets: readonly RangeOutlet[]
  range: DateRange
  windows: readonly AssignmentWindow[]
  now?: Date
}): DayRow[] {
  const today = outlets
    .map((outlet) => resolveBusinessDate(now, outlet.business_day_cutover))
    .reduce((latest, candidate) => (candidate > latest ? candidate : latest), '')
  if (today === '') return []

  const last = range.to < today ? range.to : today
  const rows: DayRow[] = []

  for (let date = last, guard = 0; date >= range.from && guard < MAX_RANGE_DAYS; guard += 1) {
    // One record per date now, whatever outlet it names.
    const record = records.find((candidate) => candidate.businessDate === date) ?? null
    // Only the outlets that actually had a claim on this person that day get to
    // decide whether they are late arriving. A shop they had not joined yet
    // cannot be waiting for them.
    const active = outlets.filter((outlet) => assignedAt(date, outlet.id, windows))

    if (record !== null || active.length > 0) {
      const worked =
        record === null ? null : (outlets.find((o) => o.id === record.outletId) ?? null)
      rows.push({
        businessDate: date,
        reading: readDay(record, active, date, { now }),
        late: record !== null && worked !== null && isLate(record, worked.business_day_cutover),
        outletId: record?.outletId ?? null,
        outletName: record?.outletName ?? worked?.name ?? null,
      })
    }
    date = shiftBusinessDate(date, -1)
  }

  return rows
}
