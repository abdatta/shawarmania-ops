import { getSupabaseClient } from '../supabase'
import type { DataAdapters } from '../adapters'
import { createAddressLookupAdapter } from './address-lookup'
import {
  createSupabaseAggregatorSyncAdapter,
  createSupabaseSwiggySyncAdapter,
} from './aggregator-sync'
import { createSupabaseAccountsAdapter } from './accounts'
import { createSupabaseAttendanceAdapter } from './attendance'
import { createSupabaseBillingAdapter } from './billing'
import { createSupabaseCashDrawerAdapter } from './cash-drawer'
import { createSupabaseCounterAdapter } from './counter'
import { createSupabaseCustomersAdapter } from './customers'
import { createSupabaseExpenseCategoriesAdapter } from './expense-categories'
import { createSupabaseLedgerStatementAdapter } from './ledger-statement'
import { createSupabaseManualLedgerAdapter } from './manual-ledger'
import { createSupabaseMenuAdapter } from './menu'
import {
  createSupabaseDailyCashAdapter,
  createSupabaseExpensesAdapter,
  createSupabaseInventoryAdapter,
} from './operations'
import { createSupabaseOutletsAdapter } from './outlets'
import { createSupabaseAlertsAdapter, createSupabaseInsightsAdapter } from './oversight'
import type { CounterDeviceSession } from '@/session/counter-session'

/**
 * The real-adapter factory the real session tree provides. The demo tree must
 * never import this module — eslint enforces it, and the demo-scope tripwire
 * in getSupabaseClient makes a slip loud rather than silent.
 */
export function createSupabaseAdapters(
  counterSession: CounterDeviceSession | null = null,
): DataAdapters {
  const client = getSupabaseClient()
  return {
    outlets: createSupabaseOutletsAdapter(client),
    aggregatorSync: createSupabaseAggregatorSyncAdapter(client),
    swiggySync: createSupabaseSwiggySyncAdapter(client),
    accounts: createSupabaseAccountsAdapter(client),
    attendance: createSupabaseAttendanceAdapter(client),
    menu: createSupabaseMenuAdapter(client),
    // Real tablet sessions receive the durable local-first settlement path;
    // personal sessions receive the same authorised manager reads and writes
    // without opening a local queue.
    billing: createSupabaseBillingAdapter(client, counterSession),
    // Real from the day it ships, like the customer directory and for the same
    // reason: the tablets, the handshake and the shift are what #9 is, and a
    // stub would leave the boundary untested by the only screens that use it.
    counter: createSupabaseCounterAdapter(client),
    // The exception among the not-yet-connected adapters: the global customer
    // directory is REAL from today, because the boundary that protects it is.
    // The billing surfaces that call it are still `demo`-gated (#31, #10).
    customers: createSupabaseCustomersAdapter(client),
    // Nor these. Stock is shelved (openspec/todos/inventory-is-shelved.md),
    // expenses are already live through the manual ledger, and the cash close is
    // removed rather than made real by `cash-is-counted-not-closed` (#11).
    // See supabase-adapters/operations.ts.
    inventory: createSupabaseInventoryAdapter(),
    expenses: createSupabaseExpensesAdapter(),
    expenseCategories: createSupabaseExpenseCategoriesAdapter(client),
    dailyCash: createSupabaseDailyCashAdapter(),
    // Alerts are `demo`-gated, so nothing calls this one. Insights is the
    // exception: `owner-dashboard` is `live` and does call it — and `null` is
    // its honest answer until #13. See supabase-adapters/oversight.ts.
    alerts: createSupabaseAlertsAdapter(),
    insights: createSupabaseInsightsAdapter(),
    // Real from the day it ships, unlike the three above it: the manual ledger
    // is a stopgap precisely because nothing else records August (#36), so a
    // stub would defeat the point. It goes when `retire-the-manual-ledger` (#12)
    // carries its rows across.
    manualLedger: createSupabaseManualLedgerAdapter(client),
    // Real from the day they ship, and both `live` in the registry (#11). The
    // drawer never had a live surface to be a stub for: `daily_cash_records` has
    // never held a production row, so there is no previous behaviour to preserve
    // and nothing to gate a stub behind.
    //
    // Neither adapter computes a figure the database computes. Every drawer write
    // is a `security definer` command, because the opening, the expected total
    // and the difference are derived inside the writing transaction and a client
    // must not be able to supply them.
    cashDrawer: createSupabaseCashDrawerAdapter(client),
    ledgerStatement: createSupabaseLedgerStatementAdapter(client),
    // Takes no client: it holds no credential and reaches no Supabase service.
    // It is here because this is the layer permitted to do I/O, and a screen
    // fetching for itself is exactly what the seam exists to prevent.
    addressLookup: createAddressLookupAdapter(),
  }
}
