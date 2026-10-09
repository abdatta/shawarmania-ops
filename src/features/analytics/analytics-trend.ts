import type { AnalyticsDay, AnalyticsSeries } from '@/domain/sales-analytics-types'
import { bucketDays, periodDays, shiftDate, totalDays } from '@/domain/sales-analytics'
import { rangeLabel, type ChartSeries } from './analytics-chart'

export const SALES_GRAINS: [string, string][] = [
  ['hour', 'Hour'],
  ['day', 'Day'],
  ['week', 'Week'],
]
export const SALES_METRICS: [string, string][] = [
  ['revenue', 'Revenue'],
  ['orders', 'Orders'],
  ['aov', 'AOV'],
]
/** Items reads dishes by day, so it groups by day or week and measures dishes, not bills. */
export const ITEM_GRAINS: [string, string][] = [
  ['day', 'Day'],
  ['week', 'Week'],
]
export const ITEM_METRICS: [string, string][] = [
  ['units', 'Units'],
  ['revenue', 'Revenue'],
]

export interface TrendPeriod {
  first: string
  last: string
  label: string
  total: Omit<AnalyticsDay, 'date'>
}

/**
 * The current window and up to three equal earlier ones, each grouped by day or
 * Monday week. Earlier windows are aligned to the current one by elapsed day,
 * and every point keeps the label of the dates it actually covers.
 */
export function periodTrend({
  days,
  from,
  to,
  periods,
  grain,
  value,
}: {
  days: AnalyticsDay[]
  from: string
  to: string
  periods: number
  grain: 'day' | 'week'
  value: (bucket: AnalyticsDay) => number | null
}): { series: ChartSeries[]; axis: string[]; periods: TrendPeriod[] } {
  const span = periodDays(from, to)
  const current = days.filter((d) => d.date >= from && d.date <= to)
  const baseBuckets = bucketDays(current, grain)
  // Each bucket's first and last selected date; boundary weeks are partial.
  const bucketRange = new Map<string, [string, string]>()
  for (const day of current) {
    const key = bucketDays([day], grain)[0]!.date
    const range = bucketRange.get(key)
    bucketRange.set(key, range ? [range[0], day.date] : [day.date, day.date])
  }
  const windows = Array.from({ length: periods }, (_, period) => {
    const first = shiftDate(from, -period * span)
    const last = shiftDate(to, -period * span)
    const inWindow = days.filter((d) => d.date >= first && d.date <= last)
    const buckets = new Map(
      bucketDays(
        inWindow.map((d) => ({ ...d, date: shiftDate(d.date, period * span) })),
        grain,
      ).map((b) => [b.date, b]),
    )
    return { first, last, label: rangeLabel(first, last), total: totalDays(inWindow), buckets }
  })
  const series = windows.map((w, period) => ({
    label: w.label,
    points: baseBuckets.map((b) => {
      const [first, last] = bucketRange.get(b.date)!
      const bucket = w.buckets.get(b.date) ?? {
        date: b.date,
        revenue: 0,
        orders: 0,
        units: 0,
        discounts: 0,
      }
      return {
        label: rangeLabel(shiftDate(first, -period * span), shiftDate(last, -period * span)),
        value: value(bucket),
      }
    }),
  }))
  const axis = baseBuckets.map((b) => rangeLabel(...bucketRange.get(b.date)!))
  return {
    series,
    axis,
    periods: windows.map(({ first, last, label, total }) => ({ first, last, label, total })),
  }
}

/** A dish or category series as days, so it groups exactly as Sales does. */
export function seriesDays(series: AnalyticsSeries): AnalyticsDay[] {
  return series.units.map((units, index) => ({
    date: shiftDate(series.from, index),
    units,
    revenue: series.revenue[index] ?? 0,
    orders: 0,
    discounts: 0,
  }))
}
