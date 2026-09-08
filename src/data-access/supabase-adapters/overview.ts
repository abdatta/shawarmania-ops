import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../database.types'
import type { OverviewAdapter, OverviewDrawer, OverviewRevenue, OverviewSales } from '../overview'

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
  }
}
