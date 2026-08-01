import { PlayCircle, UserRound } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'

import { BuildVersion } from '@/components/build-version'
import { buttonVariants } from '@/components/ui/button-variants'
import { useAdapters } from '@/data-access/adapters-context'
import { useSession } from '@/session/context'
import { heldRoles, holdsRole, ROLE_LABELS } from '@/session/session'

/** Where the demo lives. Never a role path — see `DemoLink`. */
const DEMO_PATH = '/demo'

/**
 * Who am I, and how do I leave (design D9).
 *
 * Passed into the shell through the same slot mechanism the demo banner uses,
 * so the shells never learn what mode they are in: the real tree fills the
 * slot, the demo tree leaves it empty, and neither shell has a branch about
 * it. A demo shell offering "sign out" would be offering to end a session that
 * does not exist.
 *
 * Native `<details>` rather than a hand-built popover: keyboard operation,
 * Escape, and focus behaviour come from the platform and cannot be got subtly
 * wrong. The one thing `<details>` does not give is dismissal by clicking away
 * — a menu that can only be closed by the control that opened it reads as
 * stuck — so `open` is held here and released on an outside pointer, the same
 * way `RowActionsMenu` does it.
 */
export function AccountMenu({ onSignOut }: { onSignOut: () => void | Promise<void> }) {
  const session = useSession()
  const { outlets } = useAdapters()
  const detailsRef = useRef<HTMLDetailsElement>(null)
  const [open, setOpen] = useState(false)
  const [outletName, setOutletName] = useState<string | null>(null)
  const outletId = session.outletId

  useEffect(() => {
    if (!open) return

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      setOpen(false)
      detailsRef.current?.querySelector('summary')?.focus()
    }
    function onPointerDown(event: PointerEvent) {
      if (!detailsRef.current?.contains(event.target as Node)) setOpen(false)
    }

    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open])

  useEffect(() => {
    if (!outletId) return
    let active = true
    void outlets
      .getOutlet(outletId)
      .then((outlet) => {
        if (active) setOutletName(outlet?.name ?? null)
      })
      .catch(() => {
        // The menu is not worth an error state; the name simply stays absent.
      })
    return () => {
      active = false
    }
  }, [outlets, outletId])

  return (
    <details
      ref={detailsRef}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="relative"
      data-testid="account-menu"
    >
      <summary
        className="flex size-[var(--size-control-phone)] cursor-pointer list-none items-center justify-center rounded-lg text-content-muted hover:bg-surface-raised hover:text-content focus-visible:focus-ring [&::-webkit-details-marker]:hidden"
        aria-label="Account"
      >
        <UserRound aria-hidden size={20} />
      </summary>

      <div className="absolute right-0 z-20 mt-1 w-60 rounded-lg border border-border bg-surface p-3 shadow-lg">
        <p className="truncate font-semibold" data-testid="account-name">
          {session.displayName}
        </p>
        <p className="text-xs text-content-muted">
          {/* Every role they hold, because one person may hold several and a
              menu naming one of them would be picking a favourite. */}
          {heldRoles(session)
            .map((role) => ROLE_LABELS[role])
            .join(' · ') || 'No outlet'}
          {outletName ? ` · ${outletName}` : ''}
        </p>
        {holdsRole(session, 'super_admin') && <DemoLink onOpen={() => setOpen(false)} />}

        <button
          type="button"
          onClick={() => void onSignOut()}
          className={`${buttonVariants({ variant: 'secondary', size: 'phone' })} mt-3 w-full`}
        >
          Sign out
        </button>
        <BuildVersion className="mt-3 border-t border-border pt-3 text-center" />
      </div>
    </details>
  )
}

/**
 * The demo, and a way to hand it to somebody.
 *
 * **The Super Admin's only**, and that is a decision rather than an oversight: a
 * manager showing the demo to a walk-in lead is plausible enough, and no harm
 * follows since the link is public either way — but there is no reason to widen
 * an affordance ahead of wanting it.
 *
 * It links `/demo` rather than `/demo/owner`. The banner's role switcher is
 * right there, and a recipient should not be pinned to whichever role the owner
 * happened to be looking at. Handing the link to somebody else is the browser's
 * own share or address bar rather than a button here: a copy control that the
 * clipboard may refuse (it does, over plain http on a phone) needs a fallback
 * that explains itself, and that is a lot of menu for something the platform
 * already does.
 *
 * **Following it while signed in still meets the interstitial**, deliberately.
 * Somebody ringing up fake bills in a tab they thought was real is a genuine
 * operational problem, and an owner is no less capable of losing track of a tab
 * than a biller is. There is no special case here, and there must not be one.
 */
function DemoLink({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="mt-3 space-y-2 border-t border-border pt-3" data-testid="demo-entry">
      <Link
        to={DEMO_PATH}
        onClick={onOpen}
        data-testid="demo-link"
        className={`${buttonVariants({ variant: 'secondary', size: 'phone' })} w-full`}
      >
        <PlayCircle aria-hidden size={16} />
        View Demo
      </Link>
    </div>
  )
}
