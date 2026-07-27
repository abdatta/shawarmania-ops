import { TriangleAlert } from 'lucide-react'
import { NavLink } from 'react-router'

import { cn } from '@/lib/cn'
import { useSession } from '@/session/context'
import { ROLE_LABELS, ROLE_SEGMENTS, type Role } from '@/session/session'

const ROLES: Role[] = ['super_admin', 'franchise_admin', 'biller', 'employee']

/**
 * The demo indicator: chrome, not state (design D6). It renders
 * unconditionally in every demo shell's fixed chrome, has no close
 * affordance and no prop that hides it; the only way to remove it is to
 * leave /demo. It also carries the role switcher — flipping between the four
 * roles without signing out is what makes a walkthrough compelling.
 */
export function DemoBanner() {
  const session = useSession()

  return (
    <div
      data-testid="demo-banner"
      className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1 bg-warning px-3 py-1 text-on-warning"
    >
      <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide">
        <TriangleAlert aria-hidden size={14} />
        Demo — fabricated data
      </span>
      <nav aria-label="Demo role switcher" className="ml-auto flex items-center gap-1">
        {ROLES.map((role) => (
          <NavLink
            key={role}
            to={`/demo/${ROLE_SEGMENTS[role]}`}
            aria-current={session.role === role ? 'page' : undefined}
            className={cn(
              'rounded px-2 py-1 text-xs font-semibold focus-visible:focus-ring',
              session.role === role
                ? 'bg-on-warning/15 underline underline-offset-2'
                : 'hover:bg-on-warning/10',
            )}
          >
            {ROLE_LABELS[role]}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
