import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import { Select } from '@/components/ui/select'
import { useAdapters, type Tables } from '@/data-access'
import { readRememberedOutlet, rememberOutlet } from '@/features/remembered-outlet'
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
 * **Since owner-reaches-every-outlet the choice is remembered** for one
 * signed-in person and shared by every outlet-scoped surface, so choosing an
 * outlet on one is the outlet the next one opens on and a reload opens where
 * they left off (design D6). That reverses half of the earlier decision, on
 * purpose and on the record (design D7): the owner now reaches these surfaces at
 * every outlet, and re-answering the same question on each of them is the cost
 * that made per-surface state wrong. Everything above still holds — it is a
 * filter, it is not session state, and it confers nothing. See
 * `remembered-outlet.ts` for where it is kept and why.
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
   *
   * **Reaching a surface is not managing the outlet**
   * (owner-reaches-every-outlet, design D2). Since that change the owner reaches
   * every outlet's manager surfaces holding no assignment, and this stays a
   * question about assignments, because the database's answer did not move:
   * `cash_withdrawals_insert` and `close_business_day` carry no owner branch at
   * all. Whether that should change is a design question in `daily-cash-live`
   * (#12), and until it does, widening this would only produce a control the
   * database refuses.
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

  // Where they left off, if anywhere. Believed only once the outlet list has
  // arrived to check it against — an outlet can close, be deleted, or stop being
  // theirs between one visit and the next.
  const [chosen, setChosen] = useState<string | null>(
    !needsList
      ? (mine[0] ?? null)
      : (readRememberedOutlet(session) ?? manages[0] ?? mine[0] ?? null),
  )
  const [outlets, setOutlets] = useState<Tables<'outlets'>[]>([])

  /** Choosing an outlet, and remembering it for the next surface. */
  const choose = useCallback(
    (outletId: string) => {
      setChosen(outletId)
      rememberOutlet(session, outletId)
    },
    [session],
  )

  useEffect(() => {
    if (!needsList) return
    let active = true
    void outletsAdapter
      .listOutlets()
      .then((all) => {
        if (!active) return
        const ours = isOwner ? all : all.filter((outlet) => mine.includes(outlet.id))
        setOutlets(ours)
        // Default to an outlet they actually run, so the owner opens on their
        // own shop rather than on somebody else's books — and to the first one
        // otherwise, so the surface opens on something rather than on a question.
        // Choosing is a correction, not a required step.
        const fallback =
          ours.find((outlet) => manages.includes(outlet.id))?.id ?? ours[0]?.id ?? null
        const usable = (candidate: string | null) =>
          candidate !== null && ours.some((outlet) => outlet.id === candidate)

        setChosen((current) => (usable(current) ? current : fallback))
        // A remembered outlet they may no longer see is replaced rather than
        // shown, and the replacement is written back, so the next surface does
        // not re-discover the same dead value.
        if (!usable(readRememberedOutlet(session)) && fallback !== null) {
          rememberOutlet(session, fallback)
        }
      })
      .catch(() => {
        // A failed list leaves the surface with no scope, which the surface
        // already renders as "nothing to show" — better than a wrong outlet.
      })
    return () => {
      active = false
    }
  }, [needsList, isOwner, mine, manages, outletsAdapter, session])

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
    choose,
    selector:
      outlets.length > 1 ? (
        <label className="flex items-center gap-2 text-sm text-content-muted">
          <span>Outlet</span>
          <Select
            aria-label="Outlet"
            data-testid="surface-outlet"
            value={chosen ?? ''}
            onChange={(event) => choose(event.target.value)}
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
