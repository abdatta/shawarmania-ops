import type { SupabaseClient } from '@supabase/supabase-js'

import type { OutletsAdapter } from '../adapters'
import type { Database } from '../database.types'

/**
 * The real outlets adapter.
 *
 * `saveLocation` is offered to every caller and refused by the database for
 * all but the Super Admin (`outlets_update`). That is the point: the UI not
 * showing a button is convenience, and the policy is the boundary.
 */
export function createSupabaseOutletsAdapter(client: SupabaseClient<Database>): OutletsAdapter {
  return {
    async listOutlets() {
      const { data, error } = await client
        .from('outlets')
        .select('*')
        .eq('is_active', true)
        .order('name')
      if (error) throw error
      return data
    },
    async getOutlet(id: string) {
      const { data, error } = await client.from('outlets').select('*').eq('id', id).maybeSingle()
      if (error) throw error
      return data
    },
    async saveLocation(id, location) {
      const { data, error } = await client
        .from('outlets')
        .update({
          latitude: location.latitude,
          longitude: location.longitude,
          location_accuracy_m: location.accuracyMetres,
          location_captured_at: new Date().toISOString(),
          geofence_radius_m: location.radiusMetres,
        })
        .eq('id', id)
        .select('*')
        .single()
      if (error) throw error
      return data
    },
  }
}
