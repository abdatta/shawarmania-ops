import { Outlet } from 'react-router'

import { RealSessionContext } from './real-session-context'
import { TabletBoundary } from './tablet-boundary'
import { useRealSession } from './use-real-session'

/**
 * Resolves the real session once for the branches that need it.
 *
 * **It supplies state; it does not gate rendering.** The `Outlet` is
 * unconditional, and there is deliberately no placeholder here: this provider
 * sits above sign-in and activation, and those screens need no session at all.
 * Gating would put a shimmer in front of the login form, which is worse than the
 * flash this whole change exists to remove. Each consumer decides for itself
 * what an unresolved session means for it — the root and the role shells wait,
 * the credential screens do not (design D6).
 *
 * **One case does wait here: a browser whose stored session is a tablet's**
 * (a-tablet-keeps-its-login, design D1). `TabletBoundary` sends a set-up tablet
 * home from any address outside its own branch, and while the session is still
 * resolving it holds back a page a tablet must never draw, such as the login
 * form. Every other visitor gets the `Outlet` unconditionally, as before.
 *
 * **Demo mode is outside this provider, and that is structural rather than
 * conditional** (design D5). `getSupabaseClient()` throws while demo scope is
 * active, and `resolveSession` wraps that call in a `try/catch` that turns any
 * throw into `indeterminate` — so a provider mounted above `/demo` would trip
 * the demo tripwire and have it silently swallowed. A guard inside this
 * component would be the same structure with a runtime check standing in for it,
 * and would put the demo seam's correctness inside a conditional a later edit
 * can quietly break. The route tree keeps them apart instead; see
 * `src/routes/index.tsx`.
 */
export function RealSessionProvider() {
  const session = useRealSession()

  return (
    <RealSessionContext.Provider value={session}>
      <TabletBoundary state={session.state} onRetry={session.revalidate}>
        <Outlet />
      </TabletBoundary>
    </RealSessionContext.Provider>
  )
}
