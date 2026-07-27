import { getSupabaseClient } from '../supabase'
import type { DataAdapters } from '../adapters'
import { createSupabaseOutletsAdapter } from './outlets'

/**
 * The real-adapter factory the real session tree (#4) will provide. The demo
 * tree must never import this module — eslint enforces it, and the demo-scope
 * tripwire in getSupabaseClient makes a slip loud rather than silent.
 */
export function createSupabaseAdapters(): DataAdapters {
  const client = getSupabaseClient()
  return {
    outlets: createSupabaseOutletsAdapter(client),
  }
}
