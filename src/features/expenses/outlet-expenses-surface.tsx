import { useCallback, useEffect, useMemo, useState } from 'react'

import { PageHeader } from '@/components/layout/page-header'
import { Card } from '@/components/ui/card'
import { LoadingFigures, LoadingList, LoadingRegion, Shimmer } from '@/components/ui/loading'
import { Money } from '@/components/ui/money'
import { DayField, PeriodBar } from '@/components/ui/period-bar'
import { useAdapters } from '@/data-access'
import type { ManualLedgerExpense } from '@/data-access/adapters'
import { earliestOffered, resolveBusinessDate, shiftBusinessDate } from '@/domain'
import { ExpenseList } from '@/features/manual-ledger/expense-list'
import { useOutletScope } from '@/features/outlet-scope'
import { useSession } from '@/session/context'
import { holdsRole } from '@/session/session'

/**
 * What this outlet spent, on one shared surface with two shapes of reach.
 *
 * An owner or a manager at the outlet reaches one chosen business date and may
 * change every row there. A Biller or Employee opens on today and yesterday
 * and may change only their own rows on the running day. That split changes
 * navigation and row actions, never the financial truth rendered: every reader
 * sees expenses and only expenses at the outlets the database lets them reach.
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

const FULL_REACH_SHAPE = {
  dayControl: true,
  daysShown: 1,
  showDates: false,
  showTotals: true,
  subtitle: 'What this outlet spent on this day.',
} as const

const STAFF_SHAPE = {
  dayControl: false,
  daysShown: DAYS_SHOWN,
  showDates: true,
  showTotals: false,
  subtitle: 'What this outlet spent today and yesterday.',
} as const

export function OutletExpensesSurface() {
  const { manualLedger: adapter, outlets } = useAdapters()
  const { outletId, managed, selector: outletSelector } = useOutletScope()
  const session = useSession()

  // The surface transcription of `app_is_owner() OR outlet_id in
  // app_outlets_for('franchise_admin')`: policy and control ask one question.
  const fullReach = holdsRole(session, 'super_admin') || managed
  const shape = fullReach ? FULL_REACH_SHAPE : STAFF_SHAPE

  const [dayContext, setDayContext] = useState<{
    outletId: string
    today: string
    businessDate: string
  } | null>(null)
  const [expenseResult, setExpenseResult] = useState<{
    key: string
    rows: ManualLedgerExpense[]
  } | null>(null)
  const [errorResult, setErrorResult] = useState<{ key: string; message: string } | null>(null)

  // A result for the previous outlet is stale data, not a loading state for the
  // next one. Keying it makes that result impossible to render while the new
  // outlet's cutover and rows resolve, without a resetting effect.
  const currentDay = dayContext?.outletId === outletId ? dayContext : null
  const today = currentDay?.today ?? null
  const businessDate = currentDay?.businessDate ?? null

  const businessDates = useMemo(() => {
    if (today === null || businessDate === null) return null
    return Array.from({ length: shape.daysShown }, (_, back) =>
      shiftBusinessDate(businessDate, -back),
    )
  }, [businessDate, shape.daysShown, today])

  const load = useCallback(
    async (dates: readonly string[]) => {
      if (!outletId) return
      const key = `${outletId}|${dates.join('|')}`
      const rows = await adapter.listRecentExpenses(outletId, dates)
      setExpenseResult({ key, rows })
      setErrorResult(null)
    },
    [adapter, outletId],
  )

  useEffect(() => {
    if (!outletId) return
    let active = true

    void outlets
      .getOutlet(outletId)
      .then((outlet) => {
        if (!active || !outlet) return
        // Through the outlet's cutover, never off the device clock: something
        // bought at 00:30 belongs to the trading day that is still running.
        const resolved = resolveBusinessDate(new Date(), outlet.business_day_cutover)
        setDayContext({ outletId, today: resolved, businessDate: resolved })
        setErrorResult(null)
      })
      .catch(() => {
        if (active) {
          setErrorResult({
            key: `outlet:${outletId}`,
            message: 'Could not load expenses. Try again in a moment.',
          })
        }
      })

    return () => {
      active = false
    }
  }, [outlets, outletId])

  useEffect(() => {
    if (businessDates === null) return
    let active = true
    const key = `${outletId ?? ''}|${businessDates.join('|')}`
    void adapter
      .listRecentExpenses(outletId ?? '', businessDates)
      .then((rows) => {
        if (!active) return
        setExpenseResult({ key, rows })
        setErrorResult(null)
      })
      .catch(() => {
        if (active) {
          setErrorResult({ key, message: 'Could not load expenses. Try again in a moment.' })
        }
      })
    return () => {
      active = false
    }
  }, [adapter, businessDates, outletId])

  const requestKey =
    businessDates === null
      ? `outlet:${outletId ?? ''}`
      : `${outletId ?? ''}|${businessDates.join('|')}`
  const expenses = expenseResult?.key === requestKey ? expenseResult.rows : null
  const error = errorResult?.key === requestKey ? errorResult.message : null

  const chooseBusinessDate = useCallback(
    (next: string) => {
      setDayContext((current) =>
        current?.outletId === outletId ? { ...current, businessDate: next } : current,
      )
    },
    [outletId],
  )

  const liveExpenses = expenses?.filter((expense) => expense.voidedAt === null) ?? []
  const totalPaise = liveExpenses.reduce((sum, expense) => sum + expense.amountPaise, 0)
  const cashTotalPaise = liveExpenses.reduce(
    (sum, expense) => sum + (expense.isCash ? expense.amountPaise : 0),
    0,
  )

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader scope={outletSelector} title="Expenses" subtitle={shape.subtitle} />

      {error && (
        <p
          role="alert"
          data-testid="staff-expenses-error"
          className="mb-3 text-sm font-semibold text-danger"
        >
          {error}
        </p>
      )}

      {shape.dayControl &&
        (today === null || businessDate === null ? (
          <LoadingRegion
            label="the expense day"
            className="mb-3"
            data-testid="expenses-period-loading"
          >
            <Shimmer className="h-[calc(var(--size-control-phone)+0.5rem)]" />
          </LoadingRegion>
        ) : (
          <div className="mb-3">
            <PeriodBar
              label="day"
              testIdPrefix="expenses"
              onStep={(by) => chooseBusinessDate(shiftBusinessDate(businessDate, by))}
              canStepForward={businessDate < today}
            >
              <DayField
                businessDate={businessDate}
                today={today}
                earliest={earliestOffered(today)}
                testIdPrefix="expenses"
                onChange={chooseBusinessDate}
              />
            </PeriodBar>
          </div>
        ))}

      {today === null || businessDate === null || businessDates === null ? (
        // The list's own silhouette while the outlet's trading day is resolved,
        // shaped for this surface so the rows arriving do not move the page.
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
          businessDate={shape.dayControl ? businessDate : today}
          currentBusinessDate={today}
          viewer={{ id: session.userId, mayTouchAnyRow: fullReach }}
          showDates={shape.showDates}
          // The page title above already says it.
          heading={null}
          emptyTitle={
            businessDate === today
              ? 'Nothing spent here yet today. Add what you bought, as you buy it.'
              : 'Nothing was recorded for this day.'
          }
          onChanged={() => load(businessDates)}
        />
      )}

      {shape.showTotals &&
        today !== null &&
        businessDate !== null &&
        (expenses === null ? (
          <LoadingFigures
            label="this day’s expense totals"
            rows={2}
            className="mt-3"
            data-testid="expense-totals-loading"
          />
        ) : (
          <Card className="mt-3 space-y-1" data-testid="expense-totals">
            <p className="flex items-baseline justify-between text-sm">
              <span className="text-content-muted">Spent this day</span>
              <Money paise={totalPaise} className="font-semibold" />
            </p>
            <p className="flex items-baseline justify-between text-sm">
              <span className="text-content-muted">Of which cash</span>
              <Money
                paise={cashTotalPaise}
                className="font-semibold"
                data-testid="expense-cash-total"
              />
            </p>
          </Card>
        ))}
    </div>
  )
}
