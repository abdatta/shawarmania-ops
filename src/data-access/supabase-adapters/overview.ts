import { onDeliveryOrders } from '@/change-gates/delivery-orders'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readProRata } from '@/domain/fixed-costs'
import type { Database } from '../database.types'
import type { FixedCostsReading } from '../fixed-costs'
import type { OverviewAdapter, OverviewDrawer, OverviewMonth, OverviewToday } from '../overview'

export function createSupabaseOverviewAdapter(client: SupabaseClient<Database>): OverviewAdapter {
  return {
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
      // `delivery-orders` reads `_v3`, whose open total leaves out open delivery
      // orders (delivery-orders-are-made-not-billed, D6); off, today's read.
      const { data, error } = await client.rpc(
        onDeliveryOrders() ? 'overview_today_v3' : 'overview_today_v2',
        { p_outlet_id: outletId },
      )
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
