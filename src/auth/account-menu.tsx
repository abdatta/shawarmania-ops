import { UserRound } from 'lucide-react'
import { useEffect, useState } from 'react'

import { buttonVariants } from '@/components/ui/button-variants'
import { useAdapters } from '@/data-access/adapters-context'
import { useSession } from '@/session/context'
import { ROLE_LABELS } from '@/session/session'

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
          {ROLE_LABELS[session.role]}
          {outletName ? ` · ${outletName}` : ''}
        </p>
        <button
          type="button"
          onClick={() => void onSignOut()}
          className={`${buttonVariants({ variant: 'secondary', size: 'phone' })} mt-3 w-full`}
        >
          Sign out
        </button>
      </div>
    </details>
  )
}
