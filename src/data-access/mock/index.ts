import type { DataAdapters } from '../adapters'
import { createMockAccountsAdapter } from './accounts'
import { createMockOutletsAdapter } from './outlets'

/**
 * Everything the demo tree needs, and the only factory it may import.
 * Nothing under src/data-access/mock/ may import the Supabase client or the
 * real adapters — eslint enforces it (design D4, layer 1).
 */
export function createMockAdapters(): DataAdapters {
  return {
    outlets: createMockOutletsAdapter(),
    accounts: createMockAccountsAdapter(),
  }
}

export { personaFixtures } from './fixtures/personas'
export { OUTLET_KALYANI_ID, OUTLET_KANCHRAPARA_ID, outletFixtures } from './fixtures/outlets'
