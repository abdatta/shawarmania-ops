import type { OutletsAdapter } from '../adapters'
import { outletFixtures } from './fixtures/outlets'

/**
 * The mock outlets adapter: fixtures in, promises out, no I/O anywhere.
 * Results are cloned so a screen mutating what it was handed cannot corrupt
 * the fixtures for the next screen.
 */
export function createMockOutletsAdapter(): OutletsAdapter {
  return {
    async listOutlets() {
      return structuredClone(outletFixtures.filter((outlet) => outlet.is_active))
    },
    async getOutlet(id: string) {
      const outlet = outletFixtures.find((candidate) => candidate.id === id)
      return outlet ? structuredClone(outlet) : null
    },
  }
}
