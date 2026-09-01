import { useCallback, useEffect, useState } from 'react'

import type { Assignment } from '@/data-access/adapters'
import {
  currentUser,
  loadCounterShift,
  loadOwnAssignments,
  loadOwnCounterDevice,
  loadOwnProfile,
  onAuthChange,
  signOut,
  type Profile,
} from '@/data-access/auth'
import { forgetRememberedOutlets } from '@/features/remembered-outlet'
import { readCounterResume } from '@/outbox'
import type { CounterDeviceSession } from '@/session/counter-session'
import { onHumanSessionInvalid } from '@/session/human-session-invalid'
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
 *
 * **A tablet is asked about first, and it is never asked the person questions**
 * (counter-devices-and-offline). A counter tablet holds no profile and no
 * assignment, so resolving the person first and falling back would make a
 * machine a person who happens to be missing rows — which is precisely the
 * shape this change exists to remove. The two paths do not meet: if the caller
 * is a set-up tablet the resolution ends there, and `loadOwnProfile` is never
 * called at all.
 */

export type SessionEndReason = 'deactivated' | 'session_invalid'

export type RealSessionState =
  | { status: 'loading' }
  | { status: 'anonymous'; reason?: SessionEndReason }
  | { status: 'ready'; session: Session }
  /** The caller is a counter tablet. Never carries a `Session`, by construction. */
  | { status: 'counter'; device: CounterDeviceSession }
  /** A session probably exists, but we could not confirm it. Offer a retry, never a sign-out. */
  | { status: 'unavailable' }

/** How often an open app re-checks that it is still allowed to be open. */
export const REVALIDATE_INTERVAL_MS = 5 * 60 * 1000

type Resolution =
  | { kind: 'anonymous' }
  | { kind: 'session'; session: Session }
  | { kind: 'counter'; device: CounterDeviceSession }
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

  // The tablet question, first and on its own. A removed tablet reads no row,
  // so it lands here as "not a tablet" and then as a person with no profile,
  // which ends the session — the same answer removal is supposed to give.
  try {
    const device = await loadOwnCounterDevice(user.userId)
    if (device) {
      const shift = await loadCounterShift(device.deviceId)
      return { kind: 'counter', device: { kind: 'counter-device', device, shift } }
    }
  } catch {
    const resumed = await readCounterResume(user.userId).catch(() => ({
      status: 'missing' as const,
    }))
    if (resumed.status === 'ready') {
      const record = resumed.record
      return {
        kind: 'counter',
        device: {
          kind: 'counter-device',
          device: {
            deviceId: record.tablet.id,
            outletId: record.tablet.outletId,
            label: record.tablet.label,
          },
          shift: {
            id: record.shift.id,
            personId: record.shift.personId,
            outletId: record.shift.outletId,
            openedAt: record.shift.openedAt,
            businessDate: record.shift.businessDate,
            expiresAt: record.shift.expiresAt,
          },
          offlineResume: record,
        },
      }
    }
    return { kind: 'indeterminate' }
  }

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
        case 'counter':
          setState({ status: 'counter', device: resolution.device })
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
    window.addEventListener('online', apply)
    const interval = window.setInterval(() => void apply(), REVALIDATE_INTERVAL_MS)
    const stopAuthListener = onAuthChange(() => void apply())

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', apply)
      window.clearInterval(interval)
      stopAuthListener()
    }
  }, [tick])

  useEffect(
    () =>
      onHumanSessionInvalid(() => {
        void signOut().finally(() => {
          forgetRememberedOutlets()
          setState({ status: 'anonymous', reason: 'session_invalid' })
        })
      }),
    [],
  )

  const endSession = useCallback(async () => {
    await signOut()
    // The outlet somebody was looking at goes with their session
    // (owner-reaches-every-outlet, design D6). These are shared phones, and the
    // next person should open on their own shop rather than on the last one's.
    forgetRememberedOutlets()
    setState({ status: 'anonymous' })
  }, [])

  return { state, revalidate, endSession }
}
