import { LogOut, RotateCcw, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { Link, NavLink } from 'react-router'

import { ConfirmDialog } from '@/components/layout/confirm-dialog'
import { cn } from '@/lib/cn'
import { useSession } from '@/session/context'
import { ROLE_LABELS, ROLE_SEGMENTS, type Role } from '@/session/session'

import { useDemoReset } from './demo-reset'

const ROLES: Role[] = ['super_admin', 'franchise_admin', 'biller', 'employee']

/**
 * The demo indicator: chrome, not state (design D6). It renders
 * unconditionally in every demo shell's fixed chrome, has no close
 * affordance and no prop that hides it; the only way to remove it is to
 * leave /demo. It also carries the role switcher — flipping between the four
 * roles without signing out is what makes a walkthrough compelling.
 *
 * It carries the **reset** too, and that is the one place it could be found:
 * this is the only piece of chrome present on every demo surface, and a reset
 * reachable from one screen is a reset nobody finds halfway through a
 * walkthrough. Resetting does not dismiss anything — the banner is still here
 * afterwards, which `demo-safety.test.tsx` asserts by pressing every control in
 * this strip and checking the strip is still there.
 *
 * And it carries the **way out**. Somebody handed this link had no control that
 * left the demo at all; the only exit was editing the address bar. Leaving is
 * not dismissing, and the indicator's invariant is unweakened by it: the exit is
 * a link to the root, so the banner goes only once the demo it is warning about
 * has gone with it. Every control in this strip therefore either stays inside
 * `/demo` or leaves the demo entirely, and none of them hides fabricated data
 * while it is still on screen.
 */
export function DemoBanner() {
  const session = useSession()
  const reset = useDemoReset()
  const [confirming, setConfirming] = useState(false)

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

      {reset && (
        <button
          type="button"
          data-testid="demo-reset"
          onClick={() => setConfirming(true)}
          className="flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold hover:bg-on-warning/10 focus-visible:focus-ring"
        >
          <RotateCcw aria-hidden size={14} />
          Start again
        </button>
      )}

      <Link
        to="/"
        data-testid="demo-exit"
        className="flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold hover:bg-on-warning/10 focus-visible:focus-ring"
      >
        <LogOut aria-hidden size={14} />
        Exit demo
      </Link>

      <ConfirmDialog
        open={confirming}
        title="Start the demo again?"
        consequence="Everything done in this demo — bills rung, stock recorded, expenses added, alerts raised, days closed — is discarded, and the data goes back to how it was when you arrived. You stay on the role you are looking at. Nothing real is affected either way."
        confirmLabel="Discard and start again"
        onClose={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false)
          reset?.()
        }}
      />
    </div>
  )
}
