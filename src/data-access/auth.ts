import type { Tables } from './database.types'
import { getSupabaseClient } from './supabase'

/**
 * Authentication, as opposed to data access.
 *
 * This module is deliberately NOT behind the adapter seam, and that is not an
 * oversight. The seam exists so a screen can be built against mocks and made
 * real later; authentication has no demo counterpart to be built against —
 * demo mode is authentication-free by design (docs/DEMO_MODE.md), which is
 * exactly what lets it exist without a backend. A mock sign-in would be a
 * fiction with nothing on the other side of it.
 *
 * It lives in src/data-access/ because it is the layer permitted to hold the
 * Supabase client, and nowhere else may.
 */

export type Profile = Tables<'profiles'>

export interface AuthedUser {
  userId: string
  email: string | null
}

/** What the access token actually claims — the scope RLS will enforce. */
export interface TokenClaims {
  role: string | null
  outletId: string | null
}

/** A sign-in refusal the screen can phrase for a person. */
export class SignInError extends Error {
  constructor(
    readonly code: 'invalid_credentials' | 'unavailable',
    message: string,
  ) {
    super(message)
    this.name = 'SignInError'
  }
}

/** An activation refusal. `invalid_code` covers every reason on purpose. */
export class ActivationError extends Error {
  constructor(
    readonly code: 'invalid_code' | 'weak_password' | 'unavailable',
    message: string,
  ) {
    super(message)
    this.name = 'ActivationError'
  }
}

export const MIN_PASSWORD_LENGTH = 10

export async function signIn(email: string, password: string): Promise<AuthedUser> {
  const { data, error } = await getSupabaseClient().auth.signInWithPassword({
    email: email.trim(),
    password,
  })
  if (error || !data.user) {
    // One message for a wrong address and a wrong password alike: telling them
    // apart would confirm which addresses have accounts.
    throw new SignInError('invalid_credentials', 'That email or password is not right.')
  }
  return { userId: data.user.id, email: data.user.email ?? null }
}

export async function signOut(): Promise<void> {
  await getSupabaseClient().auth.signOut()
}

export async function currentUser(): Promise<AuthedUser | null> {
  const { data } = await getSupabaseClient().auth.getSession()
  const user = data.session?.user
  return user ? { userId: user.id, email: user.email ?? null } : null
}

/**
 * The person's own profile row, or null.
 *
 * Null is meaningful, not merely empty: every policy in the schema is gated on
 * `app_account_active()`, so a deactivated account cannot read its own profile.
 * "I cannot see myself" IS the deactivation signal, which is why the client
 * needs no separate am-I-still-allowed endpoint (design D6).
 */
export async function loadOwnProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await getSupabaseClient()
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle()
  if (error) throw error
  return data
}

function decodeClaims(accessToken: string): TokenClaims | null {
  const payload = accessToken.split('.')[1]
  if (!payload) return null
  try {
    const json = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(atob(payload.replace(/-/g, '+').replace(/_/g, '/')), (c) =>
          c.charCodeAt(0),
        ),
      ),
    ) as Record<string, unknown>
    return {
      role: typeof json['app_role'] === 'string' ? json['app_role'] : null,
      outletId: typeof json['app_outlet_id'] === 'string' ? json['app_outlet_id'] : null,
    }
  } catch {
    return null
  }
}

/** The claims on the token currently in hand, or null when there is no session. */
export async function currentClaims(): Promise<TokenClaims | null> {
  const { data } = await getSupabaseClient().auth.getSession()
  return data.session ? decodeClaims(data.session.access_token) : null
}

/**
 * Force a new access token, re-running the database's access-token hook. The
 * one move that resolves a stale role or outlet claim after a reassignment
 * (design D7). Returns the claims on the new token, or null if it failed.
 */
export async function refreshClaims(): Promise<TokenClaims | null> {
  const { data, error } = await getSupabaseClient().auth.refreshSession()
  if (error || !data.session) return null
  return decodeClaims(data.session.access_token)
}

/** Fires whenever supabase-js gains or loses a session in this tab. */
export function onAuthChange(listener: () => void): () => void {
  const { data } = getSupabaseClient().auth.onAuthStateChange(() => listener())
  return () => data.subscription.unsubscribe()
}

/**
 * Redeem a one-time code and set a password. Requires no session — the point
 * is that the person does not have one yet — and returns none: they sign in
 * afterwards through the ordinary path, so there is exactly one way a session
 * is ever minted (design D5).
 */
export async function redeemInvite(email: string, code: string, password: string): Promise<void> {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new ActivationError(
      'weak_password',
      `Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`,
    )
  }

  const { error } = await getSupabaseClient().functions.invoke('redeem-invite', {
    body: { email: email.trim(), code, password },
  })
  if (!error) return

  const code_ = await failureCode(error)
  if (code_ === 'weak_password') {
    throw new ActivationError(
      'weak_password',
      `Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`,
    )
  }
  if (code_ === 'invalid_code') {
    throw new ActivationError(
      'invalid_code',
      'That code is not valid — it may have expired or already been used. Ask your manager for a new one.',
    )
  }
  throw new ActivationError('unavailable', 'Could not activate right now. Try again in a moment.')
}

/**
 * The machine-readable reason a function refused, dug out of the Response
 * supabase-js attaches to its error. Anything unrecognised stays unrecognised
 * rather than being shown to a person verbatim.
 */
export async function failureCode(error: unknown): Promise<string | null> {
  const context = (error as { context?: unknown }).context
  if (!(context instanceof Response)) return null
  try {
    const body = (await context.clone().json()) as { error?: unknown }
    return typeof body.error === 'string' ? body.error : null
  } catch {
    return null
  }
}
