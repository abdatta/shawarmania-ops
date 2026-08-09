import { FunctionsFetchError, isAuthRetryableFetchError } from '@supabase/supabase-js'

import type { Assignment } from './adapters'
import type { Tables } from './database.types'
import type { CounterDevice, CounterShift } from '@/session/counter-session'
import { getSupabaseClient } from './supabase'
import { authAliasToUsername, usernameToAuthAlias } from '../../shared/username'

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
  username: string | null
}

/** A sign-in refusal the screen can phrase for a person. */
export class SignInError extends Error {
  constructor(
    readonly code: 'invalid_credentials' | 'unavailable' | 'unreachable',
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
    readonly code:
      'invalid_code' | 'username_mismatch' | 'weak_password' | 'rate_limited' | 'unavailable',
    message: string,
  ) {
    super(message)
    this.name = 'ActivationError'
  }
}

export const MIN_PASSWORD_LENGTH = 10

const INVALID_CREDENTIALS = 'Those sign-in details are not right.'
const UNREACHABLE =
  "Could not reach Shawarmania. Check this device's internet connection and try again."

/**
 * Positive transport evidence only. Supabase also uses a retryable Auth error
 * for received 5xx responses, so the type alone is not enough: status 0 (or a
 * missing status on an equivalent provider object) means no HTTP response.
 * Edge Function fetch failures are already a dedicated no-response type.
 */
function isUnreachable(error: unknown): boolean {
  if (error instanceof FunctionsFetchError) return true
  if (!isAuthRetryableFetchError(error)) return false
  return error.status == null || error.status === 0
}

function signInFailure(error: unknown): SignInError {
  return isUnreachable(error)
    ? new SignInError('unreachable', UNREACHABLE)
    : new SignInError('invalid_credentials', INVALID_CREDENTIALS)
}

function accountEmail(input: string): string | null {
  const email = input.trim().toLowerCase()
  if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return null
  }
  return email
}

export async function signIn(identifier: string, password: string): Promise<AuthedUser> {
  const authAlias = usernameToAuthAlias(identifier)
  const email = accountEmail(identifier)
  if (!authAlias && !email) {
    throw new SignInError('invalid_credentials', INVALID_CREDENTIALS)
  }

  const client = getSupabaseClient()
  if (authAlias) {
    const { data, error } = await client.auth.signInWithPassword({
      email: authAlias,
      password,
    })
    if (!error && data.user) {
      return { userId: data.user.id, username: authAliasToUsername(data.user.email) }
    }
    if (error) throw signInFailure(error)
  } else {
    const { data, error } = await client.functions.invoke<{
      accessToken?: string
      refreshToken?: string
    }>('email-sign-in', {
      body: { email, password },
    })
    if (!error && data?.accessToken && data.refreshToken) {
      const { data: sessionData, error: sessionError } = await client.auth.setSession({
        access_token: data.accessToken,
        refresh_token: data.refreshToken,
      })
      if (!sessionError && sessionData.user) {
        return {
          userId: sessionData.user.id,
          username: authAliasToUsername(sessionData.user.email),
        }
      }
      if (sessionError) throw signInFailure(sessionError)
    }
    if (error) throw signInFailure(error)
  }

  // One message for an unknown identifier and a wrong password alike.
  throw new SignInError('invalid_credentials', INVALID_CREDENTIALS)
}

export async function signOut(): Promise<void> {
  await getSupabaseClient().auth.signOut()
}

export async function currentUser(): Promise<AuthedUser | null> {
  const { data } = await getSupabaseClient().auth.getSession()
  const user = data.session?.user
  return user ? { userId: user.id, username: authAliasToUsername(user.email) } : null
}

/**
 * The tablet this session IS, or null because this session is a person.
 *
 * Asked **before** the profile, on every resolution, and that order is the whole
 * of the machine/person separation (counter-devices-and-offline). A tablet has
 * no profile and no assignment: it used to have both, synthetically, and every
 * policy that asked "is this an active member of staff who bills here" answered
 * yes to a piece of hardware. Resolving the person first and falling back would
 * reintroduce that by making a device a person who happens to be missing rows.
 *
 * Null is not ambiguous here. A tablet reads its own `counter_devices` row and
 * no other, and a removed one reads nothing at all, so an absent row means "not a
 * tablet, or not one any more" — and both of those are answered the same way, by
 * refusing to open a counter.
 *
 * **What a tablet with no live shift can still reach is its own row and its own
 * outlet, and that is the whole list.** Both are needed to render the screen that
 * asks for a shift. Everything else — the menu, bills, customers, the ledger, and
 * since the review pass its own past shifts — goes through
 * `app_counter_shift_outlet()` and answers nothing without one.
 */
export async function loadOwnCounterDevice(userId: string): Promise<CounterDevice | null> {
  const { data, error } = await getSupabaseClient()
    .from('counter_devices')
    .select('id, outlet_id, label, last_seen_at, last_reported_unsent')
    .eq('id', userId)
    .is('removed_at', null)
    .maybeSingle()
  if (error) throw error
  return data
    ? {
        deviceId: data.id,
        outletId: data.outlet_id,
        label: data.label,
      }
    : null
}

/**
 * The shift live on this tablet right now, or null because nobody has opened
 * one.
 *
 * Live means both halves: not ended, and not past the outlet's cutover. The
 * expiry is a stored timestamp rather than a job that runs at 04:00, so this
 * question is answerable by a `where` clause and there is nothing scheduled to
 * fail.
 */
export async function loadCounterShift(deviceId: string): Promise<CounterShift | null> {
  const { data, error } = await getSupabaseClient()
    .from('counter_shifts')
    .select('id, person_id, outlet_id, opened_at, business_date, expires_at')
    .eq('device_id', deviceId)
    .is('ended_at', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()
  if (error) throw error
  return data
    ? {
        id: data.id,
        personId: data.person_id,
        outletId: data.outlet_id,
        openedAt: data.opened_at,
        businessDate: data.business_date,
        expiresAt: data.expires_at,
      }
    : null
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

function activationFailure(reason: string | null, error?: unknown): ActivationError {
  if (isUnreachable(error)) return new ActivationError('unavailable', UNREACHABLE)
  if (reason === 'weak_password') {
    return new ActivationError(
      'weak_password',
      `Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`,
    )
  }
  if (reason === 'rate_limited') return new ActivationError('rate_limited', TOO_MANY)
  if (reason === 'username_mismatch') {
    return new ActivationError(
      'username_mismatch',
      'Type the username shown above, or ask your manager to correct it.',
    )
  }
  if (reason === 'invalid_code') return new ActivationError('invalid_code', DEAD_CODE)
  return new ActivationError('unavailable', 'Could not activate right now. Try again in a moment.')
}

/**
 * Resolve a one-time code to its product username so the activation screen can
 * show it before asking the person to type it back.
 *
 * Safe because the code is the key: whoever can ask has already proven
 * possession of a live, single-use code for that one account, so the only
 * username they can learn is the one they already hold a code for. Previewing
 * consumes nothing.
 */
export async function previewInvite(code: string): Promise<string> {
  const { data, error } = await getSupabaseClient().functions.invoke<{ username?: string }>(
    'redeem-invite',
    { body: { action: 'preview', code } },
  )
  if (error) throw activationFailure(await failureCode(error), error)
  if (!data?.username) throw activationFailure('invalid_code')
  return data.username
}

/**
 * Redeem a one-time code and set a password. Requires no session — the point
 * is that the person does not have one yet — and returns none: they sign in
 * afterwards through the ordinary path, so there is exactly one way a session
 * is ever minted (design D5).
 *
 * The code identifies the account; the typed username confirms the handover
 * before the password is changed.
 */
export async function redeemInvite(
  code: string,
  username: string,
  password: string,
): Promise<void> {
  if (password.length < MIN_PASSWORD_LENGTH) throw activationFailure('weak_password')

  const { error } = await getSupabaseClient().functions.invoke('redeem-invite', {
    body: { action: 'redeem', code, username, password },
  })
  if (error) throw activationFailure(await failureCode(error), error)
}

/**
 * A tablet setup refusal.
 *
 * `invalid_code` covers every code-related reason for the same reason activation
 * does: telling them apart would confirm which codes exist. `tablet_exists` is
 * allowed to be specific because it describes the outlet rather than the code,
 * to somebody who is holding a live code for that outlet and therefore already
 * knows which one it is.
 */
export class CounterSetupError extends Error {
  constructor(
    readonly code: 'invalid_code' | 'tablet_exists' | 'unavailable',
    message: string,
  ) {
    super(message)
    this.name = 'CounterSetupError'
  }
}

const DEAD_SETUP_CODE =
  'That setup code did not work. It may have expired or already been used. Ask for a new one.'

/**
 * Turn a setup code into a device session on this tablet.
 *
 * Requires no session, because a tablet that has never been set up does not have
 * one, and **no password is ever typed here** — that is the entire point of the
 * code. The credential the server returns belongs to a machine, is random, and
 * is used once, immediately, to sign in; only the session survives.
 *
 * There is still exactly one way a session is minted, which is the same property
 * `redeemInvite` protects.
 */
export async function setUpCounterDevice(code: string): Promise<void> {
  const client = getSupabaseClient()
  const { data, error } = await client.functions.invoke<{ email?: string; password?: string }>(
    'counter-setup',
    { body: { code } },
  )

  if (error) {
    if (isUnreachable(error)) throw new CounterSetupError('unavailable', UNREACHABLE)
    const reason = await failureCode(error)
    if (reason === 'tablet_exists') {
      throw new CounterSetupError(
        'tablet_exists',
        'That outlet already has a tablet set up. Remove it first, then use this code.',
      )
    }
    throw new CounterSetupError('invalid_code', DEAD_SETUP_CODE)
  }
  if (!data?.email || !data.password) throw new CounterSetupError('invalid_code', DEAD_SETUP_CODE)

  const { error: signInError } = await client.auth.signInWithPassword({
    email: data.email,
    password: data.password,
  })
  if (signInError) {
    // The code is spent by now. Say so plainly rather than blaming the code: the
    // tablet row exists, and an admin has to remove it and issue another.
    throw new CounterSetupError(
      'unavailable',
      'This tablet was set up but could not sign in. Ask an admin to remove it and try again.',
    )
  }
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
