/**
 * Date and time formatting. Pure, no I/O.
 *
 * Timestamps are stored as UTC and displayed in Asia/Kolkata. The time zone is
 * always passed explicitly and never inherited from the device: a tablet with
 * a wrong clock setting must not silently relabel which day a bill belongs to.
 *
 * Business dates are a separate concept — an explicit `date` column resolved
 * against the outlet's cutover, never derived from a timestamp here. This
 * module only renders one that has already been resolved.
 */

export const OUTLET_TIME_ZONE = 'Asia/Kolkata'

const dateFormat = new Intl.DateTimeFormat('en-IN', {
  timeZone: OUTLET_TIME_ZONE,
  day: '2-digit',
  month: 'short',
  year: 'numeric',
})

const timeFormat = new Intl.DateTimeFormat('en-IN', {
  timeZone: OUTLET_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
})

const dateTimeFormat = new Intl.DateTimeFormat('en-IN', {
  timeZone: OUTLET_TIME_ZONE,
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
})

const dayMonthTimeFormat = new Intl.DateTimeFormat('en-IN', {
  timeZone: OUTLET_TIME_ZONE,
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
})

const yearFormat = new Intl.DateTimeFormat('en-IN', {
  timeZone: OUTLET_TIME_ZONE,
  year: 'numeric',
})

/**
 * How fresh a measured figure is: `11:00 pm` today, otherwise `2 Aug, 11:00 pm`.
 *
 * **A bare time means today**, which is how somebody says it out loud, and the
 * absence of a date is itself the signal that none is needed [owner,
 * 2026-08-29]. Anything older carries its date and cannot be mistaken for it.
 *
 * No `Yesterday`. `formatDayTime` beside this one offers it, and is right to —
 * it labels a list of a shift's own bills, where the reader is standing inside
 * that day. A freshness stamp is read the other way round: the question is
 * *how stale is this*, and a day word has to be converted back into a date
 * before it answers.
 *
 * The year is dropped for the same reason a receipt drops it: a reading old
 * enough for the year to matter is a problem the year would not be the first
 * sign of.
 */
export function formatFreshness(instant: Date | string, now: Date | string = new Date()): string {
  const at = toDate(instant)
  if (formatDate(at) === formatDate(now)) return formatTime(at)
  return dayMonthTimeFormat.format(at)
}

/** `2026-07-25T14:30:00Z` -> `25 Jul 2026` (in Asia/Kolkata). */
export function formatDate(instant: Date | string): string {
  return dateFormat.format(toDate(instant))
}

/** `2026-07-25T14:30:00Z` -> `08:00 pm` (in Asia/Kolkata). */
export function formatTime(instant: Date | string): string {
  return timeFormat.format(toDate(instant))
}

/** `2026-07-25T14:30:00Z` -> `25 Jul 2026, 08:00 pm` (in Asia/Kolkata). */
export function formatDateTime(instant: Date | string): string {
  return dateTimeFormat.format(toDate(instant))
}

/**
 * `Today, 08:00 pm` for a calendar day the reader is standing in, otherwise the
 * date and time. Current-year dates omit the repeated year; older years keep it.
 *
 * For lists of closed work — a shift's bills — where the whole list is nearly
 * always the same day and repeating that day down every row spends the reader's
 * attention on the one part they already know. `Today` and `Yesterday` because
 * an evening shift crosses midnight and the previous label would then be wrong
 * without being obviously wrong.
 *
 * This is the **calendar** day in Asia/Kolkata, not the outlet's business day:
 * it labels a wall-clock timestamp, and a bill rung at 00:20 belongs to the
 * business day before but genuinely happened today. Business dates are rendered
 * by `formatBusinessDate`, which is a different question.
 */
export function formatDayTime(instant: Date | string, now: Date | string = new Date()): string {
  const at = toDate(instant)
  const today = formatDate(now)

  if (formatDate(at) === today) return `Today, ${formatTime(at)}`

  const yesterday = new Date(toDate(now).getTime() - 24 * 60 * 60 * 1000)
  if (formatDate(at) === formatDate(yesterday)) return `Yesterday, ${formatTime(at)}`

  if (yearFormat.format(at) === yearFormat.format(toDate(now))) {
    return dayMonthTimeFormat.format(at)
  }

  return formatDateTime(at)
}

/**
 * Operational age for recent work at the counter.
 *
 * Today's orders read as age because that is faster to scan while food is being
 * prepared. Older orders keep their full outlet-local date and time so the age
 * never obscures which trading day the reference came from.
 */
export function formatRecentAge(instant: Date | string, now: Date | string = new Date()): string {
  const at = toDate(instant)
  const current = toDate(now)

  if (formatDate(at) !== formatDate(current)) return formatDateTime(at)

  const elapsedMinutes = Math.max(0, Math.floor((current.getTime() - at.getTime()) / 60_000))
  if (elapsedMinutes < 1) return 'now'
  if (elapsedMinutes === 1) return '1 min ago'
  if (elapsedMinutes < 60) return `${elapsedMinutes} mins ago`

  const elapsedHours = Math.floor(elapsedMinutes / 60)
  return elapsedHours === 1 ? '1 hr ago' : `${elapsedHours} hrs ago`
}

/**
 * Render an already-resolved business date (`2026-07-25`) as a date.
 *
 * Parsed as UTC midnight and formatted in UTC, not Asia/Kolkata — a business
 * date is a calendar label, not an instant, and running it through a +05:30
 * offset would shift it by a day.
 */
export function formatBusinessDate(businessDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) {
    throw new TypeError(`Expected a YYYY-MM-DD business date, got "${businessDate}"`)
  }
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'UTC',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(`${businessDate}T00:00:00Z`))
}

const partsFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: OUTLET_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

/**
 * Which business day does this instant belong to?
 *
 * The mirror of `public.app_business_date(ts, cutover)`, and it must stay one:
 * shift the instant into Asia/Kolkata, subtract the outlet's cutover, take the
 * calendar date. A bill rung at 00:20 under an 04:00 cutover belongs to the
 * previous day, and the app and the database have to agree about that or a
 * check-in lands on a day nobody is looking at.
 *
 * The database remains the authority: this resolves the date a write is
 * *labelled* with, and the `validate_business_date` trigger checks it.
 *
 * @param cutover the outlet's `business_day_cutover`, as `HH:MM` or `HH:MM:SS`
 */
export function resolveBusinessDate(instant: Date | string, cutover: string): string {
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(cutover)
  if (!match) {
    throw new TypeError(`Expected a HH:MM or HH:MM:SS cutover, got "${cutover}"`)
  }

  const parts = Object.fromEntries(
    partsFormat.formatToParts(toDate(instant)).map((part) => [part.type, part.value]),
  ) as Record<string, string>

  // Hour 24 is how some engines spell midnight in a 24-hour clock.
  const hour = Number(parts.hour) % 24

  const wallClockMs = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    hour,
    Number(parts.minute),
    Number(parts.second),
  )

  const cutoverMs = (Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3] ?? 0)) * 1000

  const shifted = new Date(wallClockMs - cutoverMs)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`
}

/**
 * A moment in one trading session, used to show a cutover working.
 *
 * The times are a typical Shawarmania day — the counter opens late morning and
 * the last bill is rung after midnight — not any particular outlet's hours.
 * They are fixed on purpose: this exists to demonstrate the rule, and a
 * demonstration that moves with the data demonstrates nothing.
 */
export const TRADING_SESSION: readonly TradingMoment[] = [
  { label: 'Prep starts', at: '11:00', afterMidnight: false },
  { label: 'Afternoon', at: '16:00', afterMidnight: false },
  { label: 'Evening rush', at: '20:00', afterMidnight: false },
  { label: 'Last bill', at: '00:30', afterMidnight: true },
]

/**
 * The hours a counter is reliably shut.
 *
 * A cutover anywhere in this band leaves a whole trading session on one
 * business day — asserted minute by minute in `datetime.test.ts`, so the
 * guidance shown on screen cannot drift away from the arithmetic.
 */
export const QUIET_HOURS_FROM = '01:00'
export const QUIET_HOURS_UNTIL = '06:00'

export interface TradingMoment {
  /** What is happening, in the counter's words. */
  label: string
  /** Wall-clock time in Asia/Kolkata, `HH:MM`. */
  at: string
  /** True when this falls after midnight, on the calendar day after opening. */
  afterMidnight: boolean
}

/** Which business day a moment lands on, relative to the day the shop opened. */
export type CutoverFiling = 'the day itself' | 'the day before' | 'the next day'

export interface CutoverSample extends TradingMoment {
  filedUnder: CutoverFiling
}

export interface CutoverAdvice {
  /** The cutover itself, normalised to `HH:MM`. */
  startsAt: string
  /** The last minute the same business day still covers, `HH:MM`. */
  endsAt: string
  /** False only for a midnight cutover, where the window closes the same day. */
  endsNextDay: boolean
  /** `TRADING_SESSION`, each moment resolved against this cutover. */
  session: CutoverSample[]
  /** True when that one session lands on more than one business day. */
  splits: boolean
}

// Any mid-month day works. The answer is a property of the cutover, not of the
// date, and mid-month keeps the ±1 day shift away from a month boundary while
// reading a diff.
const CUTOVER_REFERENCE_DAY = '2026-05-12'

/**
 * What a proposed cutover would actually do, shown rather than described.
 *
 * The cutover is the seam between two business days, not the outlet's opening
 * time, and the two readings are easy to confuse — a real outlet was set up
 * with its opening time here. So this resolves a whole trading session against
 * the proposed value: if the morning's prep and that night's last bill land on
 * different business days, the value is wrong and the screen can say so with
 * the arithmetic in view.
 *
 * @param cutover a candidate `business_day_cutover`, as `HH:MM` or `HH:MM:SS`
 */
export function describeCutover(cutover: string): CutoverAdvice {
  const match = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(cutover)
  if (!match) {
    throw new TypeError(`Expected a HH:MM or HH:MM:SS cutover, got "${cutover}"`)
  }

  const pad = (value: number) => String(value).padStart(2, '0')
  const startsAt = `${match[1]}:${match[2]}`
  const minutes = Number(match[1]) * 60 + Number(match[2])
  const lastMinute = (minutes + 1439) % 1440
  const endsAt = `${pad(Math.floor(lastMinute / 60))}:${pad(lastMinute % 60)}`

  const session = TRADING_SESSION.map((moment) => {
    const day = moment.afterMidnight
      ? shiftBusinessDate(CUTOVER_REFERENCE_DAY, 1)
      : CUTOVER_REFERENCE_DAY
    // +05:30 is Asia/Kolkata year round — India keeps no daylight saving — so
    // the wall-clock times above round-trip exactly through the resolver.
    const filedOn = resolveBusinessDate(`${day}T${moment.at}:00+05:30`, startsAt)
    const filedUnder: CutoverFiling =
      filedOn === CUTOVER_REFERENCE_DAY
        ? 'the day itself'
        : filedOn < CUTOVER_REFERENCE_DAY
          ? 'the day before'
          : 'the next day'
    return { ...moment, filedUnder }
  })

  return {
    startsAt,
    endsAt,
    endsNextDay: minutes !== 0,
    session,
    splits: session.some((moment) => moment.filedUnder !== 'the day itself'),
  }
}

/**
 * A wall-clock time on a business day, as an instant.
 *
 * The subtlety is that a business day is not a calendar day. Times before the
 * outlet's cutover belong to the NEXT calendar date — 01:30 on business day X
 * under an 04:00 cutover happened on calendar day X+1 — and the database
 * validates exactly this arithmetic, so the app has to perform exactly this
 * arithmetic.
 *
 * Used for two things that are the same sum: where an admin's typed-in time
 * lands, and when an outlet's arrival deadline falls. A deadline of 13:00
 * against an 04:00 cutover falls on the business date's own calendar day, which
 * is why a 01:30 arrival — filed under the previous business date — reads as
 * late rather than as very early.
 *
 * @param time `HH:MM` or `HH:MM:SS` in the outlet's reckoning (OUTLET_TIME_ZONE)
 */
export function instantOnBusinessDay(businessDate: string, time: string, cutover: string): string {
  const seconds = timeToSeconds(time)
  const calendarDate =
    seconds < timeToSeconds(cutover) ? shiftBusinessDate(businessDate, 1) : businessDate
  const pad = (value: number) => String(value).padStart(2, '0')
  const clock = `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`
  // Asia/Kolkata keeps no daylight saving, so its offset is a constant rather
  // than something that has to be resolved per date.
  return new Date(`${calendarDate}T${clock}+05:30`).toISOString()
}

function timeToSeconds(value: string): number {
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value)
  if (!match) {
    throw new TypeError(`Expected a HH:MM or HH:MM:SS time, got "${value}"`)
  }
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3] ?? 0)
}

/** `2026-07-25` shifted by whole days, staying a calendar label throughout. */
export function shiftBusinessDate(businessDate: string, days: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) {
    throw new TypeError(`Expected a YYYY-MM-DD business date, got "${businessDate}"`)
  }
  const shifted = new Date(`${businessDate}T00:00:00Z`)
  shifted.setUTCDate(shifted.getUTCDate() + days)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`
}

/**
 * How far back a platform calendar reaches: a year before the outlet's today,
 * to the first of that month. Steps may still reach further one day at a time —
 * this is a floor on the picker, which needs one, not on the history.
 */
export function earliestOffered(today: string): string {
  const [year, month] = today.split('-')
  return `${Number(year) - 1}-${month}-01`
}

function toDate(instant: Date | string): Date {
  const date = instant instanceof Date ? instant : new Date(instant)
  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`Expected a valid date, got "${String(instant)}"`)
  }
  return date
}
