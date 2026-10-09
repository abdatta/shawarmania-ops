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
