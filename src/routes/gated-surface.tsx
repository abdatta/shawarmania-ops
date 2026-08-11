import type { ReactNode } from 'react'

import { isRenderable, surfaces } from '@/gates/registry'
import { useSession } from '@/session/context'
import { personalNavigationRoles, reachableRoles } from '@/session/session'

import { NotFound } from './not-found'

/**
 * Renders a surface only if the gate registry says this role may see it in
 * this mode.
 *
 * Both role trees mount ONE branch (`/demo/:roleSegment/*` and
 * `/:roleSegment/*`), so a path like `people` is shared by more than one role.
 * This is what makes that safe: the path is looked up against the *current
 * session's* role, and anything that role has no entry for is not a page. A
 * Biller typing `/biller/people` gets not-found inside their own shell —
 * the same honest answer a `hidden` surface gives (docs/DEMO_MODE.md).
 */
export function GatedSurface({ path, children }: { path: string; children: ReactNode }) {
  const session = useSession()
  // Resolved against every role the session can REACH, not just the shell it is
  // standing in: since multi-outlet-people a person may hold several, and the
  // routes for each are branches of the same tree; since
  // owner-reaches-every-outlet the owner also reaches the outlet-level ones. A
  // role they can neither hold nor reach still finds nothing, which is the
  // property this file exists for.
  // Every real role branch is a person's phone. A Biller assignment reaches
  // Employee capabilities there, but its billing surfaces belong only to the
  // separately authenticated `/counter` device branch. Demo keeps the Biller
  // walkthrough, so it continues to resolve the synthetic counter surfaces.
  const reachable =
    session.mode === 'real' ? personalNavigationRoles(session) : reachableRoles(session)
  const surface = surfaces.find(
    (candidate) => reachable.includes(candidate.role) && candidate.path === path,
  )
  if (!surface || !isRenderable(surface.state, session.mode)) return <NotFound />
  return <>{children}</>
}
