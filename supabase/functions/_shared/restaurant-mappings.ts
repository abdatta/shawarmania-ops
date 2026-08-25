import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2.110.8'

import type { Database } from '../../../src/data-access/database.types.ts'

export type RestaurantChannel = 'swiggy' | 'zomato'

/**
 * Reads mappings an automated channel flow may act on.
 *
 * `state` is the database field; `enabled` is one of its values. Keeping the
 * query here means generated schema types reject the tempting, nonexistent
 * `enabled` boolean before any Edge Function reaches production.
 */
export function enabledRestaurantMappings(
  service: SupabaseClient<Database>,
  channel: RestaurantChannel,
) {
  return service
    .from('outlet_channel_restaurants')
    .select('outlet_id, external_ref')
    .eq('channel', channel)
    .eq('state', 'enabled')
}
