import {
  DataActionError,
  type NewOutlet,
  type OutletPatch,
  type OutletReference,
  type OutletsAdapter,
} from '../adapters'
import { assignmentFixtures } from './fixtures/accounts'
import { outletFixtures } from './fixtures/outlets'

/**
 * The mock outlets adapter: fixtures in, promises out, no I/O anywhere.
 * Results are cloned so a screen mutating what it was handed cannot corrupt
 * the fixtures for the next screen.
 *
 * It refuses what the database refuses — a duplicate code, above all — because
 * a demo that accepts a write the real stack rejects teaches the wrong thing
 * about the product.
 *
 * Deletion is the sharpest case of that. The real refusal is a foreign key,
 * and fixtures have none: a naive mock deletes every outlet happily and the
 * demo teaches that outlets are freely removable, which is the opposite of
 * what this schema does. So the reference count below is computed from the
 * other fixture collections by hand — the mock's substitute for referential
 * integrity, and the reason `deleteOutlet` refuses here exactly where Postgres
 * refuses there (design D7).
 */

/**
 * Everything in the fixtures that points at an outlet, keyed by the table name
 * the real function would return. Kept beside the fixtures rather than derived,
 * because there is no catalog to read — and a collection added here without a
 * line in this map is a demo that quietly under-reports.
 */
function referencesTo(outletId: string): OutletReference[] {
  const counts: OutletReference[] = [
    // `assignments` rather than `profiles`: since multi-outlet-people it is the
    // assignment that references an outlet, so it is the assignment that
    // refuses the outlet's deletion — which is what the real
    // `outlet_reference_counts` now reports too.
    {
      table: 'assignments',
      count: Object.values(assignmentFixtures)
        .flat()
        .filter((assignment) => assignment.outletId === outletId).length,
    },
  ]
  // Only what is actually attached, matching outlet_reference_counts.
  return counts
    .filter((reference) => reference.count > 0)
    .sort((a, b) => a.table.localeCompare(b.table))
}

/** Empty is absent, matching the real adapter. */
function trimmed(value: string | null | undefined): string | null {
  const text = value?.trim()
  return text ? text : null
}

export function createMockOutletsAdapter(): OutletsAdapter {
  // Captures and edits mutate, so this mock keeps its own copy: a demo where
  // saving a position changes nothing would be demonstrating the wrong thing,
  // and the shared fixture array must survive the walkthrough unedited.
  const outlets = structuredClone(outletFixtures)
  let nextId = 1

  const find = (id: string) => {
    const outlet = outlets.find((candidate) => candidate.id === id)
    if (!outlet) throw new Error(`No demo outlet: ${id}`)
    return outlet
  }

  const refuseDuplicateCode = (code: string, exceptId?: string) => {
    if (outlets.some((outlet) => outlet.code === code && outlet.id !== exceptId)) {
      throw new DataActionError(
        'code_taken',
        'That outlet code is already used. Pick another short code.',
      )
    }
  }

  return {
    async listOutlets(options = {}) {
      const visible = options.includeInactive ? outlets : outlets.filter((o) => o.is_active)
      return structuredClone(visible).sort((a, b) => a.name.localeCompare(b.name))
    },

    async getOutlet(id: string) {
      const outlet = outlets.find((candidate) => candidate.id === id)
      return outlet ? structuredClone(outlet) : null
    },

    async createOutlet(outlet: NewOutlet) {
      const code = outlet.code.trim()
      refuseDuplicateCode(code)

      const created = {
        id: `d0000000-0000-4000-b000-${String(nextId++).padStart(12, '0')}`,
        code,
        name: outlet.name.trim(),
        location_label: outlet.locationLabel.trim(),
        address_line1: trimmed(outlet.addressLine1),
        address_line2: trimmed(outlet.addressLine2),
        city: trimmed(outlet.city),
        district: trimmed(outlet.district),
        pincode: trimmed(outlet.pincode),
        phone: trimmed(outlet.phone),
        latitude: null,
        longitude: null,
        geofence_radius_m: 150,
        business_day_cutover: outlet.businessDayCutover ?? '04:00:00',
        arrival_deadline: outlet.arrivalDeadline ?? '13:00:00',
        billing_live_from: null,
        is_active: true,
        created_at: new Date().toISOString(),
        // A new outlet has never been stood in, so it judges nobody until
        // somebody captures it.
        location_accuracy_m: null,
        location_captured_at: null,
      }
      outlets.push(created)
      return structuredClone(created)
    },

    async updateOutlet(id, patch: OutletPatch) {
      const outlet = find(id)
      if (patch.code !== undefined) refuseDuplicateCode(patch.code.trim(), id)

      Object.assign(outlet, {
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
        ...(patch.billingLiveFrom !== undefined && {
          billing_live_from: patch.billingLiveFrom,
        }),
        ...(patch.isActive !== undefined && { is_active: patch.isActive }),
      })
      return structuredClone(outlet)
    },

    async saveLocation(id, location) {
      const outlet = find(id)
      outlet.latitude = location.latitude
      outlet.longitude = location.longitude
      outlet.location_accuracy_m = location.accuracyMetres
      outlet.location_captured_at = new Date().toISOString()
      outlet.geofence_radius_m = location.radiusMetres
      return structuredClone(outlet)
    },

    async deleteOutlet(id: string) {
      find(id)
      if (referencesTo(id).length > 0) {
        // The same code and the same shape the real adapter produces for a
        // foreign-key violation, so the surface has one refusal to handle.
        throw new DataActionError(
          'outlet_in_use',
          'Something is still attached to this outlet, so it cannot be deleted.',
        )
      }
      outlets.splice(
        outlets.findIndex((outlet) => outlet.id === id),
        1,
      )
    },

    async outletReferences(id: string) {
      return referencesTo(id)
    },
  }
}
