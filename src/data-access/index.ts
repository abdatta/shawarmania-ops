/**
 * Data-access layer — a typed adapter interface per domain area, with two
 * implementations: SupabaseAdapter (real data) and MockAdapter (fixtures typed
 * from the generated schema types).
 *
 * This is the only layer that imports the Supabase client. A screen that
 * imports it directly has broken the seam — that is a review failure, not a
 * style preference.
 *
 * Screens consume the seam through this surface: the interfaces in
 * `adapters.ts` and the context in `adapters-context.ts`. The factories are
 * deliberately NOT re-exported here — the demo tree imports the mock factory,
 * the real tree imports the Supabase factory, and no screen imports either.
 */

export { getSupabaseClient } from './supabase'
export type { DataAdapters, OutletsAdapter } from './adapters'
export { AdaptersContext, useAdapters } from './adapters-context'
export type { Tables, Database } from './database.types'
