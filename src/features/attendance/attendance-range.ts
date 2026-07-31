import type { AttendanceRecord } from '@/data-access/adapters'
import { resolveBusinessDate, shiftBusinessDate } from '@/domain'

import { isLate, readDay, type DayReading } from './attendance-record'

/**
 * Reading attendance as a pattern rather than a roll-call.
 *
 * A day view answers "who was here today". This answers "how has this person
 * been", which is the question a manager actually asks and which reading one day
 * at a time does not answer at all. The awkward part is that the interesting days
 * are the ones with no row: a month of attendance is mostly absences, and
 * absences are derived (design D6), so the range has to be walked date by date
 * rather than mapped over the rows that happen to exist.
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
  /** Which outlet this day belongs to. Named where a person works at several. */
  outletId: string
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

/** Is this date inside any of the person's assignment windows at the outlet? */
function withinAssignment(
  businessDate: string,
  windows: readonly { startedOn: string; endedOn: string | null }[],
): boolean {
  return windows.some(
    (window) =>
      businessDate >= window.startedOn &&
      (window.endedOn === null || businessDate <= window.endedOn),
  )
}

/**
 * Every business date in a range, as it reads for one person at one outlet.
 *
 * Bounded by the person's assignment windows, so no day before they joined or
 * after they left is painted at all — otherwise a month view of somebody hired
 * on the 20th would open with nineteen absences they had nothing to do with.
 * Bounded above by the outlet's own today, because a day that has not happened
 * is not an absence.
 *
 * Most recent first, matching every other attendance read.
 */
export function assembleRange({
  records,
  outlet,
  range,
  windows,
  now = new Date(),
}: {
  records: readonly AttendanceRecord[]
  outlet: {
    id: string
    name: string
    arrival_deadline: string
    business_day_cutover: string
  }
  range: DateRange
  windows: readonly { startedOn: string; endedOn: string | null }[]
  now?: Date
}): DayRow[] {
  const today = resolveBusinessDate(now, outlet.business_day_cutover)
  const last = range.to < today ? range.to : today
  const rows: DayRow[] = []

  for (let date = last, guard = 0; date >= range.from && guard < MAX_RANGE_DAYS; guard += 1) {
    if (withinAssignment(date, windows)) {
      const record = records.find((candidate) => candidate.businessDate === date) ?? null
      rows.push({
        businessDate: date,
        reading: readDay(record, outlet, date, now),
        late: record !== null && isLate(record, outlet.business_day_cutover),
        outletId: outlet.id,
        outletName: outlet.name,
      })
    }
    date = shiftBusinessDate(date, -1)
  }

  return rows
}
