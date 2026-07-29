import { formatBusinessDate, shiftBusinessDate } from '@/domain'

import type { InsightsPeriod } from '@/data-access/adapters'

/**
 * The periods the owner surfaces offer.
 *
 * Deliberately a short list of named ranges rather than two date pickers. The
 * questions this product is asked are "how was today", "how was the week" and
 * "how was the month"; an arbitrary range is a control that costs two taps
 * every time to answer a question nobody has asked yet. #13 can add one when
 * somebody does.
 *
 * Every range is in **business dates**, resolved from the outlet's own cutover
 * by the caller — never derived from a timestamp here.
 */

export type PeriodKey = 'today' | 'week' | 'month'

export const PERIOD_LABELS: Record<PeriodKey, string> = {
  today: 'Today',
  week: 'Last 7 days',
  month: 'Last 30 days',
}

const PERIOD_DAYS: Record<PeriodKey, number> = {
  today: 1,
  week: 7,
  month: 30,
}

export const PERIOD_KEYS: PeriodKey[] = ['today', 'week', 'month']

/** The inclusive range a key means, ending on the given business date. */
export function periodFor(key: PeriodKey, today: string): InsightsPeriod {
  return { from: shiftBusinessDate(today, -(PERIOD_DAYS[key] - 1)), to: today }
}

/** How a period reads on screen, so a figure is never shown without its range. */
export function describePeriod(period: InsightsPeriod): string {
  return period.from === period.to
    ? formatBusinessDate(period.to)
    : `${formatBusinessDate(period.from)} – ${formatBusinessDate(period.to)}`
}

export function isPeriodKey(value: string): value is PeriodKey {
  return PERIOD_KEYS.includes(value as PeriodKey)
}
