import { Check, Copy, PlayCircle, UserRound } from 'lucide-react'
import { useEffect, useState } from 'react'
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
 * wrong.
 */
export function AccountMenu({ onSignOut }: { onSignOut: () => void | Promise<void> }) {
  const session = useSession()
  const { outlets } = useAdapters()
  const [outletName, setOutletName] = useState<string | null>(null)
  const outletId = session.outletId

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
    <details className="relative" data-testid="account-menu">
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
        {holdsRole(session, 'super_admin') && <DemoLink />}

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
 * It links and copies `/demo` rather than `/demo/owner`. The banner's role
 * switcher is right there, and a recipient should not be pinned to whichever
 * role the owner happened to be looking at.
 *
 * **Following it while signed in still meets the interstitial**, deliberately.
 * Somebody ringing up fake bills in a tab they thought was real is a genuine
 * operational problem, and an owner is no less capable of losing track of a tab
 * than a biller is. There is no special case here, and there must not be one.
 */
function DemoLink() {
  const [copied, setCopied] = useState(false)
  const [fallback, setFallback] = useState<string | null>(null)

  const url =
    typeof window === 'undefined' ? DEMO_PATH : new URL(DEMO_PATH, window.location.origin).href

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setFallback(null)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // Refused, or unavailable over plain http on a phone. Showing the URL to
      // select by hand is a working answer; a copy button that silently does
      // nothing is worse than no copy button.
      setFallback(url)
    }
  }

  return (
    <div className="mt-3 space-y-2 border-t border-border pt-3" data-testid="demo-entry">
      <p className="text-xs text-content-muted">
        A walkable demo on invented data, for showing the product to somebody.
      </p>
      <div className="flex gap-2">
        <Link
          to={DEMO_PATH}
          data-testid="demo-link"
          className={`${buttonVariants({ variant: 'secondary', size: 'phone' })} flex-1`}
        >
          <PlayCircle aria-hidden size={16} />
          Open the demo
        </Link>
        <button
          type="button"
          onClick={() => void copy()}
          aria-label="Copy the demo link"
          data-testid="copy-demo-link"
          className={buttonVariants({ variant: 'secondary', size: 'phone' })}
        >
          {copied ? <Check aria-hidden size={16} /> : <Copy aria-hidden size={16} />}
        </button>
      </div>
      {copied && (
        <p role="status" className="text-xs font-semibold text-content">
          Link copied.
        </p>
      )}
      {fallback && (
        <p className="text-xs text-content-muted" data-testid="demo-link-fallback">
          Copying is not available here. The link is{' '}
          <span className="break-all font-semibold text-content">{fallback}</span>
        </p>
      )}
    </div>
  )
}
