import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'

import { PageHeader } from '@/components/layout/page-header'
import { Card } from '@/components/ui/card'
import { LoadingFigures, LoadingList, LoadingRegion, Shimmer } from '@/components/ui/loading'
import { Money } from '@/components/ui/money'
import { DayField, PeriodBar } from '@/components/ui/period-bar'
import { useChangeGate } from '@/change-gates/context'
import { useAdapters } from '@/data-access'
import type { ExpenseRecord } from '@/data-access/adapters'
import { carryPeriod, earliestOffered, resolveBusinessDate, shiftBusinessDate } from '@/domain'
import { ExpenseList } from '@/features/expenses/expense-list'
import { ExpenseTabs } from '@/features/fixed-costs/expense-tabs'
import { useFixedMarks, useOutletFixedCosts } from '@/features/fixed-costs/use-fixed-costs'
import { useFixedTabAvailable } from '@/features/fixed-costs/use-fixed-tab'
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
 * **Staff read only what left the drawer.** A Biller or Employee is served cash
 * expenses and nothing else, by `expenses_select` rather than by this screen:
 * the owner's salaries and rent are entered here on the first of the month, and
 * what a colleague is paid is not a counter's business
 * (staff-see-only-what-leaves-the-drawer, which reversed #38's view that hiding
 * an expense row protects nothing).
 *
 * **The two-day window is where this opens, not a boundary.** No policy carries
 * a date predicate on reads, and an older cash expense is still readable.
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
  const { expenses: adapter, outlets } = useAdapters()
  const { outletId, managed, selector: outletSelector } = useOutletScope()
  const session = useSession()

  // The surface transcription of `app_is_owner() OR outlet_id in
  // app_outlets_for('franchise_admin')`: policy and control ask one question.
  const fullReach = holdsRole(session, 'super_admin') || managed
  const shape = fullReach ? FULL_REACH_SHAPE : STAFF_SHAPE
  // The heading is the explanation (owner UI convention); with the refreshed
  // screens on there is no sentence beneath it (design D9).
  const refreshed = useChangeGate('refreshed-staff-screens')
  // The Fixed chip (fixed-costs-are-spread-over-the-month): read only for the
  // owner and a manager, with `pro-rata-pnl` on. Staff make no request for it.
  const fixedMarks = useFixedMarks(useOutletFixedCosts(outletId, fullReach), outletId)
  // Daily | Fixed (owner, 2026-10-19): only for the owner and a manager, and only
  // once the Fixed tab's surface is shown. Staff and the counter see this page
  // exactly as before.
  const fixedTabAvailable = useFixedTabAvailable()
  const showTabs = fullReach && fixedTabAvailable
  // A payment's "Recorded on 31 Oct · View" opens that day (`?date=`), for the
  // owner and a manager; staff keep their two days.
  const [address] = useSearchParams()
  const askedDate = fullReach ? address.get('date') : null

  const [dayContext, setDayContext] = useState<{
    outletId: string
    today: string
    businessDate: string
  } | null>(null)
  const [expenseResult, setExpenseResult] = useState<{
    key: string
    rows: ExpenseRecord[]
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
        // The reader keeps their place (app-shell): the date they stepped to
        // survives a switch, and a reader who was on today stays on today — the
        // new outlet's. This used to overwrite the date with today every time.
        setDayContext((current) => ({
          outletId,
          today: resolved,
          businessDate:
            !current && askedDate && /^\d{4}-\d{2}-\d{2}$/.test(askedDate) && askedDate <= resolved
              ? askedDate
              : carryPeriod(current?.businessDate ?? null, current?.today ?? null, resolved),
        }))
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
    // `askedDate` is read once, for the first day shown: stepping away from it is
    // the reader's, and must not be undone by the address.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      <PageHeader
        scope={outletSelector}
        title="Expenses"
        {...(refreshed ? {} : { subtitle: shape.subtitle })}
      />
      {showTabs && <ExpenseTabs current="daily" />}

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
          fixedMarks={fullReach ? fixedMarks : undefined}
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
