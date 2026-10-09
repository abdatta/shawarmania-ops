import { useMemo } from 'react'
import { Navigate } from 'react-router'

import { LoadingShell } from '@/components/ui/loading'
import { AdaptersContext } from '@/data-access/adapters-context'
import { createSupabaseAdapters } from '@/data-access/supabase-adapters'
import { KitchenShell } from '@/features/kitchen/kitchen-shell'
import { NotFound } from '@/routes/not-found'
import { CounterDeviceContext } from '@/session/counter-context'
import { tabletKind } from '@/session/counter-session'

import { useRealSessionContext } from './real-session-context'
import { UnconfirmedSession } from './unconfirmed-session'

/**
 * The kitchen tablet's branch (#70), the counter's sibling.
 *
 * The same machine session and the same "no sign-out" rule as `CounterRoot`. A
 * counter that lands here is sent to `/counter`, and a person to the root, so
 * the URL a tablet was bookmarked at never decides what it is: its kind does.
 * No outbox runtime is mounted — a kitchen holds no local work.
 */
export function KitchenRoot() {
  const { state, revalidate } = useRealSessionContext()
  const session = state.status === 'counter' ? state.device : null
  const adapters = useMemo(() => {
    try {
      return createSupabaseAdapters(null)
    } catch {
      return null
    }
  }, [])

  if (state.status === 'loading') return <LoadingShell />
  if (state.status === 'unavailable') return <UnconfirmedSession onRetry={revalidate} />
  if (!session) return <Navigate to="/" replace />
  if (tabletKind(session.device) !== 'kitchen') return <Navigate to="/counter" replace />
  if (!adapters) return <NotFound />

  return (
    <CounterDeviceContext.Provider value={session}>
      <AdaptersContext.Provider value={adapters}>
        <KitchenShell shift={session.shift} onShiftChanged={revalidate} />
      </AdaptersContext.Provider>
    </CounterDeviceContext.Provider>
  )
}
