import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'

import { useChangeGate } from '@/change-gates/context'
import { LoadingShell } from '@/components/ui/loading'
import { storedSessionIsDeviceNow } from '@/data-access/auth'
import { tabletKind, type CounterDevice } from '@/session/counter-session'

import type { RealSessionState } from './use-real-session'
import { UnconfirmedSession } from './unconfirmed-session'

/**
 * A set-up tablet opens its own branch and nothing else
 * (a-tablet-keeps-its-login, design D1).
 *
 * The counter laptop at Kalyani Cafe kept being set up again under new names.
 * `/sign-in` and `/activate` drew their forms on it, a staff member signed in
 * there to mark attendance, which replaced the tablet's session in the
 * browser's one Auth slot, and signing out left the laptop unregistered. Each
 * screen used to redirect a tablet in its own body, so an unguarded screen was
 * the default.
 *
 * **Deny by default.** A tablet's home is `/counter` or `/kitchen`, and it may
 * open that home and every path beneath it except `/counter/setup`, which is
 * setup rather than the counter. Every other address, including one added after
 * this, sends it home. A counter page added at `/counter/expenses` is open to a
 * counter tablet by where it lives, with no edit here, and closed to a kitchen
 * tablet and to people. **Tablet pages live under the tablet's home.**
 *
 * With `a-tablet-keeps-its-login` off it renders its children and nothing else,
 * which is today.
 */

const SETUP_PATH = '/counter/setup'

/** Where a tablet of this kind lives. */
export function homeFor(device: Pick<CounterDevice, 'kind'>): '/counter' | '/kitchen' {
  return tabletKind(device) === 'kitchen' ? '/kitchen' : '/counter'
}

function within(pathname: string, home: string): boolean {
  return pathname === home || pathname.startsWith(`${home}/`)
}

/** The one place the addresses a tablet may open are written. */
export function mayOpen(device: Pick<CounterDevice, 'kind'>, pathname: string): boolean {
  if (within(pathname, SETUP_PATH)) return false
  return within(pathname, homeFor(device))
}

/** Within either tablet branch, whose own screens draw their own wait. */
function withinATabletBranch(pathname: string): boolean {
  return (
    !within(pathname, SETUP_PATH) && (within(pathname, '/counter') || within(pathname, '/kitchen'))
  )
}

export function TabletBoundary({
  state,
  onRetry,
  children,
}: {
  state: RealSessionState
  onRetry: () => void
  children: ReactNode
}) {
  const on = useChangeGate('a-tablet-keeps-its-login')
  const { pathname } = useLocation()

  if (!on) return children

  if (state.status === 'counter') {
    const device = state.device.device
    return mayOpen(device, pathname) ? children : <Navigate to={homeFor(device)} replace />
  }

  // Not known yet, on a browser whose stored session is already a tablet's: the
  // page asked for may be one a tablet must never draw, even for a moment, so it
  // waits. The tablet's own branch draws its own wait, as before.
  if (
    (state.status === 'loading' || state.status === 'unavailable') &&
    !withinATabletBranch(pathname) &&
    storedSessionIsDeviceNow()
  ) {
    return state.status === 'loading' ? <LoadingShell /> : <UnconfirmedSession onRetry={onRetry} />
  }

  return children
}
