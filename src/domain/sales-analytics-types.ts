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
  active: boolean
  available: boolean
  highlighted: boolean
}
export interface AnalyticsSnapshot {
  categories: { name: string; revenue: number; units: number }[]
  days: AnalyticsDay[]
  items: AnalyticsItem[]
  delivery: { date: string; channel: string; revenue: number; provisional: boolean }[]
  hours: { period: number; hour: number; orders: number; revenue: number }[]
}
