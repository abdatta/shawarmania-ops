import type { AnalyticsDay, AnalyticsSnapshot } from './sales-analytics-types'

export function shiftDate(date: string, days: number): string {
  const next = new Date(`${date}T12:00:00Z`)
  next.setUTCDate(next.getUTCDate() + days)
  return next.toISOString().slice(0, 10)
}
export function periodDays(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1
}

export function validAnalyticsDate(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    value >= '0001-01-01' &&
    Number.isFinite(Date.parse(value)) &&
    new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value
  )
}

export function analyticsRevenueDays(
  data: AnalyticsSnapshot,
  includeDelivery: boolean,
): AnalyticsDay[] {
  return data.days.map((day) => ({
    ...day,
    revenue:
      day.revenue +
      (includeDelivery
        ? data.delivery.filter((d) => d.date === day.date).reduce((sum, d) => sum + d.revenue, 0)
        : 0),
  }))
}
export function growth(current: number, previous: number): string {
  if (!previous) return current ? 'New sales · no baseline' : 'No sales in either period'
  const change = ((current - previous) / previous) * 100
  return `${change > 0 ? '+' : ''}${change.toFixed(1)}% vs previous period`
}
export function totalDays(days: AnalyticsDay[]) {
  return days.reduce(
    (sum, day) => ({
      revenue: sum.revenue + day.revenue,
      orders: sum.orders + day.orders,
      units: sum.units + day.units,
      discounts: sum.discounts + day.discounts,
    }),
    { revenue: 0, orders: 0, units: 0, discounts: 0 },
  )
}
export function bucketDays(days: AnalyticsDay[], grain: 'day' | 'week' | 'month'): AnalyticsDay[] {
  const buckets = new Map<string, AnalyticsDay>()
  for (const day of days) {
    const weekday = new Date(`${day.date}T12:00:00Z`).getUTCDay()
    const date =
      grain === 'month'
        ? `${day.date.slice(0, 7)}-01`
        : grain === 'week'
          ? shiftDate(day.date, -(weekday + 6) % 7)
          : day.date
    const previous = buckets.get(date) ?? { date, revenue: 0, orders: 0, units: 0, discounts: 0 }
    buckets.set(date, {
      date,
      revenue: previous.revenue + day.revenue,
      orders: previous.orders + day.orders,
      units: previous.units + day.units,
      discounts: previous.discounts + day.discounts,
    })
  }
  return [...buckets.values()]
}
export type SalesMetric = 'revenue' | 'orders' | 'aov'
export function salesValue(revenue: number, orders: number, metric: SalesMetric): number | null {
  return metric === 'orders'
    ? orders
    : metric === 'aov'
      ? orders
        ? Math.round(revenue / orders)
        : null
      : revenue
}
export function csvCell(value: string | number): string {
  const text = String(value)
  // Spreadsheet formulas must not execute from names typed into the menu.
  return `"${(/^\s*[=+@\-\t\r]/.test(text) ? "'" : '') + text.replaceAll('"', '""')}"`
}

export interface PeriodDirection {
  direction: 'up' | 'down' | 'flat'
  /** The fitted line's step per period, as a share of the average period; null when flat. */
  rate: number | null
}
/**
 * Where three or four equal periods are heading, oldest value first: the slope
 * of a least-squares line through them, as a share of their average. It only
 * calls a direction when the line moves at least 3% a period **and** its whole
 * rise or fall is larger than the periods' own wobble about it, so one odd week
 * among four does not read as a trend.
 */
export function periodDirection(values: number[]): PeriodDirection {
  const n = values.length
  const mean = n ? values.reduce((sum, v) => sum + v, 0) / n : 0
  if (n < 3 || mean <= 0) return { direction: 'flat', rate: null }
  const middle = (n - 1) / 2
  let covariance = 0
  let spread = 0
  values.forEach((v, x) => {
    covariance += (x - middle) * (v - mean)
    spread += (x - middle) ** 2
  })
  const slope = covariance / spread
  const residual = values.reduce((sum, v, x) => sum + (v - (mean + slope * (x - middle))) ** 2, 0)
  const wobble = Math.sqrt(residual / (n - 2))
  const rate = slope / mean
  if (Math.abs(rate) < 0.03 || Math.abs(slope) * (n - 1) <= wobble)
    return { direction: 'flat', rate: null }
  return { direction: slope > 0 ? 'up' : 'down', rate }
}

export interface UsualRange {
  low: number
  high: number
  position: 'above' | 'about' | 'below'
}
/**
 * What the earlier periods make "usual": their average, give or take their
 * standard deviation (never less than 5% of the average, so identical periods
 * still leave room for an ordinary one), and where the current period falls.
 */
export function usualRange(current: number, earlier: number[]): UsualRange | null {
  if (earlier.length < 2) return null
  const mean = earlier.reduce((sum, v) => sum + v, 0) / earlier.length
  const deviation = Math.sqrt(
    earlier.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (earlier.length - 1),
  )
  const band = Math.max(deviation, mean * 0.05)
  const low = Math.max(0, mean - band)
  const high = mean + band
  return {
    low,
    high,
    position: current > high ? 'above' : current < low ? 'below' : 'about',
  }
}

/** The period a trend is "per": a day, a week, a month, or the range's own length. */
export function periodUnit(days: number): string {
  return days === 1 ? 'day' : days === 7 ? 'wk' : days >= 28 && days <= 31 ? 'mo' : `${days}d`
}
