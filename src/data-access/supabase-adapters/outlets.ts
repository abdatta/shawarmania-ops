import type { SupabaseClient } from '@supabase/supabase-js'

import { DataActionError, type NewOutlet, type OutletPatch, type OutletsAdapter } from '../adapters'
import type { Database, TablesInsert, TablesUpdate } from '../database.types'

/**
 * The real outlets adapter.
 *
 * Every write here is offered to every caller and refused by the database for
 * all but the Super Admin (`outlets_insert`, `outlets_update`). That is the
 * point: the UI not showing a button is convenience, and the policy is the
 * boundary.
 */

/** Empty is absent, not an empty string — a blank address field means unknown. */
function trimmed(value: string | null): string | null {
  const text = value?.trim()
  return text ? text : null
}

function toColumns(patch: OutletPatch): TablesUpdate<'outlets'> {
  return {
    ...(patch.code !== undefined && { code: patch.code.trim() }),
    ...(patch.name !== undefined && { name: patch.name.trim() }),
    ...(patch.locationLabel !== undefined && { location_label: patch.locationLabel.trim() }),
    ...(patch.addressLine1 !== undefined && { address_line1: trimmed(patch.addressLine1) }),
    ...(patch.addressLine2 !== undefined && { address_line2: trimmed(patch.addressLine2) }),
    ...(patch.city !== undefined && { city: trimmed(patch.city) }),
    ...(patch.district !== undefined && { district: trimmed(patch.district) }),
    ...(patch.pincode !== undefined && { pincode: trimmed(patch.pincode) }),
    ...(patch.phone !== undefined && { phone: trimmed(patch.phone) }),
    ...(patch.businessDayCutover !== undefined && {
      business_day_cutover: patch.businessDayCutover,
    }),
    ...(patch.isActive !== undefined && { is_active: patch.isActive }),
  }
}

/**
 * A duplicate `code` is the one refusal an owner will actually hit, and the
 * raw message names a constraint rather than the mistake.
 */
function asOutletError(error: { message: string; code?: string }): unknown {
  if (error.code === '23505' || error.message.includes('outlets_code_key')) {
    return new DataActionError(
      'code_taken',
      'That outlet code is already used. Pick another short code.',
    )
  }
  return error
}

export function createSupabaseOutletsAdapter(client: SupabaseClient<Database>): OutletsAdapter {
  const table = () => client.from('outlets')

  return {
    async listOutlets(options = {}) {
      const query = table().select('*').order('name')
      const { data, error } = await (options.includeInactive ? query : query.eq('is_active', true))
      if (error) throw error
      return data
    },

    async getOutlet(id: string) {
      const { data, error } = await table().select('*').eq('id', id).maybeSingle()
      if (error) throw error
      return data
    },

    async createOutlet(outlet: NewOutlet) {
      const insert = toColumns(outlet) as TablesInsert<'outlets'>
      const { data, error } = await table().insert(insert).select('*').single()
      if (error) throw asOutletError(error)
      return data
    },

    async updateOutlet(id, patch) {
      const { data, error } = await table()
        .update(toColumns(patch))
        .eq('id', id)
        .select('*')
        .single()
      if (error) throw asOutletError(error)
      return data
    },

    async saveLocation(id, location) {
      const { data, error } = await table()
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
