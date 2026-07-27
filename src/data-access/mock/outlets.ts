import type { OutletsAdapter } from '../adapters'
import { outletFixtures } from './fixtures/outlets'

/**
 * The mock outlets adapter: fixtures in, promises out, no I/O anywhere.
 * Results are cloned so a screen mutating what it was handed cannot corrupt
 * the fixtures for the next screen.
 */
export function createMockOutletsAdapter(): OutletsAdapter {
  // Captures mutate, so this mock keeps its own copy: a demo where saving a
  // position changes nothing would be demonstrating the wrong thing, and the
  // shared fixture array must survive the walkthrough unedited.
  const outlets = structuredClone(outletFixtures)

  return {
    async listOutlets() {
      return structuredClone(outlets.filter((outlet) => outlet.is_active))
    },
    async getOutlet(id: string) {
      const outlet = outlets.find((candidate) => candidate.id === id)
      return outlet ? structuredClone(outlet) : null
    },
    async saveLocation(id, location) {
      const outlet = outlets.find((candidate) => candidate.id === id)
      if (!outlet) throw new Error(`No demo outlet: ${id}`)
      outlet.latitude = location.latitude
      outlet.longitude = location.longitude
      outlet.location_accuracy_m = location.accuracyMetres
      outlet.location_captured_at = new Date().toISOString()
      outlet.geofence_radius_m = location.radiusMetres
      return structuredClone(outlet)
    },
  }
}
