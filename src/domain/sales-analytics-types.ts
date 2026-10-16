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
  previousRevenue: number
  /** Units in every compared window, current first. */
  periodUnits: number[]
  /** Dish revenue in every compared window, current first. */
  periodRevenue: number[]
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
  /** Dish revenue in every compared window, current first. */
  periodRevenue: number[]
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
  /**
   * One Revenue's read only: each window's items and dish revenue for
   * comparison, current first, its last date cut at the time it is now where
   * the current window ends today.
   */
  totals?: { units: number; revenue: number }[]
  /** The instant the first earlier window was cut at, or null. */
  cutAt?: string | null
}
/**
 * One compared window's totals for comparison (revenue-reads-the-same-everywhere,
 * design D7): counter plus delivery revenue and counter orders, its last date
 * cut at the time it is now where the current window ends today.
 */
export interface AnalyticsTotal {
  period: number
  /** Counter bills' totals, paise. */
  counter: number
  /** Delivery sales before commission, paise. */
  delivery: number
  /** Counter bills. Delivery order counts are not stored. */
  orders: number
}
export interface AnalyticsSnapshot {
  categories: AnalyticsCategory[]
  days: AnalyticsDay[]
  items: AnalyticsItem[]
  delivery: { date: string; channel: string; revenue: number; provisional: boolean }[]
  hours: { period: number; hour: number; orders: number; revenue: number }[]
  /** Present only on One Revenue's read: each window's comparison totals, current first. */
  totals?: AnalyticsTotal[]
  /** The instant the first earlier window was cut at, or null when none was. */
  cutAt?: string | null
}
