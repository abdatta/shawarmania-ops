import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import { useAdapters, type Tables } from '@/data-access'
import { readRememberedOutlets, rememberOutlets } from '@/features/remembered-outlet'
import { useSession } from '@/session/context'
import { holdsRole, sessionOutlets, sessionOutletsFor } from '@/session/session'

/**
 * Which outlet — or outlets — an outlet-scoped surface is about.
 *
 * Before `multi-outlet-people` this was `session.outletId` and there was
 * nothing to decide. A person may now manage more than one, so the surface
 * asks — **on the surface**, not in the session.
 *
 * That distinction is the whole design (D6). This selection:
 *
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
 * **Since attendance-one-day-per-person it may hold several.** A surface that
 * can meaningfully read more than one outlet at a time passes `multiple` and
 * gets a toggle per outlet instead of a dropdown; everything else is unchanged,
 * including that the last selected outlet cannot be cleared. Selecting several
 * widens nobody's reach: the database still returns only what the reader's
 * assignments allow, and the selection is intersected with that rather than
 * added to it.
 *
 * A person with one outlet — which is nearly everybody — gets that outlet and
 * no control at all, exactly as before.
 *
 * **The owner sees every outlet here**, not only the ones they manage: they
 * read everywhere by policy, and they may record a bounded set of entries
 * anywhere (multi-outlet-people, design D8). `managed` is how a surface tells
 * the two apart — see its own doc below.
 *
 * **A multi-select chip may carry a badge**, through `badgeFor`. Attendance uses
 * it for the days waiting at each outlet, which used to be a second row of chips
 * above this one naming the same outlets in the same shape. One row of outlets
 * wins, and it is this one, because it is the control that acts: noticing a
 * backlog and reaching it are then the same gesture on the same chip.
 */
export function useOutletScope(
  options: {
    multiple?: boolean
    /**
     * Something to say about one outlet, rendered inside its chip. Null for
     * nothing, which is the usual answer. Only the multi-select variant shows
     * it — a dropdown has nowhere to put one.
     */
    badgeFor?: (outletId: string, selected: boolean) => ReactNode
  } = {},
): {
  /**
   * The outlet in scope, or null while the outlets are still loading. The first
   * of the selection where a surface has asked for several, so a single-outlet
   * surface reads this and never has to know about the rest.
   */
  outletId: string | null
  /** Everything selected. One entry unless the surface asked for `multiple`. */
  outletIds: string[]
  /**
   * Does the caller **manage** every outlet in scope — i.e. hold a Franchise
   * Admin assignment at each, or are they simply ones they can see?
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
   * Move the surface to another outlet, replacing whatever was selected, for a
   * surface that has its own reason to offer the move — the owner's
   * stranded-days list, which exists precisely to say "the unsettled days are
   * over there".
   *
   * Ignored for somebody with a single outlet, who has nowhere to go. Confers
   * nothing that the selector does not: this is the same filter, set from a
   * different control.
   */
  choose: (outletId: string) => void
} {
  const session = useSession()
  const { outlets: outletsAdapter } = useAdapters()
  const multiple = options.multiple ?? false

  const isOwner = holdsRole(session, 'super_admin')
  const manages = useMemo(() => sessionOutletsFor(session, 'franchise_admin'), [session])
  const mine = useMemo(() => sessionOutlets(session), [session])
  // The owner chooses from every outlet; everybody else from theirs.
  const needsList = isOwner || mine.length > 1

  // Where they left off, if anywhere. Believed only once the outlet list has
  // arrived to check it against — an outlet can close, be deleted, or stop being
  // theirs between one visit and the next.
  const [chosen, setChosen] = useState<string[]>(() => {
    if (!needsList) return mine[0] ? [mine[0]] : []
    const remembered = readRememberedOutlets(session)
    if (remembered.length > 0) return multiple ? remembered : remembered.slice(0, 1)
    const fallback = manages[0] ?? mine[0]
    return fallback ? [fallback] : []
  })
  const [outlets, setOutlets] = useState<Tables<'outlets'>[]>([])

  /** Remembering is the same act as choosing, so they are never out of step. */
  const settle = useCallback(
    (ids: readonly string[]) => {
      setChosen([...ids])
      rememberOutlets(session, ids)
    },
    [session],
  )

  const choose = useCallback((outletId: string) => settle([outletId]), [settle])

  /**
   * Add or remove one outlet. The last one cannot be removed: an empty
   * selection is a blank surface asking a question nobody asked for, so the
   * attempt simply does nothing.
   */
  const toggle = useCallback(
    (outletId: string) => {
      const next = chosen.includes(outletId)
        ? chosen.filter((id) => id !== outletId)
        : [...chosen, outletId]
      if (next.length === 0) return
      settle(next)
    },
    [chosen, settle],
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

        // A remembered outlet they may no longer see is dropped rather than
        // shown, the rest of the selection is kept, and a selection left empty
        // by that check falls back to the default. The replacement is written
        // back, so the next surface does not re-discover the same dead value.
        setChosen((current) => {
          const usable = current.filter((id) => ours.some((outlet) => outlet.id === id))
          const next = usable.length > 0 ? usable : fallback ? [fallback] : []
          if (next.length !== current.length || next.some((id, i) => id !== current[i])) {
            rememberOutlets(session, next)
            return next
          }
          return current
        })
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
      // `mine` itself, not a fresh array built from it: a caller memoising on
      // this would otherwise recompute on every render, and one that fetched
      // from it would re-read forever.
      outletIds: mine,
      managed: only !== null && manages.includes(only),
      selector: null,
      choose: () => undefined,
    }
  }

  const managed = chosen.length > 0 && chosen.every((id) => manages.includes(id))

  return {
    outletId: chosen[0] ?? null,
    outletIds: chosen,
    managed,
    choose,
    selector:
      outlets.length > 1 ? (
        // One control in two modes, not two controls. A surface that reads several
        // outlets toggles them; a surface that reads one replaces the choice. The
        // chip, the selected treatment and the rule that the current choice cannot
        // be cleared are identical either way, so the switcher looks the same on
        // every surface an owner walks through.
        <OutletChips
          outlets={outlets}
          chosen={multiple ? chosen : chosen.slice(0, 1)}
          onToggle={multiple ? toggle : choose}
          label={multiple ? 'Outlets' : 'Outlet'}
          testId={multiple ? 'surface-outlets' : 'surface-outlet'}
          badgeFor={options.badgeFor}
        />
      ) : null,
  }
}

/**
 * One chip per outlet, rather than a select.
 *
 * A native multiple `<select>` needs ctrl-click to be usable and is close to
 * unusable on the phones this app is actually held on. And in single-outlet mode a
 * select was worse than it looked: its options are floored at 16px so a phone does
 * not zoom on focus, which left it towering over any caption beside it, and the
 * caption was carrying nothing that the outlet's own name did not already say.
 *
 * Chips say what is on with a state a screen reader reads (`aria-pressed`) and a
 * fill a sighted reader sees, and the whole selection is visible without opening
 * anything. The current choice is `disabled` rather than clearable, which says
 * before the press what a swallowed press would only say after it.
 */
function OutletChips({
  outlets,
  chosen,
  onToggle,
  label,
  testId,
  badgeFor,
}: {
  outlets: readonly Tables<'outlets'>[]
  chosen: readonly string[]
  onToggle: (outletId: string) => void
  label: string
  testId: string
  badgeFor?: ((outletId: string, selected: boolean) => ReactNode) | undefined
}) {
  const only = chosen.length === 1

  return (
    <div
      role="group"
      aria-label={label}
      data-testid={testId}
      className="flex flex-wrap items-center gap-1.5"
    >
      {outlets.map((outlet) => {
        const on = chosen.includes(outlet.id)
        return (
          <button
            key={outlet.id}
            type="button"
            aria-pressed={on}
            data-testid={`surface-outlet-${outlet.id}`}
            // The last selected outlet cannot be cleared. Disabling says so
            // before the press rather than swallowing it afterwards.
            disabled={on && only}
            onClick={() => onToggle(outlet.id)}
            className={
              on
                ? 'inline-flex items-center gap-1.5 rounded-full border border-primary bg-primary px-3 py-1 text-sm font-semibold text-on-primary disabled:opacity-100'
                : 'inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 text-sm text-content hover:bg-surface-raised focus-visible:focus-ring'
            }
          >
            {outlet.name}
            {badgeFor?.(outlet.id, on)}
          </button>
        )
      })}
    </div>
  )
}
