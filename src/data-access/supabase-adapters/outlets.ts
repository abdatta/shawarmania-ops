import type { SupabaseClient } from '@supabase/supabase-js'

import {
  DataActionError,
  type NewOutlet,
  type OutletPatch,
  type OutletReference,
  type OutletsAdapter,
} from '../adapters'
import type { Database, Tables, TablesInsert, TablesUpdate } from '../database.types'
import { serviceSettingsFromRow } from '../outlet-service-row'
import {
  ALL_OFF_SERVICE_SETTINGS,
  SERVICE_SETTINGS_PROBLEM_MESSAGES,
  serviceSettingsProblem,
  type OutletServiceSettings,
  type ServiceSettingsProblem,
} from '@/domain'
import type { CounterResumeCoordinator, CounterResumeRecord } from '@/outbox'

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
    ...(patch.addressLine1 !== undefined && { address_line1: trimmed(patch.addressLine1) }),
    ...(patch.addressLine2 !== undefined && { address_line2: trimmed(patch.addressLine2) }),
    ...(patch.city !== undefined && { city: trimmed(patch.city) }),
    ...(patch.district !== undefined && { district: trimmed(patch.district) }),
    ...(patch.pincode !== undefined && { pincode: trimmed(patch.pincode) }),
    ...(patch.phone !== undefined && { phone: trimmed(patch.phone) }),
    ...(patch.businessDayCutover !== undefined && {
      business_day_cutover: patch.businessDayCutover,
    }),
    ...(patch.arrivalDeadline !== undefined && {
      arrival_deadline: patch.arrivalDeadline,
    }),
    ...(patch.isActive !== undefined && { is_active: patch.isActive }),
  }
}

/**
 * A duplicate `code` is the one refusal an owner will actually hit, and the
 * raw message names a constraint rather than the mistake.
 *
 * A foreign-key violation is the other: it is what a populated outlet's
 * deletion looks like arriving from Postgres, and `assignments_outlet_id_fkey`
 * is not a sentence. The surface follows this with the actual counts; this
 * message is what stands alone if that lookup fails too.
 */
function asOutletError(error: { message: string; code?: string }): unknown {
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
  if (error.code === 'P0001' && error.message.includes('billing live date')) {
    const nextDate = /next eligible business date is (\d{4}-\d{2}-\d{2})/.exec(error.message)?.[1]
    return new DataActionError(
      'billing_live_date_refused',
      nextDate
        ? `Choose ${nextDate} or later. Once that trading day starts, the billing start date is locked.`
        : 'Choose a future business date. Once that trading day starts, the billing start date is locked.',
    )
  }
  return error
}

/**
 * Which rule a refused service-settings write broke, by the check constraint
 * that refused it (each-outlet-chooses-how-it-serves, D1).
 *
 * The page refuses these before it ever sends, so reaching here means a request
 * the page did not make, or a rule the two disagree about — and the owner still
 * reads a sentence rather than a constraint name. Two constraints cover two
 * mistakes each, told apart by the settings that were sent.
 */
function serviceSettingsRefusal(
  error: { message: string; code?: string },
  sent: OutletServiceSettings,
): unknown {
  if (error.code === '42501') {
    return new DataActionError(
      'not_permitted',
      'Only the owner or this outlet’s manager changes how it serves.',
    )
  }
  if (error.code === 'P0002') {
    return new DataActionError('not_found', 'That outlet no longer exists.')
  }
  if (error.code !== '23514') return error

  const constraint = /check constraint "([a-z_]+)"/.exec(error.message)?.[1]
  const problem: ServiceSettingsProblem | null =
    constraint === 'outlets_table_numbers_need_dine_in'
      ? 'tables_without_dine_in'
      : constraint === 'outlets_packaging_needs_takeaway'
        ? 'packaging_without_takeaway'
        : constraint === 'outlets_packaging_price_matches_charge'
          ? sent.packagingMode === 'off'
            ? 'packaging_price_without_charge'
            : 'packaging_price_required'
          : constraint === 'outlets_packaging_price_whole_rupees'
            ? (sent.packagingPricePaise ?? 0) < 100
              ? 'packaging_price_too_low'
              : 'packaging_price_not_whole_rupees'
            : constraint === 'outlets_gold_waiver_needs_charge'
              ? 'gold_waiver_without_charge'
              : null
  return problem ? new DataActionError(problem, SERVICE_SETTINGS_PROBLEM_MESSAGES[problem]) : error
}

export function createSupabaseOutletsAdapter(
  client: SupabaseClient<Database>,
  resumeCoordinator?: CounterResumeCoordinator,
  offlineResume?: CounterResumeRecord,
): OutletsAdapter {
  const table = () => client.from('outlets')

  /**
   * Outlet rows already read, for the person signed in when they were read.
   *
   * **Why this exists.** Every outlet-scoped screen asked for its outlet before
   * anything else, only to learn the cutover that says which day is today —
   * about 0.35 s on a phone, on every open and every outlet switch, measured on
   * production on 2026-09-25 (the-ledger-reads-fast-and-keeps-its-place, D9).
   * A row read once now answers `getOutlet` at once, and is refreshed behind
   * every such answer, so a cutover edited on another device reaches the read
   * after next rather than never. A write through this adapter replaces or drops
   * its row immediately.
   *
   * **Keyed on the signed-in user, never on this adapter.** The adapter set is
   * built once per app session and outlives a sign-out; a cache that did too
   * would answer the next person on a shared phone with the last person's
   * outlets. The user id comes from supabase-js's own stored session, which is a
   * local read, and a different id empties the cache.
   *
   * It holds an outlet's own row — a name, a cutover, an address — and never a
   * figure. `listOutlets` always asks: it is where a new outlet or a lost
   * assignment has to show, and nobody waits on it.
   */
  const remembered: { userId: string | null; rows: Map<string, Tables<'outlets'>> } = {
    userId: null,
    rows: new Map(),
  }

  async function rememberedRows(): Promise<Map<string, Tables<'outlets'>>> {
    const { data } = await client.auth.getSession()
    const userId = data.session?.user.id ?? null
    if (userId !== remembered.userId) {
      remembered.userId = userId
      remembered.rows = new Map()
    }
    return remembered.rows
  }

  function remember(row: Tables<'outlets'>): void {
    void rememberedRows().then((rows) => rows.set(row.id, row))
  }

  function forget(id: string): void {
    void rememberedRows().then((rows) => rows.delete(id))
  }

  async function readOutlet(
    id: string,
    rows: Map<string, Tables<'outlets'>>,
  ): Promise<Tables<'outlets'> | null> {
    const { data, error } = await table().select('*').eq('id', id).maybeSingle()
    if (error) {
      if (offlineResume?.outlet.id === id) return structuredClone(offlineResume.outlet)
      throw error
    }
    if (data) {
      rows.set(id, data)
      resumeCoordinator?.noteOutlet(data)
    } else {
      rows.delete(id)
    }
    return data
  }

  return {
    async listOutlets(options = {}) {
      const rows = await rememberedRows()
      const query = table().select('*').order('name')
      const { data, error } = await (options.includeInactive ? query : query.eq('is_active', true))
      if (error) throw error
      for (const row of data) rows.set(row.id, row)
      return data
    },

    async getOutlet(id: string) {
      const rows = await rememberedRows()
      const known = rows.get(id)
      const fresh = readOutlet(id, rows)
      if (!known) return fresh
      // Answered now, refreshed behind. A refresh that fails leaves the
      // remembered row in place; the next screen tries again.
      fresh.catch(() => undefined)
      resumeCoordinator?.noteOutlet(known)
      return structuredClone(known)
    },

    async createOutlet(outlet: NewOutlet) {
      const insert = toColumns(outlet) as TablesInsert<'outlets'>
      const { data, error } = await table().insert(insert).select('*').single()
      if (error) throw asOutletError(error)
      remember(data)
      return data
    },

    async updateOutlet(id, patch) {
      const { data, error } = await table()
        .update(toColumns(patch))
        .eq('id', id)
        .select('*')
        .single()
      if (error) throw asOutletError(error)
      remember(data)
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
      remember(data)
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
      forget(id)
    },

    async outletReferences(id: string) {
      const { data, error } = await client.rpc('outlet_reference_counts', { p_outlet: id })
      if (error) throw error
      return (data ?? []).map((row): OutletReference => ({
        table: row.table_name,
        count: Number(row.row_count),
      }))
    },

    /*
      How an outlet serves (each-outlet-chooses-how-it-serves, D1, D10). Read
      off the outlet's own row, so whoever may read the row reads its choices;
      an outlet outside the reader's reach answers as one that chose nothing,
      because that is all the reader may know about it.
    */
    async getServiceSettings(id) {
      const { data, error } = await table()
        .select(
          'dine_in_offered, takeaway_offered, table_numbers, packaging_mode, packaging_price_paise, packaging_free_for_gold',
        )
        .eq('id', id)
        .maybeSingle()
      if (error) throw error
      return data ? serviceSettingsFromRow(data) : { ...ALL_OFF_SERVICE_SETTINGS }
    },

    /*
      Never through `outlets_update`, which stays the owner's alone for every
      other column: through `set_outlet_service_settings`, which the owner and
      the outlet's own managers may call, re-derives the caller's authority, and
      writes these six columns and nothing else.
    */
    async updateServiceSettings(id, settings) {
      const problem = serviceSettingsProblem(settings)
      if (problem !== null) {
        throw new DataActionError(problem, SERVICE_SETTINGS_PROBLEM_MESSAGES[problem])
      }
      const { data, error } = await client.rpc('set_outlet_service_settings', {
        p_outlet: id,
        p_dine_in_offered: settings.dineInOffered,
        p_takeaway_offered: settings.takeawayOffered,
        p_table_numbers: settings.tableNumbers,
        p_packaging_mode: settings.packagingMode,
        // The generator types every function argument as non-null; this one is
        // null exactly when packaging is off, which the table checks.
        p_packaging_price_paise: settings.packagingPricePaise as number,
        p_packaging_free_for_gold: settings.packagingFreeForGold,
      })
      if (error) throw serviceSettingsRefusal(error, settings)
      const row = data as Tables<'outlets'>
      remember(row)
      return serviceSettingsFromRow(row)
    },
  }
}
