import type { DataAdapters } from '../adapters'
import { createMockAddressLookupAdapter } from './address-lookup'
import { createDemoAccounts, createMockAccountsAdapter } from './accounts'
import { createMockAttendanceAdapter } from './attendance'
import { createMockEmployeesAdapter } from './employees'
import { createMockOutletsAdapter } from './outlets'

/**
 * Everything the demo tree needs, and the only factory it may import.
 * Nothing under src/data-access/mock/ may import the Supabase client or the
 * real adapters — eslint enforces it (design D4, layer 1).
 */
export function createMockAdapters(): DataAdapters {
  // One account list, two adapters. Accounts and the roster describe the same
  // people from different angles, and a demo where linking someone on Staff
  // does not change what Access says would be demonstrating the wrong thing.
  const accounts = createDemoAccounts()

  return {
    outlets: createMockOutletsAdapter(),
    accounts: createMockAccountsAdapter(accounts),
    attendance: createMockAttendanceAdapter(),
    employees: createMockEmployeesAdapter(accounts),
    addressLookup: createMockAddressLookupAdapter(),
  }
}

export { personaFixtures } from './fixtures/personas'
export {
  OUTLET_KALYANI_ID,
  OUTLET_KANCHRAPARA_ID,
  OUTLET_MISTAKE_ID,
  outletFixtures,
} from './fixtures/outlets'
export { employeeFixtures } from './fixtures/employees'
