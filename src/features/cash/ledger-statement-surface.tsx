import { ChevronLeft, ChevronRight, Check, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { LoadingFigures } from '@/components/ui/loading'
import { Money } from '@/components/ui/money'
import { useAdapters } from '@/data-access'
import { DataActionError, type LedgerStatementDay } from '@/data-access/adapters'
import {
  formatBusinessDate,
  formatDateTime,
  formatTime,
  resolveBusinessDate,
  shiftBusinessDate,
} from '@/domain'
import { useOutletScope } from '@/features/outlet-scope'

/**
 * The Ledger, as a statement that writes itself.
 *
 * **Zero editable figures.** The only controls are the date stepper, row
 * expansion and Verify — asserted by a test that enumerates the rendered
 * controls rather than trusting this comment. A figure judged wrong is corrected
 * at its source: a void and re-ring for a bill, a withdrawal and re-entry for an
 * expense, an adjustment for an observation.
 *
 * Two words this surface is careful about, because the model it replaces was
 * careless with both:
 *
 *   * **`Left` and `Closing` are different figures and never share a word.** The
 *     retired term "Kept" conflated the float the collector walked away from with
 *     the balance at the next cutover. On the worked example those are ₹1,450 and
 *     ₹3,504, and trade between them is exactly why.
 *
 *   * **`carried` and `not tracked yet` are different claims.** `carried` means
 *     the app's belief, unchecked — the only word here that says how much the
 *     numbers can be trusted. Before an outlet's first count there is no belief
 *     to leave unchecked.
 */

export function LedgerStatementSurface() {
  const { ledgerStatement: adapter, outlets } = useAdapters()
  const { outletId, selector: outletSelector } = useOutletScope()

  const [businessDate, setBusinessDate] = useState<string | null>(null)
  const [day, setDay] = useState<LedgerStatementDay | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!outletId) return
    let active = true
    void outlets
      .getOutlet(outletId)
      .then((outlet) => {
        if (!active || !outlet) return
        setBusinessDate(resolveBusinessDate(new Date(), outlet.business_day_cutover))
      })
      .catch(() => {
        if (active) setError('Could not work out which day this is.')
      })
    return () => {
      active = false
    }
  }, [outlets, outletId])

  const load = useCallback(async () => {
    if (!outletId || !businessDate) return
    setDay(await adapter.getDay(outletId, businessDate))
  }, [adapter, outletId, businessDate])

  useEffect(() => {
    if (!outletId || !businessDate) return
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
  }, [adapter, outletId, businessDate])

  async function verify() {
    if (!outletId || !businessDate) return
    setBusy(true)
    setError(null)
    try {
      await adapter.verifyDay(outletId, businessDate)
      await load()
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

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        scope={outletSelector}
        title="Ledger"
        subtitle="Every figure here comes from somewhere else. Nothing on this page is typed in."
      />

      {businessDate && (
        <div className="mb-3 flex items-center justify-between gap-2">
          <Button
            size="phone"
            variant="secondary"
            aria-label="Previous day"
            onClick={() => setBusinessDate(shiftBusinessDate(businessDate, -1))}
            data-testid="day-back"
          >
            <ChevronLeft aria-hidden size={16} />
          </Button>
          <span className="text-sm font-semibold text-content" data-testid="day-label">
            {formatBusinessDate(businessDate)}
          </span>
          <Button
            size="phone"
            variant="secondary"
            aria-label="Next day"
            onClick={() => setBusinessDate(shiftBusinessDate(businessDate, 1))}
            data-testid="day-forward"
          >
            <ChevronRight aria-hidden size={16} />
          </Button>
        </div>
      )}

      {error && (
        <p
          role="alert"
          className="mb-3 text-sm font-semibold text-danger"
          data-testid="ledger-error"
        >
          {error}
        </p>
      )}

      {/* Derived rather than driven: a day already loaded for a DIFFERENT date is
          stale, and stepping the date used to clear it with a synchronous
          setState inside the effect — a cascading render whose only job was to
          show this shimmer. */}
      {day === null || day.businessDate !== businessDate ? (
        <LoadingFigures label="the day" rows={[6, 7, 3]} data-testid="ledger-loading" />
      ) : (
        <div className="space-y-3">
          {day.changedSinceVerified.length > 0 && (
            <Card className="border-warning" data-testid="changed-since-verified">
              <p className="flex items-start gap-2 text-sm font-bold text-content">
                <TriangleAlert aria-hidden size={16} className="mt-0.5 shrink-0 text-warning" />
                Changed since you verified it: {day.changedSinceVerified.join(', ')}.
              </p>
              <p className="text-xs text-content-muted">
                Nothing is blocked. A settlement restating a day afterwards is ordinary, which is
                why verifying freezes nothing.
              </p>
            </Card>
          )}

          {/* ── Revenue ──────────────────────────────────────────────────── */}
          <Card className="space-y-2" data-testid="ledger-revenue">
            <h2 className="text-sm font-bold text-content">Revenue</h2>
            <Line
              label="Cash"
              paise={day.revenue.cashPaise}
              hint={`from counter · ${day.revenue.cashBills} ${
                day.revenue.cashBills === 1 ? 'bill' : 'bills'
              }`}
              testId="revenue-cash"
            />
            <Line
              label="UPI"
              paise={day.revenue.upiPaise}
              hint={`from counter · ${day.revenue.upiBills} ${
                day.revenue.upiBills === 1 ? 'bill' : 'bills'
              }`}
              testId="revenue-upi"
            />

            {day.revenue.channels.map((channel) => (
              <div
                key={channel.channel}
                className="space-y-0.5"
                data-testid={`channel-${channel.channel}`}
              >
                <Line
                  label={channel.channel}
                  paise={channel.grossPaise}
                  hint={channel.settlementState}
                  testId={`channel-gross-${channel.channel}`}
                />
                <p className="flex items-baseline justify-between pl-4 text-xs text-content-muted">
                  <span>commission</span>
                  {channel.commissionPaise === null ? (
                    // Never nought. A commission nobody has stated is not a
                    // commission of zero.
                    <span data-testid={`channel-commission-unknown-${channel.channel}`}>
                      not known yet
                    </span>
                  ) : (
                    <Money paise={-channel.commissionPaise} />
                  )}
                </p>
                {channel.netPaise !== null && (
                  <p className="flex items-baseline justify-between pl-4 text-xs text-content-muted">
                    <span>net</span>
                    <Money paise={channel.netPaise} />
                  </p>
                )}
              </div>
            ))}

            <div className="flex items-baseline justify-between border-t border-border pt-2">
              <span className="text-sm font-bold text-content">
                Total
                {day.revenue.isCeiling && (
                  <span className="block text-xs font-normal text-content-muted">
                    a ceiling — one channel&rsquo;s commission is not known yet
                  </span>
                )}
              </span>
              <Money
                paise={day.revenue.totalPaise}
                className="font-bold"
                data-testid="revenue-total"
              />
            </div>
          </Card>

          {/* ── Drawer, ordered by instant ───────────────────────────────── */}
          <Card className="space-y-2" data-testid="ledger-drawer">
            <h2 className="text-sm font-bold text-content">Drawer</h2>

            {day.drawer.state === 'not-tracked-yet' ? (
              <p className="text-xs text-content-muted" data-testid="drawer-not-tracked-yet">
                The drawer was not being followed on this date. Revenue and expenses above are
                complete; there is simply no balance to state, and inventing one would be a figure
                nobody checked.
              </p>
            ) : (
              <>
                <BalanceLine
                  label="Opening (04:00)"
                  paise={day.drawer.openingPaise}
                  carried={day.drawer.state === 'carried'}
                  testId="drawer-opening"
                />

                {day.drawer.timeline.map((event, index) => {
                  if (event.kind === 'cash-sales') {
                    return (
                      <Line
                        key={`sales-${index}`}
                        label="Cash sales"
                        paise={event.paise}
                        hint={`${event.bills} ${event.bills === 1 ? 'bill' : 'bills'}`}
                        testId="timeline-cash-sales"
                        indent
                      />
                    )
                  }
                  if (event.kind === 'cash-expense') {
                    return (
                      <Line
                        key={`expense-${index}`}
                        label={event.label}
                        paise={-event.paise}
                        hint={formatTime(event.instant)}
                        testId={`timeline-expense-${index}`}
                        indent
                      />
                    )
                  }
                  if (event.kind === 'cash-out') {
                    return (
                      <Line
                        key={`out-${index}`}
                        label={event.label}
                        paise={-event.paise}
                        hint={`${formatTime(event.instant)}${event.spend ? ' · not an operating cost' : ''}`}
                        testId={`timeline-cash-out-${index}`}
                        indent
                      />
                    )
                  }

                  const observation = event.observation
                  const collected = observation.ownCashOut.reduce(
                    (sum, movement) => sum + movement.amountPaise,
                    0,
                  )
                  const left = observation.countedTotalPaise - collected
                  return (
                    <div
                      key={observation.id}
                      className="my-1 space-y-1 rounded border border-border p-2"
                      data-testid={`timeline-observation-${observation.id}`}
                    >
                      <p className="text-xs font-bold text-content">
                        COUNT · {formatTime(observation.countedAt)}
                        {observation.isApproximate && ' (approximate)'}
                      </p>
                      {!observation.isAnchor && observation.expectedPaise !== null && (
                        <Line
                          label="Expected"
                          paise={observation.expectedPaise}
                          testId={`observation-expected-${observation.id}`}
                        />
                      )}
                      <Line
                        label="In drawer"
                        paise={observation.countedTotalPaise}
                        {...(observation.isAnchor ? { hint: 'the drawer began here' } : {})}
                        testId={`observation-counted-${observation.id}`}
                      />
                      {/* A variance takes its OWN line, so the block still adds up
                          and the difference is not buried in a marker. */}
                      {!observation.isAnchor &&
                        observation.differencePaise !== null &&
                        observation.differencePaise !== 0 && (
                          <Line
                            label="Unexplained"
                            paise={observation.differencePaise}
                            testId={`observation-variance-${observation.id}`}
                          />
                        )}
                      {collected !== 0 && (
                        <Line
                          label={collected < 0 ? 'Added' : 'Collected'}
                          paise={-collected}
                          hint={observation.onSite ? 'on site' : 'recorded away'}
                          testId={`observation-collected-${observation.id}`}
                        />
                      )}
                      <Line
                        label="Left"
                        paise={left}
                        testId={`observation-left-${observation.id}`}
                      />
                      <p className="text-xs text-content-muted">
                        Counted {formatTime(observation.countedAt)}, recorded{' '}
                        {formatDateTime(observation.recordedAt)}
                        {observation.recordedByName ? ` by ${observation.recordedByName}` : ''}
                      </p>
                    </div>
                  )
                })}

                <BalanceLine
                  label="Closing (04:00)"
                  paise={day.drawer.closingPaise}
                  carried={day.drawer.state === 'carried'}
                  testId="drawer-closing"
                />

                {day.drawer.state === 'carried' && (
                  <p className="text-xs text-content-muted" data-testid="drawer-carried">
                    Nobody counted the drawer on this date, so both balances are what the app
                    believes rather than what anybody checked.
                    {day.drawer.lastConfirmedAt &&
                      ` Last confirmed ${formatDateTime(day.drawer.lastConfirmedAt)}.`}
                  </p>
                )}

                {day.drawer.observationCoversDays !== null &&
                  day.drawer.observationCoversDays > 1 && (
                    <p className="text-xs text-content-muted" data-testid="covers-days">
                      That count covers {day.drawer.observationCoversDays} days, so a difference
                      cannot be pinned to one night.
                    </p>
                  )}

                <p className="text-xs text-content-muted" data-testid="left-is-not-opening">
                  What was left at the count is not the next day&rsquo;s opening — the counter went
                  on trading afterwards.
                </p>
              </>
            )}
          </Card>

          {/* ── Expenses ─────────────────────────────────────────────────── */}
          <Card className="space-y-1" data-testid="ledger-expenses">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-bold text-content">Expenses</h2>
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
                <p
                  key={row.id}
                  className="flex items-baseline justify-between text-xs"
                  data-testid={`expense-${row.id}`}
                >
                  <span className="text-content-muted">
                    {row.label} · {row.isCash ? 'cash' : 'not cash'}
                    {row.recordedByName ? ` · ${row.recordedByName}` : ''} ·{' '}
                    {formatTime(row.instant)}
                  </span>
                  <Money paise={row.paise} />
                </p>
              ))
            )}
          </Card>

          {/* ── Verify: one day, one action ──────────────────────────────── */}
          <Card className="space-y-2" data-testid="ledger-verify">
            {day.verifications.length > 0 && (
              <div className="space-y-0.5">
                {day.verifications.map((verification) => (
                  <p
                    key={verification.id}
                    className="flex items-center gap-1 text-xs text-content-muted"
                    data-testid={`verification-${verification.id}`}
                  >
                    <Check aria-hidden size={12} />
                    Verified by {verification.verifiedByName ?? 'somebody'}{' '}
                    {formatDateTime(verification.verifiedAt)}
                    {verification.note ? ` — ${verification.note}` : ''}
                  </p>
                ))}
              </div>
            )}
            <Button className="w-full" onClick={verify} disabled={busy} data-testid="verify-day">
              Verify this day
            </Button>
            <p className="text-xs text-content-muted">
              An acknowledgement that you read it. It freezes nothing and is required by nothing.
            </p>
          </Card>
        </div>
      )}
    </div>
  )
}

function Line({
  label,
  paise,
  hint,
  testId,
  indent = false,
}: {
  label: string
  paise: number
  hint?: string
  testId: string
  indent?: boolean
}) {
  return (
    <div className={`flex items-baseline justify-between gap-2 ${indent ? 'pl-4' : ''}`}>
      <span className="text-xs text-content-muted">
        {label}
        {hint && <span className="block">{hint}</span>}
      </span>
      <Money paise={paise} data-testid={testId} />
    </div>
  )
}

/** A balance, which may be `carried` — the app's belief rather than a count. */
function BalanceLine({
  label,
  paise,
  carried,
  testId,
}: {
  label: string
  paise: number | null
  carried: boolean
  testId: string
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-xs font-semibold text-content">
        {label}
        {carried && <span className="block font-normal text-content-muted">carried</span>}
      </span>
      {paise === null ? (
        <span className="text-xs text-content-muted" data-testid={testId}>
          not tracked yet
        </span>
      ) : (
        <Money paise={paise} data-testid={testId} />
      )}
    </div>
  )
}
