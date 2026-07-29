import type { SupabaseClient } from '@supabase/supabase-js'

import {
  DataActionError,
  type NewOutlet,
  type OutletPatch,
  type OutletReference,
  type OutletsAdapter,
} from '../adapters'
import type { Database, TablesInsert, TablesUpdate } from '../database.types'

/**
 * The real outlets adapter.
 *
 * Every write here is offered to every caller and refused by the database for
 * all but the Super Admin (`outlets_insert`, `outlets_update`, and now
 * `outlets_delete`). That is the point: the UI not showing a button is
 * convenience, and the policy is the boundary.
 *
 * **`deleteOutlet` has no counterpart in any other adapter, and that is not an
 * oversight.** `outlets` is the only table in this schema a client may delete
 * from — everywhere else history is voided, deactivated or corrected rather
 * than removed, and the grants migration says so. The exception is justified
 * by the precondition the database enforces: an outlet can only go while
 * nothing references it, and an outlet nothing references has no history to
 * protect. Anyone reaching for `delete` on profiles, bills or attendance is
 * looking for a schema change, not a missing method.
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
    // Uppercased here rather than trusted from the form, because it is half of
    // an identifier the database enforces the shape of. Omitted when absent, so
    // `issue_outlet_prefix` derives one.
    ...(patch.staffCodePrefix !== undefined && {
      staff_code_prefix: patch.staffCodePrefix.trim().toUpperCase(),
    }),
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
 *
 * A foreign-key violation is the other: it is what a populated outlet's
 * deletion looks like arriving from Postgres, and `profiles_outlet_id_fkey`
 * is not a sentence. The surface follows this with the actual counts; this
 * message is what stands alone if that lookup fails too.
 */
function asOutletError(error: { message: string; code?: string }): unknown {
  // Checked before the generic `23505` below, which would otherwise report a
  // duplicate staff-code prefix as a duplicate outlet code and send the owner
  // to correct the wrong field.
  if (error.message.includes('outlets_staff_code_prefix_unique')) {
    return new DataActionError(
      'prefix_taken',
      'Another outlet already uses that staff code prefix. Pick three different characters.',
    )
  }
  if (error.message.includes('outlets_staff_code_prefix_shape')) {
    return new DataActionError(
      'prefix_invalid',
      'A staff code prefix is exactly three letters or digits, like KAL.',
    )
  }
  if (error.message.includes('staff codes have already been issued')) {
    return new DataActionError(
      'prefix_frozen',
      'Staff codes have already been issued from this prefix, so it cannot change now.',
    )
  }
  if (error.code === '23505' || error.message.includes('outlets_code_key')) {
    return new DataActionError(
      'code_taken',
      'That outlet code is already used. Pick another short code.',
    )
  }
  if (error.code === '23503') {
    return new DataActionError(
      'outlet_in_use',
      'Something is still attached to this outlet, so it cannot be deleted.',
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

    async deleteOutlet(id: string) {
      // `.select()` is what turns a policy refusal into an answer. A DELETE
      // that matches no row through RLS is not an error — it removes nothing
      // and reports success — so trusting silence here would take the outlet
      // off the screen while it sat untouched in the database.
      const { data, error } = await table().delete().eq('id', id).select('id')
      if (error) throw asOutletError(error)
      if (!data || data.length === 0) {
        throw new DataActionError(
          'not_permitted',
          'That outlet was not deleted. Only the owner can delete an outlet, and only from an account that is still active.',
        )
      }
    },

    async outletReferences(id: string) {
      const { data, error } = await client.rpc('outlet_reference_counts', { p_outlet: id })
      if (error) throw error
      return (data ?? []).map((row): OutletReference => ({
        table: row.table_name,
        count: Number(row.row_count),
      }))
    },
  }
}
