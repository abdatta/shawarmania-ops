import { useCallback, useEffect, useState } from 'react'

import type { Assignment } from '@/data-access/adapters'
import {
  currentUser,
  loadOwnAssignments,
  loadOwnProfile,
  onAuthChange,
  signOut,
  type Profile,
} from '@/data-access/auth'
import { deriveSessionScope, type Session } from '@/session/session'

/**
 * The real session, kept honest while the app is open.
 *
 * **Deactivation** is still detected here rather than waited out (design D6):
 * every policy in the schema is gated on `app_account_active()`, so a
 * deactivated account cannot read its own profile row. A successful read that
 * returns nothing IS the signal — no separate endpoint, no second mechanism to
 * keep correct.
 *
 * **Reassignment no longer ends a session** (multi-outlet-people). Role and
 * outlet used to be baked into the access token, so a changed profile and a
 * stale token had to be reconciled or the session dropped. Nothing about
 * authority is in the token now: the assignments are re-read on the same cycle
 * as the profile, and a grant or an ending simply shows up. The database
 * refuses the writes immediately regardless, which is the boundary that
 * matters — the client is catching up, not enforcing.
 *
 * A failed *request* is neither of those. Losing the network must never sign
 * anyone out, so a throw leaves the current state exactly as it was and the
 * next revalidation tries again.
 */

export type SessionEndReason = 'deactivated'

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

function sessionFrom(profile: Profile, assignments: Assignment[]): Session {
  return {
    mode: 'real',
    userId: profile.id,
    assignments,
    ...deriveSessionScope(assignments),
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
  let assignments: Assignment[]
  try {
    // Together rather than in sequence: they are read on every revalidation and
    // a session that had one without the other would render a shell for
    // authority it could not name.
    ;[profile, assignments] = await Promise.all([
      loadOwnProfile(user.userId),
      loadOwnAssignments(user.userId),
    ])
  } catch {
    return { kind: 'indeterminate' }
  }
  if (!profile) return { kind: 'ended', reason: 'deactivated' }

  // No assignment is a real state — hired and not yet placed, or placed
  // nowhere any more — and it is NOT a reason to end the session. The person
  // is still signed in and still themselves; there is simply nothing for them
  // to do, which the shell says rather than an empty screen implying.
  return { kind: 'session', session: sessionFrom(profile, assignments) }
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
