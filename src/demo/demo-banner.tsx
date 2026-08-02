import { ChevronDown, LogOut, RotateCcw, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { Link, NavLink, useNavigate } from 'react-router'

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
 *
 * On a phone the strip is **one row that never wraps**, because a warning that
 * reflows the page it sits above reads as part of the page. Four role tabs plus
 * two labelled controls do not fit 375px, so below `sm` the tabs collapse into a
 * native select and the reset and exit keep their icons and drop their words to
 * `aria-label`. Same four destinations, same two controls, one row: nothing here
 * is hidden by a breakpoint, only spelled shorter.
 */
export function DemoBanner() {
  const session = useSession()
  const reset = useDemoReset()
  const navigate = useNavigate()
  const [confirming, setConfirming] = useState(false)

  return (
    <div
      data-testid="demo-banner"
      className="flex min-h-8 flex-nowrap items-center gap-x-2 bg-warning px-3 py-1 text-on-warning sm:gap-x-3"
    >
      {/* The one shrinkable thing in the strip. Nothing narrower than a phone
          reaches it — 375px leaves room to spare — but on a screen that did,
          clipping the tail of the label is a smaller failure than pushing the
          exit off the side of a page that now scrolls sideways. The triangle
          never shrinks, so the warning survives as a warning either way. */}
      <span className="flex min-w-0 items-center gap-1.5 text-xs font-bold uppercase tracking-wide">
        <TriangleAlert aria-hidden size={14} className="shrink-0" />
        <span className="truncate">Demo — fabricated data</span>
      </span>

      <nav aria-label="Demo role switcher" className="ml-auto flex shrink-0 items-center gap-1">
        {/* Phone: the same four destinations as one native control.
            The `<select>` draws nothing and sits on top of the pill, which is
            what reconciles two rules that otherwise fight here. Base CSS floors
            every select at 16px so iOS never zooms the viewport when a picker
            opens — a correctness rule, not a preference — but 16px beside a
            10.5px strip reads as a control that wandered in from another
            screen. Drawing the pill ourselves and letting the real control go
            colourless over it keeps both: the picker is the platform's, at the
            font size that stops the zoom, and what a manager sees is sized like
            everything else in the row.

            Colourless rather than `opacity-0`: a fully transparent element is
            treated as hidden by enough of the stack — `checkVisibility`,
            tooling, some screen readers — that the one real control in this
            switcher would go missing from the tree it must be in. The options
            take their colour back explicitly, for the desktop window narrow
            enough to still be showing this. */}
        <span className="relative flex items-center rounded bg-on-warning/15 has-[:focus-visible]:focus-ring sm:hidden">
          <span aria-hidden className="flex items-center gap-0.5 px-2 py-1 text-xs font-semibold">
            {/* `role` is nullable on every session, and the tabs beside this
                already answer that with "then none of them is current". The
                pill answers it the same way rather than naming a role the
                session does not hold. */}
            {session.role ? ROLE_LABELS[session.role] : 'Role'}
            <ChevronDown size={12} />
          </span>
          <select
            aria-label="Demo role"
            value={session.role ?? ''}
            onChange={(event) => navigate(`/demo/${ROLE_SEGMENTS[event.target.value as Role]}`)}
            className="absolute inset-0 h-full w-full cursor-pointer appearance-none border-0 bg-transparent p-0 text-transparent outline-none"
          >
            {ROLES.map((role) => (
              <option key={role} value={role} className="bg-surface text-content">
                {ROLE_LABELS[role]}
              </option>
            ))}
          </select>
        </span>

        <span className="hidden items-center gap-1 sm:flex">
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
        </span>
      </nav>

      {reset && (
        <button
          type="button"
          data-testid="demo-reset"
          aria-label="Start again"
          onClick={() => setConfirming(true)}
          className="flex shrink-0 items-center gap-1 rounded px-1.5 py-1 text-xs font-semibold hover:bg-on-warning/10 focus-visible:focus-ring sm:px-2"
        >
          <RotateCcw aria-hidden size={14} />
          <span className="hidden sm:inline">Start again</span>
        </button>
      )}

      <Link
        to="/"
        data-testid="demo-exit"
        aria-label="Exit demo"
        className="flex shrink-0 items-center gap-1 rounded px-1.5 py-1 text-xs font-semibold hover:bg-on-warning/10 focus-visible:focus-ring sm:px-2"
      >
        <LogOut aria-hidden size={14} />
        <span className="hidden sm:inline">Exit demo</span>
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
