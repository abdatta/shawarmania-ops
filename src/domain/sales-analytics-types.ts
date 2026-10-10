export interface AnalyticsDay {
  date: string
  revenue: number
  orders: number
  units: number
  discounts: number
}
export interface AnalyticsItem {
  key: string
  name: string
  category: string
  units: number
  revenue: number
  discounts: number
  orders: number
  previousUnits: number
  /** Units in every compared window, current first. */
  periodUnits: number[]
  active: boolean
  available: boolean
  highlighted: boolean
}
export interface AnalyticsCategory {
  name: string
  units: number
  revenue: number
  previousUnits: number
  previousRevenue: number
  /** Units in every compared window, current first. */
  periodUnits: number[]
}
/** What the Items chart draws: every dish, one dish, or one captured category. */
export type AnalyticsSubject =
  { kind: 'all' } | { kind: 'item'; key: string } | { kind: 'category'; name: string }
/**
 * Daily dish units and dish revenue from `from`, one value per day of every
 * window; and Kolkata clock-hour totals, 24 per window, current window first.
 */
export interface AnalyticsSeries {
  from: string
  units: number[]
  revenue: number[]
  hourUnits: number[]
  hourRevenue: number[]
}
export interface AnalyticsSnapshot {
  categories: AnalyticsCategory[]
  days: AnalyticsDay[]
  items: AnalyticsItem[]
  delivery: { date: string; channel: string; revenue: number; provisional: boolean }[]
  hours: { period: number; hour: number; orders: number; revenue: number }[]
}
