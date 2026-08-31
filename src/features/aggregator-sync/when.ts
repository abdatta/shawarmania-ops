/**
 * When something happened, in the outlet's own day.
 *
 * **Asia/Kolkata, always, and that is the bug this file exists to have fixed
 * once.** The health line formatted its timestamp in the *device's* timezone
 * while the run history beneath it formatted the same instants in Kolkata, so
 * the two disagreed about what day a run belonged to for anybody reading on a
 * phone set to another zone. Every timestamp on this surface is about a trading
 * day, and a trading day is the shop's, not the reader's.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * How often the readers run, when nothing has told us otherwise.
 *
 * **A fallback, not the answer.** Since #48 the runner parses its own workflow
 * cron and reports the cadence with every run, so the surface reads what the
 * schedule actually is rather than what this file remembers. This number is
 * used only where nothing has reported yet — an outlet whose reader has never
 * run, or one still on a runner that predates the reporting.
 *
 * It said "twice a day" for weeks after the readers moved to four, which is why
 * it stopped being the source: the cadence was prose in this repository about
 * crons in another one, and prose does not fail a build.
 */
export const READS_PER_DAY_FALLBACK = 4

const TIMES = ['', 'once', 'twice', 'three times', 'four times', 'five times', 'six times']

/**
 * The cadence as the owner would say it: `four times a day`.
 *
 * Words up to six because that is how anybody says these, and digits past it
 * because "seventeen times a day" is harder to read than "17 times a day" and
 * nobody is scheduling that on purpose anyway.
 */
export function readsPerDayPhrase(readsPerDay: number | null): string {
  const times = readsPerDay ?? READS_PER_DAY_FALLBACK
  return `${TIMES[times] ?? `${times} times`} a day`
}

/**
 * How long a successful read stays useless to repeat, in hours.
 *
 * **Derived from the cadence rather than stated beside it.** It was a constant
 * six, which was one read interval while the readers ran four times a day and
 * silently became half an interval when they did not. The rule it means to
 * express is "there is nothing new until the next scheduled read", so it says
 * that: one interval.
 */
export function readAgainAfterHours(readsPerDay: number | null): number {
  return 24 / (readsPerDay ?? READS_PER_DAY_FALLBACK)
}

/** The Asia/Kolkata calendar day an instant falls on, as `YYYY-MM-DD`. */
export function kolkataDay(instant: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(instant))
}

/** The time of day, in the outlet's own zone. */
export function kolkataClock(instant: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(instant))
}

/**
 * A business date read as a date, never through the device's timezone. Splitting
 * the string rather than parsing it is what stops a date with no zone sliding a
 * day westward.
 */
export function shortDate(businessDate: string): string {
  const [, month, day] = businessDate.split('-').map(Number)
  return `${day} ${MONTHS[(month ?? 1) - 1]}`
}

/** Today's Kolkata day, and the one before it, for naming a day in words. */
function kolkataDayOffset(daysAgo: number): string {
  return kolkataDay(new Date(Date.now() - daysAgo * 86_400_000).toISOString())
}

/**
 * A day named in words where a word is what a reader wants: `Today`,
 * `Yesterday`, otherwise the date.
 *
 * A date is a thing you have to convert before it answers "is this current?".
 * Today and Yesterday answer it directly, and everything older is genuinely
 * being read as a date, so it stays one.
 */
export function dayInWords(day: string): string {
  if (day === kolkataDayOffset(0)) return 'Today'
  if (day === kolkataDayOffset(1)) return 'Yesterday'
  return shortDate(day)
}

/** When a run happened, as a reader would say it: `Today, 6:13 am`. */
export function whenItRan(instant: string): string {
  return `${dayInWords(kolkataDay(instant))}, ${kolkataClock(instant)}`
}
