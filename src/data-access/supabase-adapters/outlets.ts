import type { SupabaseClient } from '@supabase/supabase-js'

import type { OutletsAdapter } from '../adapters'
import type { Database } from '../database.types'

/**
 * The real outlets adapter. Unused until auth-and-roles (#4) mounts a real
 * session tree; it exists now so the seam is proven from both sides — the
 * interface compiles against what the database can actually serve, not only
 * against fixtures.
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
  }
}
