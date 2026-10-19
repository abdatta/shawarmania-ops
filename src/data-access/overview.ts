import type { ProRataReading } from '@/domain/fixed-costs'

/** Small, independently requested Home readings. Money is always integer paise. */
export interface OverviewSales {
  cashPaise: number
  upiPaise: number
}
export interface OverviewRevenue {
  revenuePaise: number
  hasSales: boolean
  provisional: boolean
  incomplete: boolean
}
export interface OverviewDrawer {
  expectedPaise: number | null
  leftPaise: number | null
  spentPaise: number
}
/**
 * Today's revenue on the one definition (revenue-reads-the-same-everywhere):
 * counter tenders and delivery sales imported for today, before commission.
 */
export interface OverviewToday {
  cashPaise: number
  upiPaise: number
  deliveryPaise: number
  /**
   * Today's open, unpaid orders, summed (billing-day-at-a-glance, design D1).
   * Not revenue: a paid order still being cooked is already in the three above.
   */
  openPaise: number
}
/** The window a month is compared with, cut at the time it is now where it ends today. */
export interface OverviewComparison {
  from: string
  through: string
  /** The instant the window's last date was cut at; null when it counts whole. */
  cutAt: string | null
  revenuePaise: number
  hasSales: boolean
}
/** The month to date, decided by the server's clock and the outlet's cutover. */
export interface OverviewMonth {
  month: string
  from: string
  through: string
  revenuePaise: number
  cashPaise: number
  upiPaise: number
  deliveryPaise: number
  commissionPaise: number
  waitingDays: number
  recordedExpensesPaise: number
  /** Recorded expenses plus commission. */
  expensesPaise: number
  /** Null where nothing was sold in the month. */
  profitPaise: number | null
  hasSales: boolean
  previous: OverviewComparison
  /**
   * This month's fixed costs read at today (fixed-costs-are-spread-over-the-month):
   * what Pro-rata P&L charges. Absent from a read that predates it, and null
   * where the outlet has no fixed cost this month.
   */
  fixedCosts?: ProRataReading | null
}
export interface OverviewAdapter {
  sales(outletId: string, date: string): Promise<OverviewSales>
  revenue(outletId: string, from: string, through: string): Promise<OverviewRevenue>
  expenses(outletId: string, from: string, through: string): Promise<number>
  drawer(outletId: string): Promise<OverviewDrawer>
  tablets(outletId: string): Promise<readonly (string | null)[]>
  /** One Revenue's today: no date is sent, the server decides it. */
  today(outletId: string): Promise<OverviewToday>
  /** One Revenue's month to date and its comparison, in one read. */
  month(outletId: string): Promise<OverviewMonth>
}
