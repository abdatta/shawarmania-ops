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
export interface OverviewAdapter {
  sales(outletId: string, date: string): Promise<OverviewSales>
  revenue(outletId: string, from: string, through: string): Promise<OverviewRevenue>
  expenses(outletId: string, from: string, through: string): Promise<number>
  drawer(outletId: string): Promise<OverviewDrawer>
  tablets(outletId: string): Promise<readonly (string | null)[]>
}
