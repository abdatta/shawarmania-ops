import type { Assignment } from './adapters'
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

/**
 * An activation refusal. `invalid_code` covers every code-related reason on
 * purpose — unknown, expired, spent, superseded, deactivated account — because
 * telling them apart would confirm which codes and accounts exist.
 *
 * `weak_password` and `rate_limited` are the two that may be specific: each
 * describes the request rather than any account.
 */
export class ActivationError extends Error {
  constructor(
    readonly code: 'invalid_code' | 'weak_password' | 'rate_limited' | 'unavailable',
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

/**
 * The person's own assignments — where they work and as what.
 *
 * Read from the table on every revalidation rather than decoded from the
 * token, because since multi-outlet-people the token carries nothing about
 * authority (owner, 2026-07-29). That is what makes a granted or ended
 * assignment bite at the next request with nothing to reissue — and it is why
 * `refreshClaims` and the claim-comparison it served are gone.
 *
 * Both live and ended rows come back: the client decides what is live, and
 * "you stopped working at Kanchrapara in March" is a thing a person's own
 * screen may want to say.
 */
export async function loadOwnAssignments(userId: string): Promise<Assignment[]> {
  const { data, error } = await getSupabaseClient()
    .from('assignments')
    .select('id, role, outlet_id, started_on, ended_on')
    .eq('person_id', userId)
    .order('started_on', { ascending: false })
  if (error) throw error
  return (data ?? []).map((row) => ({
    id: row.id,
    role: row.role,
    outletId: row.outlet_id,
    startedOn: row.started_on,
    endedOn: row.ended_on,
  }))
}

/** Fires whenever supabase-js gains or loses a session in this tab. */
export function onAuthChange(listener: () => void): () => void {
  const { data } = getSupabaseClient().auth.onAuthStateChange(() => listener())
  return () => data.subscription.unsubscribe()
}

/** The one message every code failure gets, and the reason it is one message. */
const DEAD_CODE =
  'This link is no longer usable — it may have expired, or already been used. Ask your manager for a new one.'

const TOO_MANY =
  'Too many activation attempts from this connection. Wait a few minutes and try again.'

function activationFailure(reason: string | null): ActivationError {
  if (reason === 'weak_password') {
    return new ActivationError(
      'weak_password',
      `Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`,
    )
  }
  if (reason === 'rate_limited') return new ActivationError('rate_limited', TOO_MANY)
  if (reason === 'invalid_code') return new ActivationError('invalid_code', DEAD_CODE)
  return new ActivationError('unavailable', 'Could not activate right now. Try again in a moment.')
}

/**
 * Resolve a one-time code to the address its account will sign in with, so the
 * person can confirm it is theirs rather than type it.
 *
 * Safe because the code is the key: whoever can ask has already proven
 * possession of a live, single-use code for that one account, so the only
 * address they can learn is the one they already hold a code for. Consumes
 * nothing — somebody who says "that is not my email" leaves the code exactly as
 * redeemable as they found it.
 */
export async function previewInvite(code: string): Promise<string> {
  const { data, error } = await getSupabaseClient().functions.invoke<{ email?: string }>(
    'redeem-invite',
    { body: { action: 'preview', code } },
  )
  if (error) throw activationFailure(await failureCode(error))
  if (!data?.email) throw activationFailure('invalid_code')
  return data.email
}

/**
 * Redeem a one-time code and set a password. Requires no session — the point
 * is that the person does not have one yet — and returns none: they sign in
 * afterwards through the ordinary path, so there is exactly one way a session
 * is ever minted (design D5).
 *
 * Takes no address. The code identifies the account, which is what leaves a
 * password as the only thing anybody types.
 */
export async function redeemInvite(code: string, password: string): Promise<void> {
  if (password.length < MIN_PASSWORD_LENGTH) throw activationFailure('weak_password')

  const { error } = await getSupabaseClient().functions.invoke('redeem-invite', {
    body: { action: 'redeem', code, password },
  })
  if (error) throw activationFailure(await failureCode(error))
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
