import { useEffect, useMemo, useState, type ReactNode } from 'react'

import { Select } from '@/components/ui/select'
import { useAdapters, type Tables } from '@/data-access'
import { useSession } from '@/session/context'
import { holdsRole, sessionOutlets, sessionOutletsFor } from '@/session/session'

/**
 * Which outlet an outlet-scoped surface is about.
 *
 * Before `multi-outlet-people` this was `session.outletId` and there was
 * nothing to decide. A person may now manage more than one, so the surface
 * asks — **on the surface**, not in the session.
 *
 * That distinction is the whole design (D6). This selection:
 *
 *   * does not persist into any other surface,
 *   * does not survive as session state, and
 *   * **confers no authority whatsoever** — the database decides every write
 *     from the assignment, so a crafted request naming an outlet the person is
 *     not assigned to is refused however this control is set.
 *
 * It is a filter on a screen, like the period picker the owner's console
 * already has. It is deliberately *not* the session-scoped "active outlet" the
 * proposal rejected: there is no active anything, and nothing to switch.
 *
 * A person with one outlet — which is nearly everybody — gets that outlet and
 * no control at all, exactly as before.
 *
 * **The owner sees every outlet here**, not only the ones they manage: they
 * read everywhere by policy, and they may record a bounded set of entries
 * anywhere (multi-outlet-people, design D8). `managed` is how a surface tells
 * the two apart — see its own doc below.
 */
export function useOutletScope(): {
  /** The outlet in scope, or null while the outlets are still loading. */
  outletId: string | null
  /**
   * Does the caller **manage** the outlet in scope — i.e. hold a Franchise
   * Admin assignment at it, or is it simply one they can see?
   *
   * True for everybody but an owner looking at an outlet they do not run. A
   * surface uses it to narrow what it offers to what the database will accept:
   * the owner's remote path is non-cash expenses and stock corrections, and
   * nothing that touches a drawer. **It is not the boundary** — the policies
   * are — it is how the bound is read rather than discovered by being refused.
   */
  managed: boolean
  /** Render this in the surface's header. Null when there is nothing to choose. */
  selector: ReactNode
  /**
   * Move the surface to another outlet, for a surface that has its own reason to
   * offer the move — the owner's stranded-days list, which exists precisely to
   * say "the unsettled days are over there".
   *
   * Ignored for somebody with a single outlet, who has nowhere to go. Confers
   * nothing that the selector does not: this is the same filter, set from a
   * different control.
   */
  choose: (outletId: string) => void
} {
  const session = useSession()
  const { outlets: outletsAdapter } = useAdapters()

  const isOwner = holdsRole(session, 'super_admin')
  const manages = useMemo(() => sessionOutletsFor(session, 'franchise_admin'), [session])
  const mine = useMemo(() => sessionOutlets(session), [session])
  // The owner chooses from every outlet; everybody else from theirs.
  const needsList = isOwner || mine.length > 1

  const [chosen, setChosen] = useState<string | null>(
    !needsList ? (mine[0] ?? null) : (manages[0] ?? mine[0] ?? null),
  )
  const [outlets, setOutlets] = useState<Tables<'outlets'>[]>([])

  useEffect(() => {
    if (!needsList) return
    let active = true
    void outletsAdapter
      .listOutlets()
      .then((all) => {
        if (!active) return
        const ours = isOwner ? all : all.filter((outlet) => mine.includes(outlet.id))
        setOutlets(ours)
        // Default to the first, so the surface opens on something rather than
        // on a question. Choosing is a correction, not a required step.
        // Default to an outlet they actually run, so the owner opens on their
        // own shop rather than on somebody else's books.
        setChosen(
          (current) =>
            current ??
            ours.find((outlet) => manages.includes(outlet.id))?.id ??
            ours[0]?.id ??
            null,
        )
      })
      .catch(() => {
        // A failed list leaves the surface with no scope, which the surface
        // already renders as "nothing to show" — better than a wrong outlet.
      })
    return () => {
      active = false
    }
  }, [needsList, isOwner, mine, manages, outletsAdapter])

  if (!needsList) {
    const only = mine[0] ?? null
    return {
      outletId: only,
      managed: only !== null && manages.includes(only),
      selector: null,
      choose: () => undefined,
    }
  }

  return {
    outletId: chosen,
    managed: chosen !== null && manages.includes(chosen),
    choose: setChosen,
    selector:
      outlets.length > 1 ? (
        <label className="flex items-center gap-2 text-sm text-content-muted">
          <span>Outlet</span>
          <Select
            aria-label="Outlet"
            data-testid="surface-outlet"
            value={chosen ?? ''}
            onChange={(event) => setChosen(event.target.value)}
          >
            {outlets.map((outlet) => (
              <option key={outlet.id} value={outlet.id}>
                {outlet.name}
              </option>
            ))}
          </Select>
        </label>
      ) : null,
  }
}
