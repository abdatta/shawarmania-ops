import { useCallback, useEffect, useState } from 'react'

import { PageHeader } from '@/components/layout/page-header'
import { LoadingList } from '@/components/ui/loading'
import { useAdapters } from '@/data-access'
import type { ManualLedgerExpense } from '@/data-access/adapters'
import { resolveBusinessDate, shiftBusinessDate } from '@/domain'
import { ExpenseList } from '@/features/manual-ledger/expense-list'
import { useOutletScope } from '@/features/outlet-scope'
import { useSession } from '@/session/context'

/**
 * What this outlet spent, for the people who spend it.
 *
 * **Expenses and nothing else.** No revenue by any channel, no opening or
 * counted cash, no cash movements, no commission rate, no difference and no
 * monthly figure. Two separate reasons hold that line and it is worth keeping
 * them apart:
 *
 *   * **The drawer figures are refused by the database**, not hidden here. An
 *     account that could set the counted cash could make any drawer reconcile,
 *     and outlet staff hold no policy branch on the day record at all. This
 *     surface simply never asks for one.
 *   * **The day's own takings are left off for a usability reason, not a
 *     security one.** A staff member stands where the sales happen and could
 *     tally them; the system does not claim that figure is a secret
 *     [owner, 2026-08-08]. It is absent because a screen showing four kinds of
 *     financial truth is a screen nobody reads.
 *
 * The distinction is recorded in `docs/LIMITATIONS.md` so a later change that
 * shows staff their own shift's sales is a product question, while one showing
 * them the month is not.
 *
 * **The two-day window is where this opens, not a boundary.** No policy carries
 * a date predicate on reads, and an older expense is still readable — hiding an
 * expense row protects nothing, since it is not a revenue figure (design D2).
 */

/** Today and yesterday, by the outlet's own cutover rather than the calendar. */
const DAYS_SHOWN = 2

export function StaffExpensesSurface() {
  const { manualLedger: adapter, outlets } = useAdapters()
  const { outletId, selector: outletSelector } = useOutletScope()
  const { userId } = useSession()

  const [businessDates, setBusinessDates] = useState<readonly string[] | null>(null)
  const [expenses, setExpenses] = useState<ManualLedgerExpense[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (dates: readonly string[]) => {
      if (!outletId) return
      setExpenses(await adapter.listRecentExpenses(outletId, dates))
    },
    [adapter, outletId],
  )

  useEffect(() => {
    if (!outletId) return
    let active = true

    void outlets
      .getOutlet(outletId)
      .then(async (outlet) => {
        if (!active || !outlet) return
        // Through the outlet's cutover, never off the device clock: something
        // bought at 00:30 belongs to the trading day that is still running, and
        // that is also the only day this person may record against.
        const today = resolveBusinessDate(new Date(), outlet.business_day_cutover)
        const dates = Array.from({ length: DAYS_SHOWN }, (_, back) =>
          shiftBusinessDate(today, -back),
        )
        if (!active) return
        setBusinessDates(dates)
        await load(dates)
      })
      .catch(() => {
        if (active) setError('Could not load expenses. Try again in a moment.')
      })

    return () => {
      active = false
    }
  }, [outlets, outletId, load])

  const today = businessDates?.[0]

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        scope={outletSelector}
        title="Expenses"
        subtitle="What this outlet spent today and yesterday."
      />

      {error && (
        <p
          role="alert"
          data-testid="staff-expenses-error"
          className="mb-3 text-sm font-semibold text-danger"
        >
          {error}
        </p>
      )}

      {today === undefined ? (
        // The list's own silhouette while the outlet's trading day is resolved,
        // shaped for this surface rather than borrowed: nothing sits above it
        // here, so a header-shaped block would reserve room for a heading that
        // never arrives.
        <LoadingList
          label="this outlet’s expenses"
          rows={4}
          blockHeight="h-16"
          className="space-y-2"
          data-testid="staff-expenses-loading"
        />
      ) : (
        <ExpenseList
          expenses={expenses}
          outletId={outletId ?? ''}
          // Recorded against today, always. An expense noticed the next morning
          // is the manager's or the owner's to add, and the database refuses it
          // here rather than the form quietly accepting it.
          businessDate={today}
          currentBusinessDate={today}
          viewer={{ id: userId, mayTouchAnyRow: false }}
          // Two days on one list, so each row has to say which day it belongs to.
          showDates
          // The page title above already says it.
          heading={null}
          emptyTitle="Nothing spent here yet today. Add what you bought, as you buy it."
          onChanged={() => load(businessDates ?? [])}
        />
      )}
    </div>
  )
}
