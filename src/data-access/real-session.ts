import { getSupabaseClient } from './supabase'

/**
 * Whether a real Supabase session is persisted on this device. Used by the
 * demo-entry guard (docs/DEMO_MODE.md): a signed-in user must never wander
 * into demo mode silently.
 *
 * Reads through the client's own getSession() rather than poking at storage,
 * so a storage-format change in supabase-js cannot silently break the guard.
 * If the client cannot even be constructed (no env configured — true of the
 * demo-only deploy), there is no way a real session exists.
 */
export async function hasPersistedRealSession(): Promise<boolean> {
  try {
    const client = getSupabaseClient()
    const { data } = await client.auth.getSession()
    return data.session !== null
  } catch {
    return false
  }
}
