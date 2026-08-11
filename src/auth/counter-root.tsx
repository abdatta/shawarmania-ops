import { useMemo } from 'react'
import { Navigate } from 'react-router'

import { LoadingShell } from '@/components/ui/loading'
import { AdaptersContext } from '@/data-access/adapters-context'
import { createSupabaseAdapters } from '@/data-access/supabase-adapters'
import { CounterShell } from '@/features/counter/counter-shell'
import { NotFound } from '@/routes/not-found'
import { CounterDeviceContext } from '@/session/counter-context'

import { useRealSessionContext } from './real-session-context'
import { UnconfirmedSession } from './unconfirmed-session'

/**
 * The counter tablet's branch, and the only one a device session ever reaches.
 *
 * It is a sibling of `RealRoot` rather than a mode inside it, for the same
 * reason `CounterDeviceSession` is a separate type: a tablet has no name, no
 * assignments and no roles, so every question the role tree asks of a session is
 * one this branch cannot answer. Keeping them apart means the compiler refuses
 * the confusion instead of the reviewer catching it.
 *
 * There is **no account menu and no sign-out**. A tablet is not signed in, it is
 * set up, and the way out is an admin removing it — which takes effect at the
 * tablet's next request rather than by anything happening here. A sign-out
 * control would offer whoever is standing at the counter a way to strand the
 * hardware.
 */
export function CounterRoot() {
  const { state, revalidate } = useRealSessionContext()
  // A shift opening, ending or expiring changes what this tablet IS, not merely
  // what it is showing — so it re-resolves the session rather than keeping a
  // second copy of the answer beside it.
  const onShiftChanged = revalidate

  const counterSession = state.status === 'counter' ? state.device : null
  const adapters = useMemo(() => {
    try {
      return createSupabaseAdapters(counterSession)
    } catch {
      return null
    }
  }, [counterSession])

  if (state.status === 'loading') return <LoadingShell />
  if (state.status === 'unavailable') return <UnconfirmedSession onRetry={revalidate} />

  // Anyone who is not a tablet is sent back to the root, which knows where they
  // belong. A person who types /counter is not doing anything wrong; they are
  // simply not this.
  if (state.status !== 'counter') return <Navigate to="/" replace />

  if (!adapters) return <NotFound />

  return (
    <CounterDeviceContext.Provider value={state.device}>
      <AdaptersContext.Provider value={adapters}>
        <CounterShell shift={state.device.shift} onShiftChanged={onShiftChanged} />
      </AdaptersContext.Provider>
    </CounterDeviceContext.Provider>
  )
}
