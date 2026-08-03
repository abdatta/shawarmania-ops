import { getSupabaseClient } from '../supabase'
import type { DataAdapters } from '../adapters'
import { createAddressLookupAdapter } from './address-lookup'
import { createSupabaseAccountsAdapter } from './accounts'
import { createSupabaseAttendanceAdapter } from './attendance'
import { createSupabaseBillingAdapter } from './billing'
import { createSupabaseCustomersAdapter } from './customers'
import { createSupabaseManualLedgerAdapter } from './manual-ledger'
import { createSupabaseMenuAdapter } from './menu'
import {
  createSupabaseDailyCashAdapter,
  createSupabaseExpensesAdapter,
  createSupabaseInventoryAdapter,
} from './operations'
import { createSupabaseOutletsAdapter } from './outlets'
import { createSupabaseAlertsAdapter, createSupabaseInsightsAdapter } from './oversight'

/**
 * The real-adapter factory the real session tree provides. The demo tree must
 * never import this module — eslint enforces it, and the demo-scope tripwire
 * in getSupabaseClient makes a slip loud rather than silent.
 */
export function createSupabaseAdapters(): DataAdapters {
  const client = getSupabaseClient()
  return {
    outlets: createSupabaseOutletsAdapter(client),
    accounts: createSupabaseAccountsAdapter(client),
    attendance: createSupabaseAttendanceAdapter(client),
    // Not connected yet, and says so: the menu surfaces are `demo`-gated and
    // #10/#11 replace this. See supabase-adapters/menu.ts.
    menu: createSupabaseMenuAdapter(),
    // Likewise not connected: #9 brings the enrolled device and the outbox, #10
    // the settlement path. See supabase-adapters/billing.ts.
    billing: createSupabaseBillingAdapter(),
    // The exception among the not-yet-connected adapters: the global customer
    // directory is REAL from today, because the boundary that protects it is.
    // The billing surfaces that call it are still `demo`-gated (#31, #10).
    customers: createSupabaseCustomersAdapter(client),
    // Nor these: #11 makes stock and expenses real, #12 the cash close.
    // See supabase-adapters/operations.ts.
    inventory: createSupabaseInventoryAdapter(),
    expenses: createSupabaseExpensesAdapter(),
    dailyCash: createSupabaseDailyCashAdapter(),
    // Alerts are `demo`-gated, so nothing calls this one. Insights is the
    // exception: `owner-dashboard` is `live` and does call it — and `null` is
    // its honest answer until #13. See supabase-adapters/oversight.ts.
    alerts: createSupabaseAlertsAdapter(),
    insights: createSupabaseInsightsAdapter(),
    // Real from the day it ships, unlike the three above it: the manual ledger
    // is a stopgap precisely because nothing else records August (#36), so a
    // stub would defeat the point. It goes when #12 carries its rows across.
    manualLedger: createSupabaseManualLedgerAdapter(client),
    // Takes no client: it holds no credential and reaches no Supabase service.
    // It is here because this is the layer permitted to do I/O, and a screen
    // fetching for itself is exactly what the seam exists to prevent.
    addressLookup: createAddressLookupAdapter(),
  }
}
