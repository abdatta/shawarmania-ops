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
/** Items measures dishes, not bills; its hours are the bill's order time, as on Sales. */
export const ITEM_GRAINS: [string, string][] = [
  ['hour', 'Hour'],
  ['day', 'Day'],
  ['week', 'Week'],
]
export const ITEM_METRICS: [string, string][] = [
  ['units', 'Items'],
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

export const HOURS = Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, '0')}:00`)

/** One series per window over the 24 Kolkata clock hours, labelled with its dates. */
export function hourTrend(
  periods: TrendPeriod[],
  value: (period: number, hour: number) => number | null,
): ChartSeries[] {
  return periods.map((p, period) => ({
    label: p.label,
    points: HOURS.map((label, hour) => ({
      label: `${p.label} · ${label}`,
      value: value(period, hour),
    })),
  }))
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

/**
 * The trading part of a clock-hour chart: from one hour before the first hour
 * any compared period sold anything to one hour after the last, keeping the
 * quiet hours between. Read from the data, so a late night widens it; with
 * nothing sold every hour stays. Trimmed hours are zero in every period, so
 * totals are unchanged.
 */
export function activeHours(series: ChartSeries[], axis: string[]) {
  const active = axis
    .map((_, hour) => hour)
    .filter((hour) => series.some((s) => (s.points[hour]?.value ?? 0) > 0))
  if (!active.length) return { series, axis }
  const first = Math.max(0, active[0]! - 1)
  const last = Math.min(axis.length - 1, active.at(-1)! + 1)
  return {
    series: series.map((s) => ({ ...s, points: s.points.slice(first, last + 1) })),
    axis: axis.slice(first, last + 1),
  }
}
