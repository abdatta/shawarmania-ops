/**
 * Data-access layer — a typed adapter interface per domain area, with two
 * implementations: SupabaseAdapter (real data) and MockAdapter (fixtures typed
 * from the generated schema types).
 *
 * This is the only layer that imports the Supabase client. A screen that
 * imports it directly has broken the seam — that is a review failure, not a
 * style preference.
 *
 * The adapter interfaces themselves land with demo-mode-and-app-shell (#3),
 * once there is a schema (#2) to type them against.
 */

export { getSupabaseClient } from './supabase'
