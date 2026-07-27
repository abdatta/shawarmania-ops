import { getSupabaseClient } from '../supabase'
import type { DataAdapters } from '../adapters'
import { createSupabaseAccountsAdapter } from './accounts'
import { createSupabaseAttendanceAdapter } from './attendance'
import { createSupabaseEmployeesAdapter } from './employees'
import { createSupabaseOutletsAdapter } from './outlets'

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
    employees: createSupabaseEmployeesAdapter(client),
  }
}
