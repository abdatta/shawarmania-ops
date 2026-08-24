import type { AppRole, AttendanceAdapter, DataAdapters } from '../adapters'
import { assignedOutlets } from '../adapters'
import { createMockAddressLookupAdapter } from './address-lookup'
import { createMockAggregatorSyncAdapter } from './aggregator-sync'
import { DEMO_OUTLET_ID, DEMO_SECOND_OUTLET_ID } from './store'
import { createDemoAccounts, createMockAccountsAdapter } from './accounts'
import { createMockAlertsAdapter } from './alerts'
import { createMockAttendanceAdapter } from './attendance'
import { createMockBillingAdapter } from './billing'
import { createDemoCounter, createMockCounterAdapter, type DemoCounter } from './counter'
import { createDemoCustomers, createMockCustomersAdapter } from './customers'
import { createMockDailyCashAdapter } from './daily-cash'
import { createMockExpensesAdapter } from './expenses'
import { createMockExpenseCategoriesAdapter } from './expense-categories'
import { createMockInsightsAdapter } from './insights'
import { createMockInventoryAdapter } from './inventory'
import { createMockManualLedgerAdapter } from './manual-ledger'
import { createMockMenuAdapter } from './menu'
import { createMockOutletsAdapter } from './outlets'
import { personaFixtures } from './fixtures/personas'
import { createDemoStore } from './store'

/**
 * Everything one demo *session* holds, independent of who is currently looking
 * at it.
 *
 * **This is separate from the adapters on purpose.** Several mocks are built
 * per role — the menu refuses a Biller's write, alerts and insights enforce the
 * cross-outlet boundary — so switching roles rebuilds the adapters. If the data
 * were built with them, every role switch would start a fresh demo, and
 * *"raise an alert as the manager, flip roles, answer it as the owner"* — the
 * demonstration this whole change exists for — would show the owner an empty
 * inbox. The same applies to an employee checking in and flipping to the
 * manager to have it approved.
 *
 * So the data outlives the role, and only a reset replaces it
 * (ui-owner-console-and-demo, design D10).
 */
export interface DemoData {
  /** The one list of people — staff are accounts, and every surface reads it. */
  accounts: ReturnType<typeof createDemoAccounts>
  /**
   * One trading day described from several angles. Figures that contradict each
   * other two screens apart are how a demo stops being believed.
   */
  store: ReturnType<typeof createDemoStore>
  /** Holds its own state, so it belongs to the session rather than to a role. */
  attendance: ReturnType<typeof createMockAttendanceAdapter>
  /**
   * The global customer directory. Session-scoped rather than role-scoped for
   * the same reason as the rest: a customer saved at the counter must still be
   * there after a role switch, since one identity for the whole business is
   * exactly the thing being demonstrated.
   */
  customers: ReturnType<typeof createDemoCustomers>
  /**
   * The tablets, the pending requests and the live shifts. Session-scoped for
   * the reason everything here is: asking for a shift as the tablet and then
   * flipping to the phone to approve it is the walkthrough this feature exists
   * for, and role-scoped state would lose the request in between.
   */
  counter: DemoCounter
}

export function createDemoData(): DemoData {
  return {
    accounts: createDemoAccounts(),
    store: createDemoStore({ billingLifecycle: true }),
    attendance: createMockAttendanceAdapter(),
    customers: createDemoCustomers(),
    counter: createDemoCounter(),
  }
}

/**
 * The one attendance read that spans outlets, cut down to the ones the caller
 * can reach.
 *
 * In the real adapter this costs nothing: `countWaitingByOutlet` is a plain
 * filtered select and the RLS policies scope it. The mock holds a single store
 * shared by every role — that is deliberate, so a check-in survives a role
 * switch — so the boundary the policies draw has to be drawn here instead, as
 * the alerts and insights mocks already do. Without it a manager's navigation
 * badge would count arrivals at an outlet they cannot open, which is the one
 * thing a badge must never do (notification-badges, attention-badges spec).
 */
function withReachableWaiting(
  adapter: AttendanceAdapter,
  reach: readonly string[],
): AttendanceAdapter {
  return {
    ...adapter,
    async countWaitingByOutlet() {
      const counts = await adapter.countWaitingByOutlet()
      return counts.filter((count) => reach.includes(count.outletId))
    },
  }
}

/**
 * Everything the demo tree needs, and the only factory it may import.
 * Nothing under src/data-access/mock/ may import the Supabase client or the
 * real adapters — eslint enforces it (design D4, layer 1).
 *
 * `data` defaults to a fresh session, which is what a test wants; the demo tree
 * passes the same one across role switches.
 */
export function createMockAdapters(
  role: AppRole = 'super_admin',
  data: DemoData = createDemoData(),
): DataAdapters {
  const { accounts, store, attendance } = data

  // Who the mocks think is asking. Derived from the same persona the demo tree
  // builds its session from, so an adapter's idea of the caller cannot drift
  // from the session's — the alerts and insights mocks both enforce the
  // cross-outlet boundary from it.
  const persona = personaFixtures[role]
  const session = {
    userId: persona.profile.id,
    // The persona's single outlet, which is what every mock that scopes by
    // outlet wants. The owner has none of their own; their Kalyani manager
    // assignment is authority over that outlet rather than a home in it.
    outletId: persona.outlet?.id ?? null,
  }

  return {
    outlets: createMockOutletsAdapter(),
    // The persona's role and id reach the accounts mock so it refuses a
    // manager assigning themselves exactly where the database will.
    accounts: createMockAccountsAdapter(accounts, role, persona.profile.id),
    // Only the Super Admin reads waiting counts across outlets; everybody else
    // sees their own assignments' worth, exactly as the policies will answer.
    attendance:
      role === 'super_admin'
        ? attendance
        : withReachableWaiting(attendance, assignedOutlets(persona.assignments)),
    // The persona's role reaches the menu mock so it refuses a Biller's write
    // where `menu_items_write` will refuse it.
    menu: createMockMenuAdapter(store, role),
    billing: createMockBillingAdapter(store, {
      role,
      userId: persona.profile.id,
      outletIds: assignedOutlets(persona.assignments),
    }),
    // The role scopes the tablet list as `counter_devices_select` will, and the
    // persona's name stands in for the username the tablet types — demo mode has
    // no usernames, and a handshake with nobody to name is not a handshake.
    counter: createMockCounterAdapter(
      data.counter,
      store,
      accounts,
      role,
      persona.profile.id,
      persona.profile.full_name,
      assignedOutlets(persona.assignments),
    ),
    // The role reaches the customer mock so it refuses everybody the database
    // refuses: only a billing context may resolve a phone at all.
    customers: createMockCustomersAdapter(data.customers, role),
    inventory: createMockInventoryAdapter(store),
    expenses: createMockExpensesAdapter(store),
    expenseCategories: createMockExpenseCategoriesAdapter(store, role),
    dailyCash: createMockDailyCashAdapter(store),
    // Both enforce the boundary the RLS policies will: only the Super Admin
    // reads across outlets, and asking for somebody else's returns nothing.
    alerts: createMockAlertsAdapter(store, role, session),
    insights: createMockInsightsAdapter(store, attendance, role, session),
    // The role, the person and their assignments all reach it, because the
    // ledger's two tables now answer differently for the same caller: the day
    // record refuses outlet staff everywhere, the expense record admits them at
    // their own outlet, and "your own rows" needs to know who is asking
    // (the-ledger-opens-to-the-outlet).
    manualLedger: createMockManualLedgerAdapter(
      store,
      role,
      persona.profile.id,
      assignedOutlets(persona.assignments),
    ),
    // Both outlets, because the sync is a cross-outlet surface and the owner is
    // its only reader: the same reach the policies grant.
    aggregatorSync: createMockAggregatorSyncAdapter(store, role, [
      DEMO_OUTLET_ID,
      DEMO_SECOND_OUTLET_ID,
    ]),
    // Swiggy's own instance of the same seam, with its own story: an
    // independent session and mailbox mean its states are seeded separately,
    // including Kanchrapara never having been connected at all.
    swiggySync: createMockAggregatorSyncAdapter(
      store,
      role,
      [DEMO_OUTLET_ID, DEMO_SECOND_OUTLET_ID],
      { channel: 'swiggy' },
    ),
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
export {
  accountFixtures,
  assignmentFixtures,
  DEMO_FORMER_ACCOUNT_ID,
  DEMO_GRILLER_ACCOUNT_ID,
  DEMO_HELPER_ACCOUNT_ID,
  DEMO_KANCHRAPARA_STAFF_ACCOUNT_ID,
  DEMO_PREP_COOK_ACCOUNT_ID,
  DEMO_RETURNER_ACCOUNT_ID,
  DEMO_RUNNER_ACCOUNT_ID,
  DEMO_TWO_OUTLETS_ACCOUNT_ID,
  PENDING_ACCOUNT_ID,
} from './fixtures/accounts'
export {
  MENU_ITEM_CLASSIC_ID,
  MENU_ITEM_MAYO_ID,
  MENU_ITEM_STUFFED_ID,
  menuCategoryFixtures,
  menuItemFixtures,
} from './fixtures/menu'
export { createDemoStore, DEMO_OUTLET_ID, type DemoStore } from './store'
