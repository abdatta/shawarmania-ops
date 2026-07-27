import type { ReactNode } from 'react'

import { isRenderable, surfaces } from '@/gates/registry'
import { useSession } from '@/session/context'

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
  const surface = surfaces.find(
    (candidate) => candidate.role === session.role && candidate.path === path,
  )
  if (!surface || !isRenderable(surface.state, session.mode)) return <NotFound />
  return <>{children}</>
}
