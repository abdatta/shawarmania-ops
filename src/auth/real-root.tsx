import { useMemo } from 'react'
import { Navigate, useLocation, useParams } from 'react-router'

import { AppAction } from '@/components/app-action'
import { buttonVariants } from '@/components/ui/button-variants'
import { Card, CardBody, CardTitle } from '@/components/ui/card'
import { LoadingShell } from '@/components/ui/loading'
import { AdaptersContext } from '@/data-access/adapters-context'
import { createSupabaseAdapters } from '@/data-access/supabase-adapters'
import { trackAdapterWrites } from '@/data-access/track-adapter-writes'
import { NotFound } from '@/routes/not-found'
import { CounterShell } from '@/shell/counter-shell'
import { PhoneShell } from '@/shell/phone-shell'
import { SessionContext } from '@/session/context'
import { heldRoles, reachableRoles, roleFromSegment, ROLE_SEGMENTS } from '@/session/session'

import { AccountMenu } from './account-menu'
import { useRealSessionContext } from './real-session-context'
import { UnconfirmedSession } from './unconfirmed-session'

/**
 * The real branch's provider stack — the structural twin of DemoRoot
 * (design D2). It constructs only Supabase adapters, exactly as DemoRoot
 * constructs only mock ones; there is still no factory that takes a mode.
 *
 * The role in the path is *checked*, never trusted: since multi-outlet-people
 * a session's roles come from its own assignments, and a typed URL naming a
 * role it does not hold is a redirect rather than a decision. A role it DOES
 * hold is served — one person may manage an outlet and work at another, and
 * both shells are theirs. Row-Level Security is the actual boundary; this only
 * stops the UI from rendering something the database would refuse to fill.
 */
export function RealRoot() {
  const { roleSegment } = useParams()
  const location = useLocation()
  // From the provider above this branch, not from its own hook call: the root
  // resolves the session and hands off here, and resolving it twice for one
  // visit is what that provider exists to stop
  // (the-root-resolves-instead-of-greeting, design D5).
  const { state, revalidate, endSession } = useRealSessionContext()

  // Non-fatal on purpose. The demo-only deployment ships with no Supabase
  // configuration at all, and `getSupabaseClient()` throws when it is missing;
  // a typed `/owner` there should reach sign-in, not a white screen. There is
  // no session without a client either, so the redirect below is what actually
  // happens — this only keeps the render from dying first.
  const adapters = useMemo(() => {
    try {
      // Wrapped so writes in flight are counted, which is what stops the app
      // reloading itself onto a new build mid-save.
      return trackAdapterWrites(createSupabaseAdapters())
    } catch {
      return null
    }
  }, [])

  // Checked before the session, deliberately: `/nonsense` matches this branch
  // (a dynamic segment) but names no role, and the answer to it is "no such
  // page" whether or not anyone is signed in. Sending a signed-out visitor to
  // sign-in for a URL that will never exist would be a lie.
  if (!roleFromSegment(roleSegment)) return <NotFound />

  // Shared with the application root, which waits behind the same shape
  // immediately before handing off here. Two placeholders that differed at all
  // would read as two loads rather than one boot (design D4).
  if (state.status === 'loading') return <LoadingShell />

  if (state.status === 'unavailable') return <UnconfirmedSession onRetry={revalidate} />

  // A tablet asked for a person's shell. It holds no assignment, so every
  // question below — which roles it holds, where it lands, which shell it gets —
  // is one it has no answer to. Sending it to its own branch is the answer.
  if (state.status === 'counter') return <Navigate to="/counter" replace />

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

  // Home comes from what they HOLD: the owner lands on the owner's shell, not
  // on the manager shell they can also reach.
  const [primary] = heldRoles(session)

  // Nothing to be in: a person with no live assignment is signed in and placed
  // nowhere. A real state — hired, not yet placed — and one to say rather than
  // render an empty shell around.
  if (!primary) return <Unplaced onSignOut={endSession} />

  const homeSegment = ROLE_SEGMENTS[primary]
  const asked = roleFromSegment(roleSegment)

  // A role they cannot reach: go to their own rather than render it. RLS would
  // have refused to fill it anyway; this only stops the shell lying. The owner
  // reaches the manager shell without an assignment there
  // (owner-reaches-every-outlet, design D1), and what they may write in it is
  // still the database's answer rather than this gate's.
  if (!asked || !reachableRoles(session).includes(asked)) {
    return <Navigate to={`/${homeSegment}`} replace />
  }

  const Shell = asked === 'biller' ? CounterShell : PhoneShell

  return (
    <SessionContext.Provider value={session}>
      <AdaptersContext.Provider value={adapters}>
        <Shell accountMenu={<AccountMenu onSignOut={endSession} />} appAction={<AppAction />} />
      </AdaptersContext.Provider>
    </SessionContext.Provider>
  )
}

/**
 * Signed in, assigned nowhere.
 *
 * A real state since multi-outlet-people, and one worth naming: a person is
 * hired before they are placed, and somebody whose last assignment ends keeps
 * their account until an admin deactivates it. Neither is an error, and
 * neither is a reason to end the session — so the screen says what is true and
 * offers the one thing they can do about it.
 */
function Unplaced({ onSignOut }: { onSignOut: () => Promise<void> }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas p-4 text-content">
      <Card className="max-w-md">
        <CardTitle>You are not assigned to an outlet</CardTitle>
        <CardBody className="space-y-4">
          <p>
            Your account works, but nobody has placed you at an outlet yet — so there is nothing
            here to show you. Ask your manager to add you, then reopen the app.
          </p>
          <button
            type="button"
            onClick={() => void onSignOut()}
            className={buttonVariants({ size: 'phone', variant: 'secondary' })}
          >
            Sign out
          </button>
        </CardBody>
      </Card>
    </div>
  )
}
