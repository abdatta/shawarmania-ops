import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import type { Database } from './database.types'

/**
 * The only module in the app permitted to import the Supabase client
 * (enforced by eslint.config.js). Screens and features depend on the typed
 * adapter interfaces in this layer, never on Supabase directly — that seam is
 * what lets every surface be built against mocks first and made real later by
 * swapping an implementation rather than rewriting a screen.
 *
 * Only the public pair of environment variables is ever read here. The
 * service-role key bypasses RLS entirely and must never reach the browser;
 * anything needing it runs in an Edge Function.
 *
 * `Database` is generated from the migrations (`npm run db:types`) and
 * committed; CI fails if the schema and the committed types drift apart.
 * Every mock fixture in the UI programme is typed from the same source, so a
 * fixture the database could not actually serve fails to compile.
 */

let client: SupabaseClient<Database> | undefined

export function getSupabaseClient(): SupabaseClient<Database> {
  if (client) return client

  const url = import.meta.env.VITE_SUPABASE_URL
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

  if (!url || !anonKey) {
    throw new Error(
      'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy .env.example to .env and fill it in.',
    )
  }

  client = createClient<Database>(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  })
  return client
}
