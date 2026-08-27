import {
  ArrowDownRight,
  ArrowUpRight,
  Check,
  Clock,
  MapPinOff,
  Minus,
  Plus,
  TriangleAlert,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Chip, ChipRow } from '@/components/ui/chip'
import { LoadingFigures } from '@/components/ui/loading'
import { Money } from '@/components/ui/money'
import { DayField, PeriodBar } from '@/components/ui/period-bar'
import { Why } from '@/components/ui/why'
import { useAdapters } from '@/data-access'
import {
  DataActionError,
  type LedgerDrawerEvent,
  type LedgerStatementDay,
} from '@/data-access/adapters'
import { formatDateTime, formatTime, resolveBusinessDate, shiftBusinessDate } from '@/domain'
import { useOutletScope } from '@/features/outlet-scope'

/** How far back the calendar opens. Generous: reading an old month is ordinary. */
const MONTHS_OFFERED = 12

/**
 * The Ledger, as a statement that writes itself.
 *
 * **Zero editable figures.** The only controls are the date stepper, the `Why`
 * disclosures and Verify — asserted by a test that enumerates the rendered
 * controls rather than trusting this comment. A figure judged wrong is corrected
 * at its source: a void and re-ring for a bill, a withdrawal and re-entry for an
 * expense, an adjustment for an observation.
 *
 * **Chips carry the state, prose sits behind a tap.** Same reasoning as the
 * drawer: a reading that explains itself in paragraphs is a reading nobody
 * finishes, and the explanations here are worth keeping and not worth re-reading.
 *
 * Two words this surface is careful about, because the model it replaces was
 * careless with both:
 *
 *   * **`Left` and `Closing` are different figures and never share a word.** The
 *     retired term conflated the float the collector walked away from with the
 *     balance at the next cutover. On the worked example those are ₹1,450 and
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
  /**
   * The outlet's own today, through its own cutover.
   *
   * Held separately from the date being read because it is what the control
   * refuses to go past: the database will not accept a future business date, and
   * a stepper that offers one is offering a failure.
   */
  const [today, setToday] = useState<string | null>(null)
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
        const resolved = resolveBusinessDate(new Date(), outlet.business_day_cutover)
        setToday(resolved)
        setBusinessDate(resolved)
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
      <PageHeader scope={outletSelector} title="Ledger" />

      {/*
        The shared bar, not a hand-rolled pair of chevrons.
        `src/components/ui/period-bar.tsx` already answers all three things a day
        control on this app owes: it writes **Today** rather than the date when
        that is what the date is, it **cannot be stepped or picked into the
        future** because the database refuses a future business date and a control
        that offers one is offering a failure, and its middle is a **button onto
        the platform calendar** so any earlier day is one tap rather than N steps.

        The first version of this surface reimplemented the bar and lost all
        three. Surfaces that ask "which day" should look like each other, because
        they are asking the same question.
      */}
      {businessDate && today && (
        <div className="mb-3">
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
        <LoadingFigures label="the day" rows={[5, 6, 3]} data-testid="ledger-loading" />
      ) : (
        <div className="space-y-3">
          {day.changedSinceVerified.length > 0 && (
            <Card data-testid="changed-since-verified">
              <ChipRow>
                <Chip tone="warn" icon={TriangleAlert}>
                  changed since verified
                </Chip>
                <Chip tone="neutral">{day.changedSinceVerified.join(', ')}</Chip>
                <Why label="why a verified day can still change">
                  Nothing is blocked. Aggregator settlement restating a day afterwards is ordinary,
                  which is why verifying freezes nothing.
                </Why>
              </ChipRow>
            </Card>
          )}

          {/* ── Revenue ──────────────────────────────────────────────────── */}
          <Card className="space-y-2" data-testid="ledger-revenue">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-content-muted">
                Revenue
              </h2>
              <span className="flex items-center gap-1">
                <Money
                  paise={day.revenue.totalPaise}
                  className="text-base font-bold"
                  data-testid="revenue-total"
                />
                {day.revenue.isCeiling && (
                  <>
                    <Chip tone="neutral">ceiling</Chip>
                    <Why label="why the total is a ceiling">
                      One channel&rsquo;s commission is not known yet, so the total cannot be more
                      than this and may be less.
                    </Why>
                  </>
                )}
              </span>
            </div>

            <Line
              label="Cash"
              paise={day.revenue.cashPaise}
              chips={<Chip tone="neutral">{day.revenue.cashBills} bills</Chip>}
              testId="revenue-cash"
            />
            <Line
              label="UPI"
              paise={day.revenue.upiPaise}
              chips={<Chip tone="neutral">{day.revenue.upiBills} bills</Chip>}
              testId="revenue-upi"
            />

            {day.revenue.channels.map((channel) => (
              <div key={channel.channel} data-testid={`channel-${channel.channel}`}>
                <Line
                  label={channel.channel}
                  paise={channel.grossPaise}
                  chips={
                    <>
                      <Chip tone={channel.settlementState === 'settled' ? 'good' : 'neutral'}>
                        {channel.settlementState}
                      </Chip>
                      {channel.commissionPaise === null ? (
                        // Never nought. A commission nobody has stated is not a
                        // commission of zero.
                        <Chip
                          tone="neutral"
                          data-testid={`channel-commission-unknown-${channel.channel}`}
                        >
                          commission not known yet
                        </Chip>
                      ) : (
                        <Chip tone="neutral">
                          − <Money paise={channel.commissionPaise} /> fee
                        </Chip>
                      )}
                      {channel.netPaise !== null && (
                        <Chip tone="neutral">
                          net <Money paise={channel.netPaise} />
                        </Chip>
                      )}
                    </>
                  }
                  testId={`channel-gross-${channel.channel}`}
                />
              </div>
            ))}
          </Card>

          {/* ── Drawer, ordered by instant ───────────────────────────────── */}
          <Card className="space-y-2" data-testid="ledger-drawer">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-content-muted">
                Drawer
              </h2>
              <ChipRow>
                {day.drawer.state === 'counted' && (
                  <Chip tone="good" icon={Check}>
                    counted
                  </Chip>
                )}
                {day.drawer.state === 'carried' && (
                  <>
                    <Chip tone="neutral" data-testid="drawer-carried">
                      carried
                    </Chip>
                    <Why label="what carried means">
                      Nobody counted the drawer on this date, so both balances are what the app
                      believes rather than what anybody checked.
                      {day.drawer.lastConfirmedAt &&
                        ` Last confirmed ${formatDateTime(day.drawer.lastConfirmedAt)}.`}
                    </Why>
                  </>
                )}
                {day.drawer.state === 'not-tracked-yet' && (
                  <>
                    <Chip tone="neutral" data-testid="drawer-not-tracked-yet">
                      not tracked yet
                    </Chip>
                    <Why label="what not tracked yet means">
                      The drawer was not being followed on this date. Revenue and expenses above are
                      complete; there is simply no balance to state, and inventing one would be a
                      figure nobody checked.
                    </Why>
                  </>
                )}
                {day.drawer.observationCoversDays !== null &&
                  day.drawer.observationCoversDays > 1 && (
                    <>
                      <Chip tone="warn" data-testid="covers-days">
                        covers {day.drawer.observationCoversDays} days
                      </Chip>
                      <Why label="what a multi-day count means">
                        That count covers several days, so a difference cannot be pinned to one
                        night.
                      </Why>
                    </>
                  )}
              </ChipRow>
            </div>

            {day.drawer.state !== 'not-tracked-yet' && (
              <>
                <BalanceLine
                  label="Open 04:00"
                  paise={day.drawer.openingPaise}
                  testId="drawer-opening"
                />

                {day.drawer.timeline.map((event, index) => (
                  <TimelineRow key={`${event.kind}-${index}`} event={event} index={index} />
                ))}

                <BalanceLine
                  label="Close 04:00"
                  paise={day.drawer.closingPaise}
                  testId="drawer-closing"
                />

                {/* Only where a count actually happened. On a `carried` date
                    nothing was counted, so there is no float left to
                    distinguish from the closing balance and the chip would be
                    answering a question nobody asked. */}
                {day.drawer.state === 'counted' && (
                  <ChipRow>
                    <Chip tone="neutral" data-testid="left-is-not-opening">
                      left ≠ next opening
                    </Chip>
                    <Why label="why what was left is not the next opening">
                      What was left at the count is not the next day&rsquo;s opening — the counter
                      went on trading afterwards.
                    </Why>
                  </ChipRow>
                )}
              </>
            )}
          </Card>

          {/* ── Expenses ─────────────────────────────────────────────────── */}
          <Card className="space-y-1" data-testid="ledger-expenses">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-content-muted">
                Expenses
              </h2>
              <Money
                paise={day.expenses.totalPaise}
                className="text-base font-bold"
                data-testid="expenses-total"
              />
            </div>
            {day.expenses.rows.length === 0 ? (
              <p className="text-xs text-content-muted">Nothing recorded.</p>
            ) : (
              day.expenses.rows.map((row) => (
                <div key={row.id} data-testid={`expense-${row.id}`}>
                  <Line
                    label={row.label}
                    paise={row.paise}
                    chips={
                      <>
                        <Chip tone={row.isCash ? 'neutral' : 'good'}>
                          {row.isCash ? 'cash' : 'not cash'}
                        </Chip>
                        <Chip tone="neutral" icon={Clock}>
                          {formatTime(row.instant)}
                        </Chip>
                        {row.recordedByName && <Chip tone="neutral">{row.recordedByName}</Chip>}
                      </>
                    }
                    testId={`expense-amount-${row.id}`}
                  />
                </div>
              ))
            )}
          </Card>

          {/* ── Verify: one day, one action ──────────────────────────────── */}
          <Card className="space-y-2" data-testid="ledger-verify">
            {day.verifications.length > 0 && (
              <ChipRow>
                {day.verifications.map((verification) => (
                  <Chip
                    key={verification.id}
                    tone="good"
                    icon={Check}
                    data-testid={`verification-${verification.id}`}
                  >
                    {verification.verifiedByName ?? 'verified'} ·{' '}
                    {formatDateTime(verification.verifiedAt)}
                  </Chip>
                ))}
              </ChipRow>
            )}
            <div className="flex items-center gap-2">
              <Button
                className="flex-1"
                size="phone"
                onClick={verify}
                disabled={busy}
                data-testid="verify-day"
              >
                Verify this day
              </Button>
              <Why label="what verifying does and does not do">
                An acknowledgement that you read it. It freezes nothing, is required by nothing, and
                each day is verified on its own.
              </Why>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}

/** One drawer movement or observation block, in the order it happened. */
function TimelineRow({ event, index }: { event: LedgerDrawerEvent; index: number }) {
  if (event.kind === 'cash-sales') {
    return (
      <Line
        label="Cash sales"
        paise={event.paise}
        chips={<Chip tone="neutral">{event.bills} bills</Chip>}
        testId="timeline-cash-sales"
        indent
      />
    )
  }

  if (event.kind === 'cash-expense') {
    return (
      <Line
        label={event.label}
        paise={-event.paise}
        chips={
          <Chip tone="neutral" icon={Clock}>
            {formatTime(event.instant)}
          </Chip>
        }
        testId={`timeline-expense-${index}`}
        indent
      />
    )
  }

  if (event.kind === 'cash-out') {
    return (
      <Line
        label={event.label}
        paise={-event.paise}
        chips={
          <>
            <Chip tone="neutral" icon={Clock}>
              {formatTime(event.instant)}
            </Chip>
            {event.spend && <Chip tone="neutral">not an operating cost</Chip>}
          </>
        }
        testId={`timeline-cash-out-${index}`}
        indent
      />
    )
  }

  const observation = event.observation
  const collected = observation.ownCashOut.reduce((sum, movement) => sum + movement.amountPaise, 0)
  const left = observation.countedTotalPaise - collected
  const difference = observation.differencePaise ?? 0

  return (
    <div
      className="my-1 space-y-1 rounded-lg border border-border bg-surface-raised p-2"
      data-testid={`timeline-observation-${observation.id}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-bold uppercase tracking-wide text-content">
          Count {formatTime(observation.countedAt)}
        </span>
        <Money
          paise={observation.countedTotalPaise}
          className="text-sm font-semibold"
          data-testid={`observation-counted-${observation.id}`}
        />
      </div>

      <ChipRow>
        {observation.isAnchor ? (
          <Chip tone="neutral">first count</Chip>
        ) : difference === 0 ? (
          <Chip tone="good" icon={Check}>
            matched
          </Chip>
        ) : (
          <Chip
            tone="bad"
            icon={difference < 0 ? ArrowDownRight : ArrowUpRight}
            data-testid={`observation-variance-${observation.id}`}
          >
            <Money paise={Math.abs(difference)} /> {difference < 0 ? 'short' : 'over'}
          </Chip>
        )}
        {!observation.isAnchor && observation.expectedPaise !== null && (
          <Chip tone="neutral" data-testid={`observation-expected-${observation.id}`}>
            expected <Money paise={observation.expectedPaise} />
          </Chip>
        )}
        {collected !== 0 && (
          <Chip
            tone="neutral"
            icon={collected < 0 ? Plus : Minus}
            data-testid={`observation-collected-${observation.id}`}
          >
            <Money paise={Math.abs(collected)} /> {collected < 0 ? 'in' : 'out'}
          </Chip>
        )}
        <Chip tone="neutral" data-testid={`observation-left-${observation.id}`}>
          left <Money paise={left} />
        </Chip>
        {observation.isApproximate && <Chip tone="neutral">~ approx</Chip>}
        {!observation.onSite && (
          <Chip tone="neutral" icon={MapPinOff}>
            away
          </Chip>
        )}
      </ChipRow>

      <p className="text-[0.6875rem] text-content-muted">
        recorded {formatDateTime(observation.recordedAt)}
        {observation.recordedByName ? ` · ${observation.recordedByName}` : ''}
      </p>
    </div>
  )
}

/**
 * The first day of the month `months` back from a business date.
 *
 * Computed here rather than imported from `features/manual-ledger`, whose whole
 * folder goes when `retire-the-manual-ledger` (#12) lands. A surface that
 * outlives it must not make that deletion a breakage somewhere else — the same
 * reasoning that moved `PeriodBar` into `components/ui` in the first place.
 */
function monthsBackFrom(businessDate: string, months: number): string {
  const [year, month] = businessDate.split('-').map(Number)
  if (!year || !month) return businessDate
  const zeroBased = year * 12 + (month - 1) - months
  const floorYear = Math.floor(zeroBased / 12)
  const floorMonth = (zeroBased % 12) + 1
  return `${String(floorYear).padStart(4, '0')}-${String(floorMonth).padStart(2, '0')}-01`
}

/** A figure with its label and its chips. */
function Line({
  label,
  paise,
  chips,
  testId,
  indent = false,
}: {
  label: string
  paise: number
  chips?: React.ReactNode
  testId: string
  indent?: boolean
}) {
  return (
    <div className={indent ? 'pl-3' : undefined}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 text-xs text-content">{label}</span>
        {/* `shrink-0` and `whitespace-nowrap` together: a long expense label was
            breaking "-₹2,600" across two lines, and a money figure split by a
            line break is the one thing a column of rupees may never do. The
            label gives way instead. */}
        <Money paise={paise} className="shrink-0 whitespace-nowrap text-sm" data-testid={testId} />
      </div>
      {chips && <ChipRow className="mt-0.5">{chips}</ChipRow>}
    </div>
  )
}

/** A balance, which may not exist at all before the outlet's first count. */
function BalanceLine({
  label,
  paise,
  testId,
}: {
  label: string
  paise: number | null
  testId: string
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-t border-border pt-1 first:border-t-0 first:pt-0">
      <span className="text-xs font-semibold text-content">{label}</span>
      {paise === null ? (
        <span className="text-xs text-content-muted" data-testid={testId}>
          not tracked yet
        </span>
      ) : (
        <Money paise={paise} className="text-sm font-semibold" data-testid={testId} />
      )}
    </div>
  )
}
