import { isRenderable, surfaces } from '@/gates/registry'
import { useSession } from '@/session/context'
import { personalHeldRoles, ROLE_SEGMENTS } from '@/session/session'

/** The path the Fixed tab and a fixed cost's own page live under. */
export const FIXED_COSTS_PATH = 'ledger/fixed-costs'

/**
 * Whether this reader gets the Fixed tab: the fixed-costs surface is renderable
 * for a role they hold (owner or manager) in this mode. `demo` until the owner
 * approves its screens, so the live Expenses page shows no tab and makes no
 * request until then; staff never get it.
 */
export function useFixedTabAvailable(): boolean {
  const session = useSession()
  const held = personalHeldRoles(session)
  return surfaces.some(
    (surface) =>
      surface.path === FIXED_COSTS_PATH &&
      held.includes(surface.role) &&
      isRenderable(surface.state, session.mode),
  )
}

/** `/demo/owner`, `/admin` and the like: where this reader's surfaces are mounted. */
export function useExpensesBase(): string {
  const session = useSession()
  return `${session.mode === 'demo' ? '/demo' : ''}/${ROLE_SEGMENTS[session.role ?? 'franchise_admin']}`
}
