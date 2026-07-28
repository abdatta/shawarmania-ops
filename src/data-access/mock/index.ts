import type { AppRole, DataAdapters } from '../adapters'
import { createMockAddressLookupAdapter } from './address-lookup'
import { createDemoAccounts, createMockAccountsAdapter } from './accounts'
import { createMockAttendanceAdapter } from './attendance'
import { createMockBillingAdapter } from './billing'
import { createMockDailyCashAdapter } from './daily-cash'
import { createMockEmployeesAdapter } from './employees'
import { createMockExpensesAdapter } from './expenses'
import { createMockInventoryAdapter } from './inventory'
import { createMockMenuAdapter } from './menu'
import { createMockOutletsAdapter } from './outlets'
import { createDemoStore } from './store'

/**
 * Everything the demo tree needs, and the only factory it may import.
 * Nothing under src/data-access/mock/ may import the Supabase client or the
 * real adapters — eslint enforces it (design D4, layer 1).
 */
export function createMockAdapters(role: AppRole = 'super_admin'): DataAdapters {
  // One account list, two adapters. Accounts and the roster describe the same
  // people from different angles, and a demo where linking someone on Staff
  // does not change what Access says would be demonstrating the wrong thing.
  const accounts = createDemoAccounts()

  // The same argument, one size up: the operational surfaces describe one
  // trading day from several angles, and figures that contradict each other two
  // screens apart are how a demo stops being believed.
  const store = createDemoStore()

  return {
    outlets: createMockOutletsAdapter(),
    accounts: createMockAccountsAdapter(accounts),
    attendance: createMockAttendanceAdapter(),
    employees: createMockEmployeesAdapter(accounts, role),
    // The persona's role reaches the menu mock so it refuses a Biller's write
    // where `menu_items_write` will refuse it.
    menu: createMockMenuAdapter(store, role),
    billing: createMockBillingAdapter(store),
    inventory: createMockInventoryAdapter(store),
    expenses: createMockExpensesAdapter(store),
    dailyCash: createMockDailyCashAdapter(store),
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
export {
  MENU_ITEM_CLASSIC_ID,
  MENU_ITEM_MAYO_ID,
  MENU_ITEM_STUFFED_ID,
  menuCategoryFixtures,
  menuItemFixtures,
} from './fixtures/menu'
export { createDemoStore, DEMO_OUTLET_ID, type DemoStore } from './store'
