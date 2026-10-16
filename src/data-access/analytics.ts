import type {
  AnalyticsSeries,
  AnalyticsSnapshot,
  AnalyticsSubject,
} from '@/domain/sales-analytics-types'
import { validAnalyticsDate } from '@/domain/sales-analytics'
export type {
  AnalyticsCategory,
  AnalyticsDay,
  AnalyticsItem,
  AnalyticsSeries,
  AnalyticsSnapshot,
  AnalyticsSubject,
  AnalyticsTotal,
} from '@/domain/sales-analytics-types'

export interface AnalyticsAdapter {
  read(
    outletId: string,
    from: string,
    to: string,
    options?: {
      view?: 'items' | 'sales'
      periods?: number
      /**
       * One Revenue's Sales read only: how earlier windows align, and whether
       * their last date is cut at the time it is now. The server decides the
       * cut; the client only asks for it.
       */
      align?: 'equal' | 'month'
      cut?: boolean
    },
  ): Promise<AnalyticsSnapshot>
  /** One subject's daily units and revenue across `periods` equal windows ending `to`. */
  series(
    outletId: string,
    from: string,
    to: string,
    periods: number,
    subject: AnalyticsSubject,
    /** One Revenue only: cut earlier windows at the time it is now. */
    options?: { cut?: boolean },
  ): Promise<AnalyticsSeries>
}

/** Fail closed on a malformed aggregate rather than displaying invented zeroes. */
export function analyticsSnapshot(value: unknown): AnalyticsSnapshot {
  if (!value || typeof value !== 'object') throw new Error('Invalid analytics response')
  const record = value as Record<string, unknown>
  const fields: Record<
    string,
    { strings: string[]; numbers: string[]; booleans: string[]; counts?: string[] }
  > = {
    categories: {
      strings: ['name'],
      numbers: ['revenue', 'units', 'previousRevenue', 'previousUnits'],
      booleans: [],
      counts: ['periodUnits', 'periodRevenue'],
    },
    days: { strings: ['date'], numbers: ['revenue', 'orders', 'units', 'discounts'], booleans: [] },
    items: {
      strings: ['key', 'name', 'category'],
      numbers: ['units', 'revenue', 'discounts', 'orders', 'previousUnits', 'previousRevenue'],
      booleans: ['active', 'available', 'highlighted'],
      counts: ['periodUnits', 'periodRevenue'],
    },
    delivery: { strings: ['date', 'channel'], numbers: ['revenue'], booleans: ['provisional'] },
    hours: { strings: [], numbers: ['period', 'hour', 'orders', 'revenue'], booleans: [] },
  }
  for (const [key, spec] of Object.entries(fields)) {
    const rows = record[key]
    if (!Array.isArray(rows)) throw new Error('Invalid analytics response')
    for (const row of rows) {
      if (
        !row ||
        typeof row !== 'object' ||
        (spec.counts ?? []).some(
          (k) =>
            !Array.isArray(row[k]) ||
            row[k].length > 4 ||
            row[k].some((n: unknown) => !Number.isSafeInteger(n) || (n as number) < 0),
        ) ||
        spec.strings.some((k) => typeof row[k] !== 'string') ||
        spec.booleans.some((k) => typeof row[k] !== 'boolean') ||
        spec.numbers.some((k) => !Number.isSafeInteger(row[k]) || row[k] < 0)
      )
        throw new Error('Invalid analytics response')
    }
  }
  // One Revenue's read adds each window's totals and the cut; fail closed on
  // those too, and leave them absent when the old read is asked.
  const { totals, cutAt } = record
  if (totals !== undefined) {
    if (
      !Array.isArray(totals) ||
      totals.length > 4 ||
      totals.some(
        (t) =>
          !t ||
          typeof t !== 'object' ||
          ['period', 'counter', 'delivery', 'orders'].some(
            (k) => !Number.isSafeInteger((t as Record<string, unknown>)[k]),
          ),
      ) ||
      (cutAt !== null && cutAt !== undefined && typeof cutAt !== 'string')
    )
      throw new Error('Invalid analytics response')
  }
  return value as AnalyticsSnapshot
}

/** The same fail-closed rule for a chart series: a valid date, equal day and hour arrays. */
export function analyticsSeries(value: unknown): AnalyticsSeries {
  if (!value || typeof value !== 'object') throw new Error('Invalid analytics response')
  const { from, units, revenue, hourUnits, hourRevenue } = value as Record<string, unknown>
  const counts = (rows: unknown): rows is number[] =>
    Array.isArray(rows) && rows.every((n) => Number.isSafeInteger(n) && (n as number) >= 0)
  if (
    typeof from !== 'string' ||
    !validAnalyticsDate(from) ||
    !counts(units) ||
    !counts(revenue) ||
    units.length !== revenue.length ||
    units.length > 4 * 92 ||
    !counts(hourUnits) ||
    !counts(hourRevenue) ||
    hourUnits.length !== hourRevenue.length ||
    hourUnits.length % 24 !== 0 ||
    hourUnits.length > 4 * 24
  )
    throw new Error('Invalid analytics response')
  const { totals, cutAt } = value as Record<string, unknown>
  const cutTotals =
    Array.isArray(totals) &&
    totals.length <= 4 &&
    totals.every(
      (t) =>
        !!t &&
        typeof t === 'object' &&
        Number.isSafeInteger((t as Record<string, unknown>).units) &&
        Number.isSafeInteger((t as Record<string, unknown>).revenue),
    )
      ? (totals as { units: number; revenue: number }[])
      : undefined
  return {
    from,
    units,
    revenue,
    hourUnits,
    hourRevenue,
    ...(cutTotals ? { totals: cutTotals, cutAt: typeof cutAt === 'string' ? cutAt : null } : {}),
  }
}
