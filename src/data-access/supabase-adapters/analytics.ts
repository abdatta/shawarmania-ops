import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../database.types'
import {
  analyticsSeries,
  analyticsSnapshot,
  deliveryScopeSeries,
  deliveryScopeSnapshot,
  type AnalyticsAdapter,
} from '../analytics'

export function createSupabaseAnalyticsAdapter(client: SupabaseClient<Database>): AnalyticsAdapter {
  return {
    async read(outletId, from, to, options) {
      // `_v3` takes a scope, Counter or Delivery (delivery-orders-are-made-not-billed,
      // D6); its windows are aligned as asked and its comparisons cut at the
      // server's now (revenue-reads-the-same-everywhere, design D7).
      const scope = options?.scope ?? 'counter'
      const { data, error } = await client.rpc('sales_analytics_v3', {
        p_outlet_id: outletId,
        p_from: from,
        p_to: to,
        p_view: options?.view ?? 'all',
        p_periods: options?.periods ?? 2,
        p_align: options?.align ?? 'equal',
        ...(options?.cut ? { p_cut: 'now' } : {}),
        p_scope: scope,
      })
      if (error) throw new Error(error.message)
      return analyticsSnapshot(scope === 'delivery' ? deliveryScopeSnapshot(data) : data)
    },
    async series(outletId, from, to, periods, subject, options) {
      const scope = options?.scope ?? 'counter'
      const { data, error } = await client.rpc('sales_analytics_series_v3', {
        p_outlet_id: outletId,
        p_from: from,
        p_to: to,
        p_periods: periods,
        ...(subject.kind === 'item' ? { p_item: subject.key } : {}),
        ...(subject.kind === 'category' ? { p_category: subject.name } : {}),
        ...(options?.cut ? { p_cut: 'now' } : {}),
        p_scope: scope,
      })
      if (error) throw new Error(error.message)
      return analyticsSeries(scope === 'delivery' ? deliveryScopeSeries(data) : data)
    },
  }
}
