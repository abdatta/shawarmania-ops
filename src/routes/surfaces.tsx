import type { RouteObject } from 'react-router'

import { AccountsSurface } from '@/features/accounts/accounts-surface'
import { RoleHome } from '@/features/overview/role-home'

import { GatedSurface } from './gated-surface'
import { NotFound } from './not-found'

/**
 * The children shared by the real and demo role branches.
 *
 * Identical by construction, because they genuinely are the same surfaces:
 * what differs between the two modes is the gate registry's state for each,
 * which `GatedSurface` consults per session. A surface promoted from `demo` to
 * `live` therefore needs no route change at all — which is exactly the
 * property every `*-live` change on the roadmap depends on.
 */
export const roleSurfaceRoutes: RouteObject[] = [
  {
    index: true,
    element: (
      <GatedSurface path="">
        <RoleHome />
      </GatedSurface>
    ),
  },
  {
    path: 'people',
    element: (
      <GatedSurface path="people">
        <AccountsSurface />
      </GatedSurface>
    ),
  },
  // Everything else is genuinely absent — inside the shell chrome, not as a
  // blank page.
  { path: '*', Component: NotFound },
]
