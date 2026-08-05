import { createContext, useContext } from 'react'

import type { RealSession } from './use-real-session'

/**
 * The one resolved real session for a visit.
 *
 * `useRealSession` is a hook, so before this its state was per component: the
 * application root resolved the session, redirected, unmounted, and the role
 * shell mounted and resolved the same session again from nothing. One cold
 * launch at the root asked who you are twice — four requests and two
 * placeholders for one question — and the root is the installed app's
 * `start_url`, so that was every launch
 * (the-root-resolves-instead-of-greeting, design D5).
 *
 * The context is deliberately **not** created with a default session state. A
 * component reading it outside the provider is a routing mistake rather than an
 * anonymous visitor, and a plausible default would hide that by rendering a
 * sign-in redirect instead of failing.
 */
export const RealSessionContext = createContext<RealSession | null>(null)

export function useRealSessionContext(): RealSession {
  const value = useContext(RealSessionContext)
  if (!value) {
    throw new Error(
      'No RealSessionContext. This component renders outside the real-session provider — ' +
        'check the route tree in src/routes/index.tsx; the demo branch is outside it on purpose.',
    )
  }
  return value
}
