import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../database.types'
import { analyticsSeries, analyticsSnapshot, type AnalyticsAdapter } from '../analytics'

export function createSupabaseAnalyticsAdapter(client: SupabaseClient<Database>): AnalyticsAdapter {
  return {
    async read(outletId, from, to, options) {
      // One Revenue's read: windows aligned as asked, comparisons cut at the
      // server's now (revenue-reads-the-same-everywhere, design D7).
      const { data, error } = await client.rpc('sales_analytics_v2', {
        p_outlet_id: outletId,
        p_from: from,
        p_to: to,
        p_view: options?.view ?? 'all',
        p_periods: options?.periods ?? 2,
        p_align: options?.align ?? 'equal',
        ...(options?.cut ? { p_cut: 'now' } : {}),
      })
      if (error) throw new Error(error.message)
      return analyticsSnapshot(data)
    },
    async series(outletId, from, to, periods, subject, options) {
      const { data, error } = await client.rpc('sales_analytics_series_v2', {
        p_outlet_id: outletId,
        p_from: from,
        p_to: to,
        p_periods: periods,
        ...(subject.kind === 'item' ? { p_item: subject.key } : {}),
        ...(subject.kind === 'category' ? { p_category: subject.name } : {}),
        ...(options?.cut ? { p_cut: 'now' } : {}),
      })
      if (error) throw new Error(error.message)
      return analyticsSeries(data)
    },
  }
}
