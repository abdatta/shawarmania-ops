import type { SupabaseClient } from '@supabase/supabase-js'
import { readProRata } from '@/domain/fixed-costs'
import type { Database } from '../database.types'
import type { FixedCostsReading } from '../fixed-costs'
import type {
  OverviewAdapter,
  OverviewDrawer,
  OverviewMonth,
  OverviewRevenue,
  OverviewSales,
  OverviewToday,
} from '../overview'

export function createSupabaseOverviewAdapter(client: SupabaseClient<Database>): OverviewAdapter {
  return {
    async sales(outletId, date) {
      const { data, error } = await client.rpc('overview_sales', {
        p_outlet_id: outletId,
        p_from: date,
        p_through: date,
      })
      if (error) throw error
      return data as unknown as OverviewSales
    },
    async revenue(outletId, from, through) {
      const { data, error } = await client.rpc('overview_revenue', {
        p_outlet_id: outletId,
        p_from: from,
        p_through: through,
      })
      if (error) throw error
      return data as unknown as OverviewRevenue
    },
    async expenses(outletId, from, through) {
      const { data, error } = await client.rpc('overview_expenses', {
        p_outlet_id: outletId,
        p_from: from,
        p_through: through,
      })
      if (error) throw error
      return Number(data)
    },
    async drawer(outletId) {
      const { data, error } = await client.rpc('overview_drawer', { p_outlet_id: outletId })
      if (error) throw error
      return data as unknown as OverviewDrawer
    },
    async tablets(outletId) {
      const { data, error } = await client
        .from('counter_devices')
        .select('last_seen_at')
        .eq('outlet_id', outletId)
        .is('removed_at', null)
        .not('session_proven_at', 'is', null)
      if (error) throw error
      return (data ?? []).map((row) => row.last_seen_at)
    },
    async today(outletId) {
      const { data, error } = await client.rpc('overview_today_v2', { p_outlet_id: outletId })
      if (error) throw error
      return data as unknown as OverviewToday
    },
    async month(outletId, options) {
      // `overview_month` exactly as #76 reads it, and with `pro-rata-pnl` on the
      // outlet's fixed costs beside it, at the same time, folded by the one copy
      // of the rules the other screens fold with.
      const [month, fixedCosts] = await Promise.all([
        client.rpc('overview_month', { p_outlet_id: outletId }),
        options?.fixedCosts
          ? client.rpc('fixed_costs_list', { p_outlet_id: outletId })
          : Promise.resolve(null),
      ])
      if (month.error) throw month.error
      const figures = month.data as unknown as OverviewMonth
      if (!fixedCosts) return figures
      // Unread, the tile is #76's: P&L, which is true without them.
      if (fixedCosts.error || !fixedCosts.data) return { ...figures, fixedCosts: null }
      const listed = fixedCosts.data as unknown as FixedCostsReading
      const reading = readProRata(listed.costs, listed.today)
      return { ...figures, fixedCosts: reading.lines.length > 0 ? reading : null }
    },
  }
}
