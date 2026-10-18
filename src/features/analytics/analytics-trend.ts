import type { AnalyticsDay, AnalyticsSeries } from '@/domain/sales-analytics-types'
import { bucketDays, periodDays, shiftDate, totalDays } from '@/domain/sales-analytics'
import { metricText, rangeLabel, type ChartMetric, type ChartSeries } from './analytics-chart'
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
  /**
   * One Revenue (owner, 2026-10-16): a current one-day hour chart ends one hour
   * after the last hour any compared day sold in, or at the ongoing hour if that
   * is later, instead of running on through the closed hours to the cutover.
   */
  trimTail = false,
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
  let end = 24
  if (trimTail) {
    const active = (i: number) => ordered.some((s) => (s.points[i]?.value ?? 0) > 0)
    let lastActive = -1
    for (let i = 23; i >= 0; i -= 1)
      if (active(i)) {
        lastActive = i
        break
      }
    const ongoing = ordered[0]?.points.findIndex((p) => p.state === 'ongoing') ?? -1
    end = Math.min(24, Math.max(lastActive + 2, ongoing + 1, first + 1))
  }
  return {
    series: ordered.map((s) => ({ ...s, points: s.points.slice(first, end) })),
    axis: orderedAxis.slice(first, end),
  }
}

/**
 * One Revenue's line under a trend's headline (owner, 2026-10-16): what the
 * earlier periods came to, each with its dates, and the time of day they run to
 * where they were cut. `vs ₹1,42,469 (9–15 Oct, until 8:58 am)`; with several,
 * `vs 448 (1–16 Sept) · 435 (1–16 Aug), each until 8:38 am`. With no earlier
 * period, the current period's dates.
 */
export function comparedLine({
  periods,
  totals,
  metric,
  cut,
  cutAt,
}: {
  periods: readonly { label: string }[]
  totals: readonly (number | null)[]
  metric: ChartMetric
  /** Whether each period's last date was cut, current first. */
  cut: readonly boolean[]
  cutAt: string | null | undefined
}): string {
  const earlier = periods.slice(1)
  if (earlier.length === 0) return periods[0]?.label ?? ''
  const time =
    cutAt && cut.slice(1).some(Boolean)
      ? new Intl.DateTimeFormat('en-IN', {
          hour: 'numeric',
          minute: '2-digit',
          timeZone: 'Asia/Kolkata',
        }).format(new Date(cutAt))
      : null
  // Whole rupees, dropped rather than rounded, as Overview and the headline show them.
  const shown = (value: number | null) =>
    metric === 'revenue' && value !== null ? value - (value % 100) : value
  if (earlier.length === 1)
    return `vs ${metricText(shown(totals[1] ?? null), metric)} (${earlier[0]!.label}${time ? `, until ${time}` : ''})`
  return `vs ${earlier
    .map((p, index) => `${metricText(totals[index + 1] ?? null, metric, true)} (${p.label})`)
    .join(' · ')}${time ? `, each until ${time}` : ''}`
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
  bills = false,
}: {
  days: AnalyticsDay[]
  from: string
  to: string
  periods: number
  grain: 'day' | 'week'
  value: (bucket: AnalyticsDay) => number | null
  cutover?: string | undefined
  /** AOV: each point carries its bucket's revenue and bills, for a running average. */
  bills?: boolean
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
        ...(bills ? { bills: { revenue: bucket.revenue, orders: bucket.orders } } : {}),
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

/**
 * `periodTrend` over windows chosen by the caller (revenue-reads-the-same-everywhere,
 * design D7): Month's same dates in earlier months, which differ in length.
 * Earlier windows align to the current one by elapsed day, as before; a date an
 * earlier window does not reach is a gap, never a zero.
 */
export function alignedTrend({
  days,
  windows,
  grain,
  value,
  cutover,
  bills = false,
}: {
  days: AnalyticsDay[]
  windows: readonly { first: string; last: string }[]
  grain: 'day' | 'week'
  value: (bucket: AnalyticsDay) => number | null
  cutover?: string | undefined
  /** AOV: each point carries its bucket's revenue and bills, for a running average. */
  bills?: boolean
}): { series: ChartSeries[]; axis: string[]; periods: TrendPeriod[] } {
  const { first: from, last: to } = windows[0]!
  const current = days.filter((d) => d.date >= from && d.date <= to)
  const baseBuckets = bucketDays(current, grain)
  const bucketRange = new Map<string, [string, string]>()
  for (const day of current) {
    const key = bucketDays([day], grain)[0]!.date
    const range = bucketRange.get(key)
    bucketRange.set(key, range ? [range[0], day.date] : [day.date, day.date])
  }
  // The date in window `w` that sits where `date` sits in the current window.
  const along = (w: { first: string }, date: string) =>
    shiftDate(w.first, periodDays(from, date) - 1)
  const built = windows.map((w) => {
    const inWindow = days.filter((d) => d.date >= w.first && d.date <= w.last)
    const buckets = new Map(
      bucketDays(
        inWindow.map((d) => ({ ...d, date: shiftDate(from, periodDays(w.first, d.date) - 1) })),
        grain,
      ).map((b) => [b.date, b]),
    )
    return { ...w, label: rangeLabel(w.first, w.last), total: totalDays(inWindow), buckets }
  })
  const series = built.map((w) => ({
    label: w.label,
    points: baseBuckets.map((b) => {
      const [first, last] = bucketRange.get(b.date)!
      const start = along(w, first)
      const end = along(w, last) > w.last ? w.last : along(w, last)
      const reached = start <= w.last
      const bucket = w.buckets.get(b.date) ?? {
        date: b.date,
        revenue: 0,
        orders: 0,
        units: 0,
        discounts: 0,
      }
      return {
        label: reached ? rangeLabel(start, end) : '—',
        value: reached ? value(bucket) : null,
        ...(bills && reached ? { bills: { revenue: bucket.revenue, orders: bucket.orders } } : {}),
        ...(cutover && reached
          ? {
              interval: {
                start: instantOnBusinessDay(start, cutover, cutover),
                end: businessDayEnd(end, cutover),
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
    periods: built.map(({ first, last, label, total }) => ({ first, last, label, total })),
  }
}

export const HOURS = Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, '0')}:00`)

/** One series per window over the 24 Kolkata clock hours, labelled with its dates. */
export function hourTrend(
  periods: TrendPeriod[],
  value: (period: number, hour: number) => number | null,
  cutover?: string,
  /** AOV: each hour's counter revenue and bills, for a running average. */
  bills?: (period: number, hour: number) => { revenue: number; orders: number },
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
        ...(bills ? { bills: bills(period, hour) } : {}),
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

/**
 * Each series as running figures, in the order the chart draws them: every
 * point is the period's total from its first bucket through that one. A point
 * carrying bills is a running AOV, total revenue over total bills, held across
 * a bucket without bills; a null with no bills is a window that does not reach
 * this far, and stays a gap. An interval that has not started has no figure
 * yet. Labels, intervals and states are kept.
 */
export function cumulativeSeries(series: ChartSeries[]): ChartSeries[] {
  return series.map((s) => {
    let total = 0
    let revenue = 0
    let orders = 0
    return {
      ...s,
      points: s.points.map((point) => {
        if (point.bills) {
          revenue += point.bills.revenue
          orders += point.bills.orders
        } else if (point.value === null) return point
        else total += point.value
        if (point.state === 'future') return { ...point, value: null }
        return {
          ...point,
          value: point.bills ? (orders ? Math.round(revenue / orders) : null) : total,
        }
      }),
    }
  })
}
