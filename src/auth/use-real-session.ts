import { useCallback, useEffect, useState } from 'react'

import {
  currentClaims,
  currentUser,
  loadOwnProfile,
  onAuthChange,
  refreshClaims,
  signOut,
  type Profile,
  type TokenClaims,
} from '@/data-access/auth'
import type { Session } from '@/session/session'

/**
 * The real session, kept honest while the app is open.
 *
 * Two things can invalidate a session without the token expiring, and both are
 * detected here rather than being waited out (design D6, D7):
 *
 *  - **Deactivation.** Every policy in the schema is gated on
 *    `app_account_active()`, so a deactivated account cannot read its own
 *    profile row. A successful read that returns nothing IS the signal — no
 *    separate endpoint, no second mechanism to keep correct.
 *  - **Reassignment.** Role and outlet are baked into the access token at
 *    issue. If the profile disagrees with the token, one refresh normally
 *    settles it; if it does not, the session ends rather than rendering a
 *    shell the token cannot serve.
 *
 * A failed *request* is not either of those. Losing the network must never
 * sign anyone out, so a throw leaves the current state exactly as it was and
 * the next revalidation tries again.
 */

export type SessionEndReason = 'deactivated' | 'role-changed'

export type RealSessionState =
  | { status: 'loading' }
  | { status: 'anonymous'; reason?: SessionEndReason }
  | { status: 'ready'; session: Session }
  /** A session probably exists, but we could not confirm it. Offer a retry, never a sign-out. */
  | { status: 'unavailable' }

/** How often an open app re-checks that it is still allowed to be open. */
export const REVALIDATE_INTERVAL_MS = 5 * 60 * 1000

type Resolution =
  | { kind: 'anonymous' }
  | { kind: 'session'; session: Session }
  | { kind: 'ended'; reason: SessionEndReason }
  /** Nothing could be determined: change nothing at all. */
  | { kind: 'indeterminate' }

function claimsMatch(claims: TokenClaims | null, profile: Profile): boolean {
  if (!claims) return false
  return claims.role === profile.role && (claims.outletId ?? null) === profile.outlet_id
}

function sessionFrom(profile: Profile): Session {
  return {
    mode: 'real',
    userId: profile.id,
    role: profile.role,
    outletId: profile.outlet_id,
    displayName: profile.full_name,
  }
}

async function resolveSession(): Promise<Resolution> {
  let user
  try {
    user = await currentUser()
  } catch {
    return { kind: 'indeterminate' }
  }
  if (!user) return { kind: 'anonymous' }

  let profile: Profile | null
  try {
    profile = await loadOwnProfile(user.userId)
  } catch {
    return { kind: 'indeterminate' }
  }
  if (!profile) return { kind: 'ended', reason: 'deactivated' }

  let claims: TokenClaims | null
  try {
    claims = await currentClaims()
    if (!claimsMatch(claims, profile)) claims = await refreshClaims()
  } catch {
    return { kind: 'indeterminate' }
  }
  if (!claimsMatch(claims, profile)) return { kind: 'ended', reason: 'role-changed' }

  return { kind: 'session', session: sessionFrom(profile) }
}

export interface RealSession {
  state: RealSessionState
  /** Re-check now — used by the retry affordance and after signing in. */
  revalidate: () => void
  /** Deliberate sign-out, from the account menu. */
  endSession: () => Promise<void>
}

export function useRealSession(): RealSession {
  const [state, setState] = useState<RealSessionState>({ status: 'loading' })
  const [tick, setTick] = useState(0)
  const revalidate = useCallback(() => setTick((n) => n + 1), [])

  useEffect(() => {
    let cancelled = false

    const apply = async () => {
      const resolution = await resolveSession()
      if (cancelled) return

      switch (resolution.kind) {
        case 'session':
          setState({ status: 'ready', session: resolution.session })
          return
        case 'anonymous':
          setState({ status: 'anonymous' })
          return
        case 'ended':
          await signOut()
          if (!cancelled) setState({ status: 'anonymous', reason: resolution.reason })
          return
        case 'indeterminate':
          // Never downgrade a working session because one request failed: only
          // the very first attempt, which has nothing to preserve, turns into
          // a visible "could not confirm" with a retry.
          setState((previous) =>
            previous.status === 'loading' ? { status: 'unavailable' } : previous,
          )
          return
      }
    }

    void apply()

    const onVisible = () => {
      if (document.visibilityState === 'visible') void apply()
    }
    document.addEventListener('visibilitychange', onVisible)
    const interval = window.setInterval(() => void apply(), REVALIDATE_INTERVAL_MS)
    const stopAuthListener = onAuthChange(() => void apply())

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      window.clearInterval(interval)
      stopAuthListener()
    }
  }, [tick])

  const endSession = useCallback(async () => {
    await signOut()
    setState({ status: 'anonymous' })
  }, [])

  return { state, revalidate, endSession }
}
