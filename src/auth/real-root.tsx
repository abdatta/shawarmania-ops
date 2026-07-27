import { useMemo } from 'react'
import { Navigate, useLocation, useParams } from 'react-router'

import { buttonVariants } from '@/components/ui/button-variants'
import { Card, CardBody, CardTitle } from '@/components/ui/card'
import { AdaptersContext } from '@/data-access/adapters-context'
import { createSupabaseAdapters } from '@/data-access/supabase-adapters'
import { NotFound } from '@/routes/not-found'
import { CounterShell } from '@/shell/counter-shell'
import { PhoneShell } from '@/shell/phone-shell'
import { SessionContext } from '@/session/context'
import { roleFromSegment, ROLE_SEGMENTS } from '@/session/session'

import { AccountMenu } from './account-menu'
import { useRealSession } from './use-real-session'

/**
 * The real branch's provider stack — the structural twin of DemoRoot
 * (design D2). It constructs only Supabase adapters, exactly as DemoRoot
 * constructs only mock ones; there is still no factory that takes a mode.
 *
 * The role in the path is *checked*, never trusted: a real session's role
 * comes from its own token claim, and a typed URL naming another role is a
 * redirect, not a decision. Row-Level Security is the actual boundary — this
 * only stops the UI from rendering something the database would refuse to
 * fill.
 */
export function RealRoot() {
  const { roleSegment } = useParams()
  const location = useLocation()
  const { state, revalidate, endSession } = useRealSession()

  // Non-fatal on purpose. The demo-only deployment ships with no Supabase
  // configuration at all, and `getSupabaseClient()` throws when it is missing;
  // a typed `/owner` there should reach sign-in, not a white screen. There is
  // no session without a client either, so the redirect below is what actually
  // happens — this only keeps the render from dying first.
  const adapters = useMemo(() => {
    try {
      return createSupabaseAdapters()
    } catch {
      return null
    }
  }, [])

  // Checked before the session, deliberately: `/nonsense` matches this branch
  // (a dynamic segment) but names no role, and the answer to it is "no such
  // page" whether or not anyone is signed in. Sending a signed-out visitor to
  // sign-in for a URL that will never exist would be a lie.
  if (!roleFromSegment(roleSegment)) return <NotFound />

  if (state.status === 'loading') {
    return <p className="p-6 text-sm text-content-muted">Loading…</p>
  }

  if (state.status === 'unavailable') {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-canvas p-4 text-content">
        <Card className="max-w-md">
          <CardTitle>Could not reach Shawarmania Ops</CardTitle>
          <CardBody className="space-y-4">
            <p>
              You are still signed in — the app just could not confirm it. Check your connection and
              try again.
            </p>
            <button
              type="button"
              onClick={revalidate}
              className={buttonVariants({ size: 'phone' })}
            >
              Try again
            </button>
          </CardBody>
        </Card>
      </div>
    )
  }

  if (state.status === 'anonymous') {
    return (
      <Navigate
        to="/sign-in"
        replace
        state={{
          reason: state.reason,
          from: `${location.pathname}${location.search}`,
        }}
      />
    )
  }

  const { session } = state

  // A session without a client is not a state the app can be in — but if it
  // ever were, saying so beats rendering a shell whose every read would throw.
  if (!adapters) return <NotFound />

  const ownSegment = ROLE_SEGMENTS[session.role]

  // Someone else's role path: go to your own rather than render theirs. RLS
  // would have refused to fill it anyway; this only stops the shell lying.
  if (roleSegment !== ownSegment) return <Navigate to={`/${ownSegment}`} replace />

  const Shell = session.role === 'biller' ? CounterShell : PhoneShell

  return (
    <SessionContext.Provider value={session}>
      <AdaptersContext.Provider value={adapters}>
        <Shell accountMenu={<AccountMenu onSignOut={endSession} />} />
      </AdaptersContext.Provider>
    </SessionContext.Provider>
  )
}
