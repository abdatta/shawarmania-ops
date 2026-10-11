import type { AnalyticsDay, AnalyticsSeries } from '@/domain/sales-analytics-types'
import { bucketDays, periodDays, shiftDate, totalDays } from '@/domain/sales-analytics'
import { rangeLabel, type ChartSeries } from './analytics-chart'
import { businessDayEnd, instantOnBusinessDay, resolveBusinessDate } from '@/domain/datetime'

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

export interface TrendClock {
  now: number
  cutover: string
}

/** Clock-based presentation metadata; numeric values never change. */
export function trendView(
  series: ChartSeries[],
  axis: string[],
  from: string,
  to: string,
  grain: 'hour' | 'day' | 'week',
  clock?: TrendClock,
): { series: ChartSeries[]; axis: string[] } {
  const classified: ChartSeries[] = series.map((s) => ({
    ...s,
    points: s.points.map((point) => {
      if (!clock || !point.interval || (grain === 'hour' && from !== to)) return point
      const start = Date.parse(point.interval.start),
        end = Date.parse(point.interval.end)
      const state = end <= clock.now ? 'completed' : start <= clock.now ? 'ongoing' : 'future'
      return { ...point, state }
    }),
  }))
  if (grain !== 'hour') return { series: classified, axis }
  if (!clock || from !== to) return activeHours(classified, axis)
  const [hours, minutes, seconds = '0'] = clock.cutover.split(':')
  // Put a fractional cutoff's two-part clock-hour aggregate last: it includes
  // the next calendar morning's final segment and completes at business-day end.
  const firstHour =
    Math.ceil((Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds)) / 3600) % 24
  const order = Array.from({ length: 24 }, (_, i) => (firstHour + i) % 24)
  const ordered = classified.map((s) => ({ ...s, points: order.map((hour) => s.points[hour]!) }))
  const orderedAxis = order.map((hour) => axis[hour]!)
  if (to !== resolveBusinessDate(new Date(clock.now), clock.cutover))
    return activeHours(ordered, orderedAxis)
  const firstActive = order.findIndex((_, i) => ordered.some((s) => (s.points[i]?.value ?? 0) > 0))
  const firstUnfinished = ordered[0]?.points.findIndex((p) => p.state !== 'completed') ?? -1
  const first =
    firstActive < 0
      ? 0
      : Math.min(Math.max(0, firstActive - 1), firstUnfinished < 0 ? 23 : firstUnfinished)
  return {
    series: ordered.map((s) => ({ ...s, points: s.points.slice(first) })),
    axis: orderedAxis.slice(first),
  }
}

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
  cutover,
}: {
  days: AnalyticsDay[]
  from: string
  to: string
  periods: number
  grain: 'day' | 'week'
  value: (bucket: AnalyticsDay) => number | null
  cutover?: string | undefined
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
        ...(cutover
          ? {
              interval: {
                start: instantOnBusinessDay(shiftDate(first, -period * span), cutover, cutover),
                end: businessDayEnd(shiftDate(last, -period * span), cutover),
              },
            }
          : {}),
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
  cutover?: string,
): ChartSeries[] {
  return periods.map((p, period) => ({
    label: p.label,
    points: HOURS.map((label, hour) => {
      const split =
        !!cutover && Number(cutover.slice(0, 2)) === hour && /[1-9]/.test(cutover.slice(3))
      const start = cutover ? instantOnBusinessDay(p.first, split ? cutover : label, cutover) : ''
      return {
        label: `${p.label} · ${label}${split && p.first === p.last ? ' · cutoff hour (two parts)' : ''}`,
        value: value(period, hour),
        ...(cutover && p.first === p.last
          ? {
              interval: {
                start,
                end: split
                  ? businessDayEnd(p.first, cutover)
                  : new Date(Date.parse(start) + 3_600_000).toISOString(),
              },
            }
          : {}),
      }
    }),
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
