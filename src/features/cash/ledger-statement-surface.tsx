import { useCallback, useEffect, useState, type ReactNode } from 'react'

import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { AsOfChip } from '@/components/ui/as-of-chip'
import { Card } from '@/components/ui/card'
import { LoadingBlock, LoadingFigures } from '@/components/ui/loading'
import { Money } from '@/components/ui/money'
import { DayField, PeriodBar } from '@/components/ui/period-bar'
import { Explain } from '@/components/ui/why'
import { useAdapters } from '@/data-access'
import {
  DataActionError,
  type LedgerDrawerEvent,
  type LedgerStatementDay,
  type LedgerStatementMonth,
} from '@/data-access/adapters'
import {
  formatBusinessDate,
  formatDateTime,
  formatTime,
  resolveBusinessDate,
  shiftBusinessDate,
} from '@/domain'
import { useOutletScope } from '@/features/outlet-scope'
import { cn } from '@/lib/cn'

/**
 * The Ledger, as a statement that writes itself.
 *
 * **This deliberately reads like the notebook's own recorded day**, because that
 * is the page it replaces and the owner already knows how to read it: a
 * small-caps section heading, a column of label-and-amount rows with the quiet
 * detail as a sub-line, an outlined pill where a figure's provenance matters, a
 * bold total over a rule, and one boxed figure for the thing the page exists to
 * show. An earlier version of this file invented a chip-led idiom of its own; a
 * second way to read the same numbers is a second thing to learn, for no gain.
 *
 * **What changes is the drawer's contents, not the page's manner.** That half has
 * to, and decision 14 is why: the drawer is now ordered by instant rather than
 * grouped by category, so an expense at 18:10 sits above the 22:00 count and one
 * at 23:00 sits below it. That ordering is what makes a mid-shift collection
 * legible, and no arrangement of a per-day form could express it.
 *
 * **Zero editable figures.** The only controls are the day/month toggle, the
 * period bar, the `Why` disclosures and Verify — asserted by a test that
 * enumerates the rendered controls rather than trusting this comment. A figure
 * judged wrong is corrected at its source: a void and re-ring for a bill, a
 * withdrawal and re-entry for an expense, an adjustment for an observation.
 *
 * Two words this surface is careful about, because the model it replaces was
 * careless with both:
 *
 *   * **`Left` and `Closing` are different figures and never share a word.** The
 *     retired term covered both at once. On the worked example they are ₹1,450
 *     and ₹3,504, and trade between them is exactly why.
 *
 *   * **`carried` and `not tracked yet` are different claims.** `carried` means
 *     the app's belief, unchecked — the only word here that says how much the
 *     numbers can be trusted. Before an outlet's first count there is no belief
 *     to leave unchecked.
 */

/** How far back the calendar opens. Generous: reading an old month is ordinary. */
const MONTHS_OFFERED = 12

const DIFFERENCE_WORDS = {
  short: 'short — this much is missing from the drawer',
  over: 'over — this much more than expected was counted',
  balanced: 'the drawer balanced exactly',
} as const

export function LedgerStatementSurface() {
  const { ledgerStatement: adapter, outlets } = useAdapters()
  const { outletId, selector: outletSelector } = useOutletScope()

  const [view, setView] = useState<'day' | 'month'>('day')
  const [businessDate, setBusinessDate] = useState<string | null>(null)
  /**
   * The outlet's own today, through its own cutover.
   *
   * What the period bar refuses to go past: the database will not accept a
   * future business date, and a control that offers one is offering a failure.
   */
  const [today, setToday] = useState<string | null>(null)
  const [day, setDay] = useState<LedgerStatementDay | null>(null)
  const [month, setMonth] = useState<LedgerStatementMonth | null>(null)
  const [monthKey, setMonthKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!outletId) return
    let active = true
    void outlets
      .getOutlet(outletId)
      .then((outlet) => {
        if (!active || !outlet) return
        const resolved = resolveBusinessDate(new Date(), outlet.business_day_cutover)
        setToday(resolved)
        setBusinessDate(resolved)
        setMonthKey(resolved.slice(0, 7))
      })
      .catch(() => {
        if (active) setError('Could not work out which day this is.')
      })
    return () => {
      active = false
    }
  }, [outlets, outletId])

  const loadDay = useCallback(async () => {
    if (!outletId || !businessDate) return
    setDay(await adapter.getDay(outletId, businessDate))
  }, [adapter, outletId, businessDate])

  useEffect(() => {
    if (!outletId || !businessDate || view !== 'day') return
    let active = true
    void adapter
      .getDay(outletId, businessDate)
      .then((loaded) => {
        if (active) setDay(loaded)
      })
      .catch(() => {
        if (active) setError('Could not read that day. Try again in a moment.')
      })
    return () => {
      active = false
    }
  }, [adapter, outletId, businessDate, view])

  useEffect(() => {
    if (!outletId || !monthKey || view !== 'month') return
    let active = true
    void adapter
      .getMonth(outletId, monthKey)
      .then((loaded) => {
        if (active) setMonth(loaded)
      })
      .catch(() => {
        if (active) setError('Could not read that month. Try again in a moment.')
      })
    return () => {
      active = false
    }
  }, [adapter, outletId, monthKey, view])

  async function verify() {
    if (!outletId || !businessDate) return
    setBusy(true)
    setError(null)
    try {
      await adapter.verifyDay(outletId, businessDate)
      await loadDay()
    } catch (cause) {
      setError(
        cause instanceof DataActionError
          ? cause.message
          : 'That did not work. Try again in a moment.',
      )
    } finally {
      setBusy(false)
    }
  }

  const dayReady = day !== null && day.businessDate === businessDate
  const monthReady = month !== null && month.month === monthKey

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        scope={outletSelector}
        title="Ledger"
        subtitle="Derived from bills, expenses and counts. Nothing on this page is typed in."
      />

      <div className="mb-3 space-y-2">
        <div
          role="group"
          aria-label="What to look at"
          className="grid grid-cols-2 gap-1 rounded-xl border border-border bg-surface p-1"
          data-testid="statement-view"
        >
          {(['day', 'month'] as const).map((candidate) => (
            <button
              key={candidate}
              type="button"
              aria-pressed={view === candidate}
              data-testid={`statement-view-${candidate}`}
              onClick={() => setView(candidate)}
              className={cn(
                'h-[var(--size-control-phone)] rounded-lg text-sm font-semibold focus-visible:focus-ring',
                view === candidate
                  ? 'bg-primary text-on-primary'
                  : 'text-content-muted hover:bg-surface-raised hover:text-content',
              )}
            >
              {candidate === 'day' ? 'One day' : 'The month'}
            </button>
          ))}
        </div>

        {today === null || businessDate === null || monthKey === null ? (
          // The bar's own silhouette, so the panel below does not move when the
          // outlet's today lands.
          <LoadingBlock
            label="the day picker"
            className="h-[calc(var(--size-control-phone)+0.5rem+2px)] w-full"
            data-testid="statement-picker-loading"
          />
        ) : view === 'day' ? (
          /*
            The shared bar. `src/components/ui/period-bar.tsx` already answers all
            three things a day control owes here: it writes **Today** rather than
            the date when that is what the date is, it cannot be stepped or picked
            into the future because the database refuses a future business date,
            and its middle is a button onto the platform calendar so any earlier
            day is one tap rather than N steps.
          */
          <PeriodBar
            label="Day"
            testIdPrefix="statement"
            onStep={(by) => setBusinessDate(shiftBusinessDate(businessDate, by))}
            canStepForward={businessDate < today}
          >
            <DayField
              businessDate={businessDate}
              today={today}
              earliest={monthsBackFrom(today, MONTHS_OFFERED)}
              testIdPrefix="statement"
              onChange={setBusinessDate}
            />
          </PeriodBar>
        ) : (
          <PeriodBar
            label="Month"
            testIdPrefix="statement"
            onStep={(by) => setMonthKey(shiftMonthKey(monthKey, by))}
            canStepForward={monthKey < today.slice(0, 7)}
          >
            {/*
              A label rather than a field, exactly as the notebook does it:
              `input type="month"` is a text box in Firefox, and there is nothing
              to type here that two taps do not reach.
            */}
            <span
              data-testid="statement-month-picker"
              data-month={monthKey}
              className="font-semibold text-content"
            >
              {monthLabel(monthKey)}
            </span>
          </PeriodBar>
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="mb-3 text-sm font-semibold text-danger"
          data-testid="ledger-error"
        >
          {error}
        </p>
      )}

      {view === 'day' ? (
        !dayReady ? (
          <LoadingFigures label="the day" rows={[7, 8, 3]} data-testid="ledger-loading" />
        ) : (
          <DayReading day={day} busy={busy} onVerify={verify} />
        )
      ) : !monthReady ? (
        <LoadingFigures label="the month" rows={[10, 3]} data-testid="ledger-month-loading" />
      ) : (
        <MonthReading month={month} />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function DayReading({
  day,
  busy,
  onVerify,
}: {
  day: LedgerStatementDay
  busy: boolean
  onVerify: () => void
}) {
  return (
    <div className="space-y-3">
      {day.changedSinceVerified.length > 0 && (
        <Card className="border-warning" data-testid="changed-since-verified">
          <p className="flex items-baseline justify-between gap-2">
            <Explain
              label="why a verified day can still change"
              explanation={
                <>
                  Nothing is blocked. Aggregator settlement restating a day afterwards is ordinary,
                  which is why verifying freezes nothing.
                </>
              }
            >
              <span className="text-sm font-bold text-content">Changed since you verified it</span>
            </Explain>
          </p>
          <p className="text-xs text-content-muted">{day.changedSinceVerified.join(', ')}.</p>
        </Card>
      )}

      {/* ── Revenue ─────────────────────────────────────────────────────── */}
      <Card className="space-y-1" data-testid="ledger-revenue">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-bold text-content">
            {formatBusinessDate(day.businessDate)}
          </span>
          <DrawerStateTag state={day.drawer.state} />
        </div>

        <h3 className="text-xs font-bold uppercase tracking-wide text-content-muted">
          Sales breakdown
        </h3>

        {/*
          **Ditto the notebook's own rows, because nothing changed on the sales
          side.** Same labels, same single line, no sub-line — the notebook writes
          `Cash · from counter` exactly like this once an outlet is reading Cash
          and UPI from bills, which the derived statement always is.

          The bill count rides in the label rather than as a sub-line under it:
          design.md's sketch asks for it, and a sub-line here would be the one
          visible difference from the page this replaces.
        */}
        <Row
          label={`Cash · from counter · ${day.revenue.cashBills} ${
            day.revenue.cashBills === 1 ? 'bill' : 'bills'
          }`}
          paise={day.revenue.cashPaise}
          testId="revenue-cash"
        />
        <Row
          label={`UPI · from counter · ${day.revenue.upiBills} ${
            day.revenue.upiBills === 1 ? 'bill' : 'bills'
          }`}
          paise={day.revenue.upiPaise}
          testId="revenue-upi"
        />

        {day.revenue.channels.map((channel) => (
          <div
            key={channel.channel}
            className="space-y-1 border-t border-border pt-2"
            data-testid={`channel-${channel.channel}`}
          >
            <Row
              label={`${titleCase(channel.channel)}, as stated`}
              paise={channel.grossPaise}
              tag={
                <>
                  <SettlementTag state={channel.settlementState} />
                  <AsOfChip at={channel.asOfAt} testId={`channel-as-of-${channel.channel}`} />
                </>
              }
              testId={`channel-gross-${channel.channel}`}
            />
            <Row
              label="Less commission"
              // Null is NOT KNOWN YET and renders as those words. A dash reads as
              // "nothing here" and nought reads as "nothing was charged"; both
              // are claims, and neither is true.
              paise={channel.commissionPaise === null ? null : -channel.commissionPaise}
              testId={`channel-commission-${channel.channel}`}
            />
            <Row
              label={`${titleCase(channel.channel)}, actually received`}
              paise={channel.netPaise}
              testId={`channel-net-${channel.channel}`}
            />
          </div>
        ))}

        <div className="flex items-baseline justify-between border-t border-border pt-2">
          <span className="text-sm font-bold text-content">
            {day.revenue.isCeiling ? 'Revenue received, at most' : 'Revenue actually received'}
          </span>
          <Money paise={day.revenue.totalPaise} className="font-bold" data-testid="revenue-total" />
        </div>

        {day.revenue.isCeiling && (
          <p className="text-xs text-content-muted" data-testid="revenue-ceiling-note">
            One channel&rsquo;s commission is not known yet, so this is the most that can have
            arrived. It settles when the week does. Of all this, only the cash reached the drawer.
          </p>
        )}
      </Card>

      {/* ── Drawer: the contents change, the manner does not ─────────────── */}
      <Card className="space-y-1" data-testid="ledger-drawer">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-xs font-bold uppercase tracking-wide text-content-muted">
            The drawer, in the order it happened
          </h3>
          {day.drawer.observationCoversDays !== null && day.drawer.observationCoversDays > 1 && (
            <Explain
              label="what a multi-day count means"
              explanation={
                <>That count covers several days, so a difference cannot be pinned to one night.</>
              }
            >
              <span className="text-xs font-semibold text-content-muted" data-testid="covers-days">
                covers {day.drawer.observationCoversDays} days
              </span>
            </Explain>
          )}
        </div>

        {day.drawer.state === 'not-tracked-yet' ? (
          <p className="text-xs text-content-muted" data-testid="drawer-not-tracked-yet">
            The drawer was not being followed on this date. Revenue and expenses above are complete;
            there is simply no balance to state, and inventing one would be a figure nobody checked.
          </p>
        ) : (
          <>
            <Row
              label="Opening (04:00)"
              paise={day.drawer.openingPaise}
              hint={day.drawer.state === 'carried' ? 'Carried — nobody counted it' : null}
              testId="drawer-opening"
            />

            {day.drawer.timeline.map((event, index) => (
              <TimelineRow key={`${event.kind}-${index}`} event={event} index={index} />
            ))}

            <div className="flex items-baseline justify-between border-t border-border pt-2">
              <span className="text-sm font-bold text-content">Closing (04:00)</span>
              <Money
                paise={day.drawer.closingPaise ?? 0}
                className="font-bold"
                data-testid="drawer-closing"
              />
            </div>

            {day.drawer.state === 'carried' && (
              <p className="text-xs text-content-muted" data-testid="drawer-carried">
                Nobody counted the drawer on this date, so both balances are what the app believes
                rather than what anybody checked.
                {day.drawer.lastConfirmedAt &&
                  ` Last confirmed ${formatDateTime(day.drawer.lastConfirmedAt)}.`}
              </p>
            )}

            <p className="text-xs text-content-muted" data-testid="left-is-not-opening">
              UPI, Zomato and Swiggy are revenue and never drawer, so none of them appears above.
              And what was left at a count is not the next day&rsquo;s opening — the counter went on
              trading afterwards.
            </p>
          </>
        )}
      </Card>

      {/* ── Expenses ────────────────────────────────────────────────────── */}
      <Card className="space-y-1" data-testid="ledger-expenses">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-xs font-bold uppercase tracking-wide text-content-muted">Expenses</h3>
          <Money
            paise={day.expenses.totalPaise}
            className="font-bold"
            data-testid="expenses-total"
          />
        </div>
        {day.expenses.rows.length === 0 ? (
          <p className="text-xs text-content-muted">Nothing recorded.</p>
        ) : (
          day.expenses.rows.map((row) => (
            <Row
              key={row.id}
              label={row.label}
              paise={row.paise}
              hint={[row.isCash ? 'cash' : 'not cash', row.recordedByName, formatTime(row.instant)]
                .filter(Boolean)
                .join(' · ')}
              testId={`expense-${row.id}`}
            />
          ))
        )}
      </Card>

      {/* ── Verify: one day, one action ─────────────────────────────────── */}
      <Card className="space-y-2" data-testid="ledger-verify">
        {day.verifications.map((verification) => (
          <p
            key={verification.id}
            className="text-xs text-content-muted"
            data-testid={`verification-${verification.id}`}
          >
            Verified by {verification.verifiedByName ?? 'somebody'}{' '}
            {formatDateTime(verification.verifiedAt)}
            {verification.note ? ` — ${verification.note}` : ''}
          </p>
        ))}
        <div className="flex items-center gap-2">
          <Button
            className="flex-1"
            size="phone"
            onClick={onVerify}
            disabled={busy}
            data-testid="verify-day"
          >
            Verify this day
          </Button>
          <Explain
            label="what verifying does and does not do"
            className="shrink-0 text-xs text-content-muted"
            explanation={
              <>
                An acknowledgement that you read it. It freezes nothing, is required by nothing, and
                each day is verified on its own.
              </>
            }
          >
            what does this do?
          </Explain>
        </div>
      </Card>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * The month, one row per business date.
 *
 * `carried` is the word doing the work here: it is the only thing on this view
 * that says how much the numbers can be trusted, and a month of it in a row is
 * the signal that nobody has counted the drawer in a while.
 */
function MonthReading({ month }: { month: LedgerStatementMonth }) {
  return (
    <div className="space-y-3">
      <Card className="space-y-1" data-testid="ledger-month">
        <h3 className="text-xs font-bold uppercase tracking-wide text-content-muted">
          The drawer, day by day
        </h3>
        {month.days.map((entry) => (
          <div
            key={entry.businessDate}
            className="flex items-baseline justify-between gap-2 border-t border-border py-1 first:border-t-0"
            data-testid={`month-day-${entry.businessDate}`}
          >
            <span className="min-w-0 text-sm text-content-muted">
              {formatBusinessDate(entry.businessDate)}
              <span className="block text-xs">
                {entry.state === 'counted' ? (
                  <>
                    {entry.isLegacyImprecise
                      ? 'counted · hour was never recorded'
                      : `counted ${entry.countedAt ? formatTime(entry.countedAt) : ''}`}
                    {entry.differencePaise === 0
                      ? ' · matched'
                      : entry.differencePaise !== null
                        ? ` · ${entry.differencePaise < 0 ? 'short' : 'over'}`
                        : ''}
                    {entry.observationCoversDays !== null && entry.observationCoversDays > 1
                      ? ` · covers ${entry.observationCoversDays} days`
                      : ''}
                  </>
                ) : entry.state === 'carried' ? (
                  'carried'
                ) : (
                  'not tracked yet'
                )}
              </span>
            </span>
            <span className="shrink-0 whitespace-nowrap text-right text-sm">
              {entry.openingPaise === null || entry.closingPaise === null ? (
                <span className="text-content-muted">—</span>
              ) : (
                <>
                  <Money paise={entry.openingPaise} className="text-content-muted" />
                  <span className="text-content-muted"> → </span>
                  <Money paise={entry.closingPaise} />
                </>
              )}
            </span>
          </div>
        ))}
      </Card>

      {/*
        Cash out that is deliberately outside the month's operating figure.
        Open question 2: a ₹40,000 fridge paid from the till has to be findable
        without remembering the date, and without entering a cash-basis operating
        estimate that would then be wrong by ₹40,000.
      */}
      {month.spends.length > 0 && (
        <Card className="space-y-1" data-testid="month-spends">
          <h3 className="text-xs font-bold uppercase tracking-wide text-content-muted">
            Cash out, not in operating costs
          </h3>
          {month.spends.map((spend) => (
            <Row
              key={spend.id}
              label={spend.reason ?? 'Cash spend'}
              paise={-spend.amountPaise}
              hint={[spend.recordedByName, formatDateTime(spend.occurredAt)]
                .filter(Boolean)
                .join(' · ')}
              testId={`spend-${spend.id}`}
            />
          ))}
          <p className="text-xs text-content-muted">
            These moved the drawer and are deliberately absent from the month&rsquo;s expenses. The
            monthly figure is a cash-basis <strong>operating</strong> estimate, and a freezer is not
            a running cost.
          </p>
        </Card>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

/** One drawer movement, or an observation as its own boxed block. */
function TimelineRow({ event, index }: { event: LedgerDrawerEvent; index: number }) {
  if (event.kind === 'cash-sales') {
    return (
      <Row
        label="Cash from sales"
        paise={event.paise}
        hint={`${event.bills} ${event.bills === 1 ? 'bill' : 'bills'}`}
        testId="timeline-cash-sales"
      />
    )
  }

  if (event.kind === 'cash-expense') {
    return (
      <Row
        label={event.label}
        paise={-event.paise}
        hint={`Cash expense · ${formatTime(event.instant)}`}
        testId={`timeline-expense-${index}`}
      />
    )
  }

  if (event.kind === 'cash-out') {
    return (
      <Row
        label={event.label}
        paise={-event.paise}
        hint={
          event.spend
            ? `Cash spend · ${formatTime(event.instant)} · not an operating cost`
            : `Taken from the drawer · ${formatTime(event.instant)}`
        }
        testId={`timeline-cash-out-${index}`}
      />
    )
  }

  const observation = event.observation
  const collected = observation.ownCashOut.reduce((sum, movement) => sum + movement.amountPaise, 0)
  const left = observation.countedTotalPaise - collected
  const difference = observation.differencePaise
  const direction =
    difference === null ? null : difference < 0 ? 'short' : difference > 0 ? 'over' : 'balanced'

  return (
    <div
      className={cn(
        'my-1 space-y-1 rounded-lg border bg-surface-raised p-2',
        direction === 'short' || direction === 'over' ? 'border-warning' : 'border-border',
      )}
      data-testid={`timeline-observation-${observation.id}`}
    >
      <p className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-bold uppercase tracking-wide text-content">
          {observation.isLegacyImprecise
            ? 'Count · hour was never recorded'
            : `Count · ${formatTime(observation.countedAt)}`}
          {!observation.isLegacyImprecise && observation.isApproximate && ' (approximate)'}
        </span>
        {!observation.onSite && <span className="text-xs text-content-muted">recorded away</span>}
      </p>

      {observation.isAnchor ? (
        <>
          <Row
            label="In the drawer"
            paise={observation.countedTotalPaise}
            testId={`observation-counted-${observation.id}`}
          />
          <p className="text-xs text-content-muted" data-testid={`anchor-${observation.id}`}>
            The drawer began here. There is nothing before it to compare against, so this count
            records no difference at all.
          </p>
        </>
      ) : (
        <>
          <Row
            label="Should have been in the drawer"
            paise={observation.expectedPaise}
            testId={`observation-expected-${observation.id}`}
          />
          <Row
            label="Counted"
            paise={observation.countedTotalPaise}
            testId={`observation-counted-${observation.id}`}
          />
          {/*
            The variance takes its own line so the block still adds up, and it is
            boxed for the same reason the notebook boxes its difference: it is the
            figure the page exists to show.
          */}
          {difference !== null && direction !== null && (
            <div className="rounded-lg border border-border bg-surface p-2">
              <p className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-bold text-content">
                  {direction === 'balanced' ? 'Difference' : 'Unexplained'}
                </span>
                <Money
                  paise={difference}
                  display
                  data-testid={`observation-variance-${observation.id}`}
                />
              </p>
              <p className="text-xs text-content-muted">{DIFFERENCE_WORDS[direction]}</p>
            </div>
          )}
        </>
      )}

      {collected !== 0 && (
        <Row
          label={collected < 0 ? 'Cash added at the count' : 'Collected'}
          paise={-collected}
          hint={observation.recordedByName ? `${observation.recordedByName}` : null}
          testId={`observation-collected-${observation.id}`}
        />
      )}
      <Row label="Left in the drawer" paise={left} testId={`observation-left-${observation.id}`} />

      {observation.awayReason && (
        <p className="text-xs italic text-content-muted">{observation.awayReason}</p>
      )}

      {observation.openingBreakPaise !== null && (
        <p className="text-xs font-semibold text-content" data-testid={`break-${observation.id}`}>
          This count opened at a figure the previous one does not carry to, by{' '}
          <Money paise={observation.openingBreakPaise} />.{' '}
          <span className="font-normal text-content-muted">
            Reported, not repaired: a figure somebody&rsquo;s count produced is evidence, and a
            recomputed one is not.
          </span>
        </p>
      )}

      {observation.adjustments.map((adjustment) => (
        <p key={adjustment.id} className="text-xs text-content-muted">
          Adjusted to <Money paise={adjustment.correctedCountedTotalPaise} /> from{' '}
          <Money paise={adjustment.originalCountedTotalPaise} /> — {adjustment.reason}
          {adjustment.adjustedByName ? `, ${adjustment.adjustedByName}` : ''}
        </p>
      ))}
    </div>
  )
}

/**
 * A label and its amount, with the quiet detail as a sub-line.
 *
 * A compact money row shared within this derived statement.
 */
function Row({
  label,
  paise: amount,
  testId,
  hint,
  tag,
}: {
  label: string
  /** `null` where the figure is undetermined, which is not the same as nought. */
  paise: number | null
  testId: string
  hint?: string | null
  /** A small outlined pill beside the label, for where a figure came from. */
  tag?: ReactNode
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="inline-flex min-w-0 flex-wrap items-baseline gap-1.5 text-sm text-content-muted">
          {label}
          {tag}
        </span>
        {amount === null ? (
          /*
           * Words, not a dash and not a nought.
           *
           * A dash reads as "nothing here" and nought reads as "nothing was
           * charged"; both are claims. "Not known yet" is the only rendering that
           * says what is actually true, and it says the same thing to a screen
           * reader, which a typographic mark would not.
           */
          <span
            className="shrink-0 whitespace-nowrap text-sm text-content-muted"
            data-testid={testId}
          >
            Not known yet
          </span>
        ) : (
          <Money paise={amount} className="shrink-0 whitespace-nowrap" data-testid={testId} />
        )}
      </div>
      {hint && <p className="text-xs text-content-muted">{hint}</p>}
    </div>
  )
}

/** Where an aggregator figure came from, as the notebook renders it. */
function SettlementTag({ state }: { state: string }) {
  const [label, tone] =
    state === 'settled'
      ? (['Settled', 'border-success text-success'] as const)
      : state === 'disputed'
        ? (['Disputed', 'border-danger text-danger'] as const)
        : ([
            state === 'provisional' ? 'Daily' : titleCase(state),
            'border-primary text-primary',
          ] as const)

  return (
    <span
      data-testid={`settlement-tag-${label.toLowerCase()}`}
      className={cn(
        'inline-flex items-center rounded-full border px-1.5 py-0.5 text-[11px] font-semibold',
        tone,
      )}
    >
      {label}
    </span>
  )
}

/**
 * Whether the drawer on this date was counted, believed, or not yet followed.
 *
 * Three states and never two: `carried` is a belief left unchecked, and before an
 * outlet's first count there is no belief to leave unchecked.
 */
function DrawerStateTag({ state }: { state: 'counted' | 'carried' | 'not-tracked-yet' }) {
  const [label, tone, why] =
    state === 'counted'
      ? ([
          'Counted',
          'border-success text-success',
          'Somebody counted the drawer on this date, so its balances are measured rather than believed.',
        ] as const)
      : state === 'carried'
        ? ([
            'Carried',
            'border-primary text-primary',
            'Nobody counted the drawer on this date. The balances are what the app believes, unchecked — the only word on this page that says how much the numbers can be trusted.',
          ] as const)
        : ([
            'Not tracked yet',
            'border-border text-content-muted',
            'This date is before the outlet’s first count. Revenue and expenses are complete; there is simply no drawer balance to state, and inventing one would be a figure nobody checked.',
          ] as const)

  return (
    <Explain label={`what ${label.toLowerCase()} means`} explanation={why}>
      <span
        data-testid={`drawer-state-${state}`}
        className={cn(
          'inline-flex items-center rounded-full border px-1.5 py-0.5 text-[11px] font-semibold',
          tone,
        )}
      >
        {label}
      </span>
    </Explain>
  )
}

/**
 * The first day of the month `months` back from a business date.
 *
 * Computed here rather than imported from `features/manual-ledger`, whose whole
 * folder went when #12 landed — the same reasoning that moved `PeriodBar` into
 * `components/ui` in the first place.
 */
function monthsBackFrom(businessDate: string, months: number): string {
  const [year, month] = businessDate.split('-').map(Number)
  if (!year || !month) return businessDate
  const zeroBased = year * 12 + (month - 1) - months
  return `${String(Math.floor(zeroBased / 12)).padStart(4, '0')}-${String(
    (zeroBased % 12) + 1,
  ).padStart(2, '0')}-01`
}

function shiftMonthKey(monthKey: string, by: number): string {
  const [year, month] = monthKey.split('-').map(Number)
  if (!year || !month) return monthKey
  const zeroBased = year * 12 + (month - 1) + by
  return `${String(Math.floor(zeroBased / 12)).padStart(4, '0')}-${String(
    (zeroBased % 12) + 1,
  ).padStart(2, '0')}`
}

function monthLabel(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number)
  if (!year || !month) return monthKey
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-IN', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}
