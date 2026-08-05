import { Navigate } from 'react-router'

import { useRealSessionContext } from '@/auth/real-session-context'
import { UnconfirmedSession } from '@/auth/unconfirmed-session'
import { LoadingShell } from '@/components/ui/loading'
import { heldRoles, ROLE_SEGMENTS } from '@/session/session'

/**
 * The application root. It resolves the session and sends the visitor on; it
 * says nothing.
 *
 * There used to be a card here describing the product, with one working control
 * on it: a link to sign-in. It was the wrong screen in three ways at once. The
 * marketing site is separately hosted at `shawarmania.in` and stays that way by
 * requirement, so this origin serves only people already trying to get in. The
 * card's only route onward duplicated what sign-in already is. And it redirected
 * on `ready` alone, so the other three states fell through to it and a signed-in
 * person saw marketing copy flash before their own shell — on every cold launch,
 * because the manifest's `start_url` is this route
 * (the-root-resolves-instead-of-greeting, design D1).
 *
 * **The one rule worth loading before editing this: only a *confirmed*
 * `anonymous` reaches sign-in.** That is safe to lean on because
 * `RealSessionState` already draws the line and no guard here has to re-draw it.
 * `currentUser()` calls `auth.getSession()`, which reads persisted local state
 * and makes no network request, so `anonymous` is a confirmed absence rather than
 * a failed lookup. Every failure path resolves to `indeterminate` instead, and
 * `indeterminate` never becomes `anonymous` — it becomes `unavailable`, and only
 * from `loading`, so a working session is never downgraded by one bad request
 * (design D2).
 *
 * So `unavailable` is answered with the retry card and never with a redirect.
 * Sending it to sign-in would ask somebody to retype a password for a session
 * they still hold, which is the refusal this route exists to not make.
 *
 * **There is deliberately no route into the demo here.** The demo stopped
 * advertising itself when it became something the owner distributes: the link
 * lives in the Super Admin's account menu, with a copy action beside it, so the
 * one person who pitches franchisees can produce the URL without typing it from
 * memory (ui-owner-console-and-demo, design D9). The demo itself stays
 * unauthenticated — a shared link that demanded a login would not be a demo — so
 * what changed is who *finds* it, not who may open it.
 */
export function RootResolver() {
  const { state, revalidate } = useRealSessionContext()

  switch (state.status) {
    case 'loading':
      return <LoadingShell />

    case 'unavailable':
      return <UnconfirmedSession onRetry={revalidate} />

    case 'anonymous':
      return <Navigate to="/sign-in" replace />

    case 'ready': {
      // The most senior role they hold. Somebody assigned nowhere has none, and
      // the role root is where that gets said rather than here.
      const [primary] = heldRoles(state.session)
      return <Navigate to={primary ? `/${ROLE_SEGMENTS[primary]}` : '/staff'} replace />
    }
  }
}
