import {
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  Check,
  Clock,
  Lock,
  MapPinOff,
  Minus,
  Plus,
  Receipt,
  TriangleAlert,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'

import { FormSheet } from '@/components/layout/form-sheet'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Chip, ChipRow } from '@/components/ui/chip'
import { Input } from '@/components/ui/input'
import { LoadingFigures } from '@/components/ui/loading'
import { Money } from '@/components/ui/money'
import { Why } from '@/components/ui/why'
import { useAdapters } from '@/data-access'
import {
  DataActionError,
  type DrawerObservationRecord,
  type DrawerState,
} from '@/data-access/adapters'
import { formatDateTime, formatDayTime, formatTime, rupeesToPaise } from '@/domain'
import { useOutletScope } from '@/features/outlet-scope'

import { countAdvice, expectedAtInstant } from './drawer-arithmetic'

/**
 * The Cash drawer — the surface this business was commissioned to get right, at
 * the second attempt.
 *
 * **It opens on a balance, not a date picker.** That is the question the
 * collector has when they walk in: what should be in the drawer right now. The
 * screen it replaces opened on a business date and asked for a count against a
 * whole day's cash sales, which produced a fiction on every ordinary night —
 * ₹4,640 of it in one measured month across two outlets.
 *
 * **It is read on a phone, at 22:00, by somebody holding cash.** So a *fact* is a
 * chip and a *reason* is behind a `Why`. The first version of this file rendered
 * every reason inline and became a page of warning-coloured paragraphs, which is
 * how a reader learns to skip the paragraph that matters.
 *
 * Three things are load-bearing, each has a test, and **none of them may go
 * behind a disclosure**, because they are what the reader acts on:
 *
 *   * **The difference appears on the keystroke that produces it**, before
 *     anything is submitted, with its direction as a word as well as a sign. A
 *     minus is the first thing a small screen loses.
 *
 *   * **A negative amount announces that it means money ADDED**, on the keystroke
 *     that makes it negative rather than at submission. The stated action, the
 *     balance preview and the confirming control all flip with the sign.
 *
 *   * **An exact bill-run coincidence is reported as a fact; a nearby instant is
 *     never proposed.** See `drawer-arithmetic.ts`, where the refusal lives so it
 *     can be asserted directly.
 */

type Sheet = 'none' | 'count' | 'collect' | 'spend' | 'adjust'

export function CashDrawerSurface() {
  const { cashDrawer: adapter, counter } = useAdapters()
  const { outletId, selector: outletSelector } = useOutletScope()

  const [state, setState] = useState<DrawerState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [sheet, setSheet] = useState<Sheet>('none')

  /**
   * Tablets holding work they have not delivered.
   *
   * Read from the counter adapter rather than folded into `DrawerState`, because
   * the drawer's policy grants no reach over `counter_devices` and an adapter
   * borrowing an authority the database did not give it is the seam violation
   * this repo's layering exists to prevent.
   */
  const [unsynced, setUnsynced] = useState<{ count: number; since: string | null }>({
    count: 0,
    since: null,
  })

  // The count sheet.
  const [counted, setCounted] = useState('')
  const [collecting, setCollecting] = useState('')
  const [countedAt, setCountedAt] = useState<Date>(() => new Date())
  const [sheetOpenedAt, setSheetOpenedAt] = useState<number>(() => Date.now())
  const [certain, setCertain] = useState(true)
  const [awayReason, setAwayReason] = useState('')

  // The standalone sheets.
  const [movementAmount, setMovementAmount] = useState('')
  const [movementReason, setMovementReason] = useState('')

  // The adjustment sheet.
  const [adjustingId, setAdjustingId] = useState<string | null>(null)
  const [adjustedAmount, setAdjustedAmount] = useState('')
  const [adjustReason, setAdjustReason] = useState('')

  const load = useCallback(async () => {
    if (!outletId) return
    setState(await adapter.getState(outletId))
  }, [adapter, outletId])

  useEffect(() => {
    if (!outletId) return
    let active = true
    void adapter
      .getState(outletId)
      .then((loaded) => {
        if (active) setState(loaded)
      })
      .catch(() => {
        if (active) setError('Could not read the drawer. Try again in a moment.')
      })
    return () => {
      active = false
    }
  }, [adapter, outletId])

  useEffect(() => {
    if (!outletId) return
    let active = true
    void counter
      .listDevices()
      .then((devices) => {
        if (!active) return
        const behind = devices.filter(
          (device) => device.outletId === outletId && device.lastReportedUnsent > 0,
        )
        setUnsynced({
          count: behind.length,
          // The OLDEST heartbeat: "since when" is the worst case rather than the
          // most recent, because that is what says how much cash could be
          // missing from the expected figure.
          since:
            behind
              .map((device) => device.lastSeenAt)
              .filter((seen): seen is string => seen !== null)
              .sort((a, b) => a.localeCompare(b))[0] ?? null,
        })
      })
      // Not something the collector can act on, and it must never stop a count.
      .catch(() => {})
    return () => {
      active = false
    }
  }, [counter, outletId])

  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await action()
      await load()
      return true
    } catch (cause) {
      setError(
        cause instanceof DataActionError
          ? cause.message
          : 'That did not work. Try again in a moment.',
      )
      return false
    } finally {
      setBusy(false)
    }
  }

  // ── What the sheet may say, computed as it is typed ──────────────────────
  const countedRupees = Number(counted.trim())
  const countedUsable =
    counted.trim() !== '' && Number.isFinite(countedRupees) && countedRupees >= 0

  const advice = useMemo(() => {
    if (!state || !countedUsable || state.lastObservation === null) return null
    return countAdvice(state, rupeesToPaise(countedRupees), countedAt, !certain)
  }, [state, countedUsable, countedRupees, countedAt, certain])

  const boundary = useMemo(() => {
    if (!state || state.lastObservation === null) return null
    return expectedAtInstant(state, countedAt)
  }, [state, countedAt])

  const collectingRupees = Number(collecting.trim())
  const collectingUsable = collecting.trim() !== '' && Number.isFinite(collectingRupees)
  const collectingPaise = collectingUsable ? rupeesToPaise(collectingRupees) : 0
  // **A negative is cash going IN.** Same field, same record, no second control —
  // and the meaning is stated on the keystroke that creates it.
  const collectingIsAdding = collectingUsable && collectingPaise < 0
  const leavingPaise = countedUsable ? rupeesToPaise(countedRupees) - collectingPaise : null

  const movementRupees = Number(movementAmount.trim())
  const movementUsable = movementAmount.trim() !== '' && Number.isFinite(movementRupees)
  const movementPaise = movementUsable ? rupeesToPaise(movementRupees) : 0
  const movementIsAdding = movementUsable && movementPaise < 0

  function closeSheets() {
    setSheet('none')
    setCounted('')
    setCollecting('')
    setAwayReason('')
    setMovementAmount('')
    setMovementReason('')
    setAdjustingId(null)
    setAdjustedAmount('')
    setAdjustReason('')
    setCertain(true)
    setCountedAt(new Date())
    setError(null)
  }

  function openCount() {
    const now = Date.now()
    setSheetOpenedAt(now)
    setCountedAt(new Date(now))
    setCertain(true)
    setSheet('count')
  }

  async function submitCount(event: FormEvent) {
    event.preventDefault()
    if (!outletId || !countedUsable) return
    const ok = await run(async () => {
      await adapter.recordObservation({
        outletId,
        countedAt: countedAt.toISOString(),
        countedTotalPaise: rupeesToPaise(countedRupees),
        certain,
        position: null,
        awayReason: awayReason.trim() || null,
        cashOut:
          collectingUsable && collectingPaise !== 0
            ? { amountPaise: collectingPaise, kind: 'collection' }
            : null,
      })
    })
    if (ok) closeSheets()
  }

  async function submitMovement(event: FormEvent, kind: 'collection' | 'spend') {
    event.preventDefault()
    if (!outletId || !movementUsable) return
    const ok = await run(async () => {
      await adapter.recordCashOut({
        outletId,
        amountPaise: movementPaise,
        kind,
        reason: movementReason.trim() || null,
        position: null,
        awayReason: awayReason.trim() || 'recorded from the app',
      })
    })
    if (ok) closeSheets()
  }

  async function submitAdjustment(event: FormEvent) {
    event.preventDefault()
    if (!adjustingId) return
    const rupees = Number(adjustedAmount.trim())
    if (!Number.isFinite(rupees) || rupees < 0) {
      setError('Enter what the count should have been, in rupees.')
      return
    }
    const ok = await run(async () => {
      await adapter.adjustObservation(adjustingId, rupeesToPaise(rupees), adjustReason)
    })
    if (ok) closeSheets()
  }

  const adjusting = state?.recentObservations.find((row) => row.id === adjustingId) ?? null
  // Editable until the next observation anchors on it, so the most recent is the
  // only one nothing has anchored on.
  const newestId = state?.recentObservations[0]?.id ?? null

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader scope={outletSelector} title="Cash drawer" />

      {error && (
        <p
          role="alert"
          data-testid="drawer-error"
          className="mb-3 text-sm font-semibold text-danger"
        >
          {error}
        </p>
      )}

      {state === null ? (
        <LoadingFigures label="the drawer" rows={[4, 4]} data-testid="drawer-loading" />
      ) : (
        <div className="space-y-3">
          {state.exceptions.length > 0 && (
            <Card className="space-y-2" data-testid="drawer-exception">
              <ChipRow>
                <Chip tone="warn" icon={TriangleAlert}>
                  Needs a look
                </Chip>
                <Why label="why a late arrival is not folded in">
                  A count is what somebody saw. Work landing afterwards is reported here rather than
                  folded in, because rewriting a recorded figure is the failure this whole chain
                  exists to prevent.
                </Why>
              </ChipRow>

              {state.exceptions.map((exception) => (
                <div
                  key={exception.sourceId}
                  className="space-y-1 border-t border-border pt-2"
                  data-testid={`exception-${exception.sourceId}`}
                >
                  <p className="flex items-baseline justify-between gap-2 text-xs">
                    <span className="text-content-muted">{exception.label}</span>
                    <Money paise={exception.amountPaise} className="font-semibold" />
                  </p>
                  <ChipRow>
                    <Chip icon={Clock}>rung {formatTime(exception.occurredAt)}</Chip>
                    <Chip icon={Clock}>arrived {formatDayTime(exception.arrivedAt)}</Chip>
                    {exception.explainsRecordedVariance ? (
                      <Chip tone="good" icon={Check}>
                        explains that count
                      </Chip>
                    ) : (
                      <Chip tone="neutral">
                        would have been <Money paise={exception.differenceWouldHaveBeenPaise} />
                      </Chip>
                    )}
                    {exception.acknowledgedAt && (
                      <Chip tone="good" icon={Check}>
                        accepted {formatDayTime(exception.acknowledgedAt)}
                      </Chip>
                    )}
                  </ChipRow>
                  {exception.acknowledgementNote && (
                    <p className="text-xs italic text-content-muted">
                      {exception.acknowledgementNote}
                    </p>
                  )}
                  {!exception.acknowledgedAt && (
                    <div className="flex gap-2">
                      <Button
                        size="phone"
                        variant="secondary"
                        disabled={busy}
                        onClick={() =>
                          void run(() =>
                            adapter.acknowledgeException(
                              exception.observationId,
                              exception.sourceKind,
                              exception.sourceId,
                            ),
                          )
                        }
                        data-testid={`accept-${exception.sourceId}`}
                      >
                        Accept
                      </Button>
                      <Button size="phone" variant="secondary" onClick={openCount}>
                        Count again
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </Card>
          )}

          {/* ── The balance ─────────────────────────────────────────────── */}
          <Card className="space-y-3" data-testid="drawer-balance">
            {state.lastObservation === null ? (
              // Before the anchor there is no balance to state, and inventing one
              // would be the fabricated figure decision 18 refuses.
              <div className="space-y-2" data-testid="drawer-not-tracked">
                <p className="text-sm font-semibold text-content">
                  This drawer has never been counted.
                </p>
                <ChipRow>
                  <Chip tone="neutral">not tracked yet</Chip>
                  <Why label="what not tracked yet means">
                    Count it once and the record begins there. Earlier days keep their revenue and
                    expenses and say the drawer was not being followed, rather than showing a
                    balance nobody checked.
                  </Why>
                </ChipRow>
              </div>
            ) : (
              <>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-content-muted">
                    In the drawer now
                  </p>
                  <Money paise={state.expectedNowPaise ?? 0} display data-testid="expected-now" />
                </div>

                <ChipRow data-testid="balance-chips">
                  <Chip icon={Clock} data-testid="last-counted">
                    {formatDayTime(state.lastObservation.countedAt)}
                  </Chip>
                  {state.lastObservation.isApproximate && <Chip tone="neutral">~ approx</Chip>}
                  {!state.lastObservation.onSite && (
                    <Chip tone="neutral" icon={MapPinOff}>
                      away
                    </Chip>
                  )}
                  {state.daysCovered > 1 && (
                    <>
                      <Chip tone="warn" icon={TriangleAlert} data-testid="days-covered">
                        {state.daysCovered} days uncounted
                      </Chip>
                      <Why label="what counting after several days means">
                        The next count covers all of them, so a difference cannot be pinned to one
                        night.
                      </Why>
                    </>
                  )}
                  {unsynced.count > 0 && (
                    <>
                      <Chip tone="warn" icon={TriangleAlert} data-testid="unsynced-chip">
                        {unsynced.count} tablet{unsynced.count === 1 ? '' : 's'} behind
                      </Chip>
                      <Why label="what an unsent tablet means for this figure">
                        The figure above may be understated by bills a tablet has not sent
                        {unsynced.since
                          ? `, last heard from ${formatDateTime(unsynced.since)}`
                          : ''}
                        . Count anyway — you are the one holding the cash.
                      </Why>
                    </>
                  )}
                </ChipRow>

                <div className="grid grid-cols-3 gap-2 border-t border-border pt-2 text-center">
                  <Figure label="Left" paise={state.leftInDrawerPaise ?? 0} testId="left" />
                  <Figure
                    label="Bills"
                    paise={state.cashReceiptsSincePaise}
                    rows={state.cashReceiptsSinceCount}
                    testId="receipts-since"
                    signed
                  />
                  <Figure
                    label="Expenses"
                    paise={-state.cashExpensesSincePaise}
                    rows={state.cashExpensesSinceCount}
                    testId="expenses-since"
                  />
                </div>
              </>
            )}
          </Card>

          {/* ── The actions ─────────────────────────────────────────────── */}
          <div className="space-y-2">
            <Button className="w-full" onClick={openCount} data-testid="open-count">
              <Banknote aria-hidden size={16} /> Count the drawer
            </Button>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="phone"
                className="flex-1"
                onClick={() => setSheet('collect')}
                data-testid="open-collect"
              >
                <Minus aria-hidden size={14} /> Collect
              </Button>
              {/* Deliberately the quieter of the two: the escape hatch has to
                  survive, well away from the primary action (design D5). */}
              <Button
                variant="ghost"
                size="phone"
                className="flex-1"
                onClick={() => setSheet('spend')}
                data-testid="open-spend"
              >
                <Receipt aria-hidden size={14} /> Spend
              </Button>
            </div>
          </div>

          {/* ── Recent counts ───────────────────────────────────────────── */}
          {state.recentObservations.length > 0 && (
            <Card className="space-y-2" data-testid="recent-counts">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-content-muted">
                Recent counts
              </h2>
              {state.recentObservations.map((observation) => (
                <ObservationRow
                  key={observation.id}
                  observation={observation}
                  locked={observation.id !== newestId}
                  onAdjust={() => {
                    setAdjustingId(observation.id)
                    setAdjustedAmount('')
                    setAdjustReason('')
                    setSheet('adjust')
                  }}
                />
              ))}
            </Card>
          )}
        </div>
      )}

      {/* ── Count the drawer ────────────────────────────────────────────── */}
      <FormSheet
        open={sheet === 'count'}
        onClose={closeSheets}
        title="Count the drawer"
        error={error}
        footer={
          <Button
            type="submit"
            form="count-form"
            className="w-full"
            disabled={busy || !countedUsable}
            data-testid="save-count"
          >
            Save count
          </Button>
        }
      >
        <form id="count-form" onSubmit={submitCount} className="space-y-4">
          <fieldset className="space-y-2">
            <legend className="text-sm font-bold text-content">1 · When?</legend>
            <div className="flex flex-wrap gap-2">
              {[
                { label: 'Just now', minutes: 0 },
                { label: '30 min', minutes: 30 },
                { label: '1 hr', minutes: 60 },
                { label: '2 hr', minutes: 120 },
              ].map((option) => {
                const candidate = new Date(sheetOpenedAt - option.minutes * 60_000)
                const chosen = Math.abs(countedAt.getTime() - candidate.getTime()) < 90_000
                return (
                  <Button
                    key={option.label}
                    type="button"
                    size="phone"
                    variant={chosen ? 'primary' : 'secondary'}
                    onClick={() => {
                      setCountedAt(candidate)
                      // Anything but "just now" is approximate by default: people
                      // do not know the minute, and a required field they cannot
                      // answer truthfully is one they answer untruthfully.
                      setCertain(option.minutes === 0)
                    }}
                    data-testid={`when-${option.minutes}`}
                  >
                    {option.label}
                  </Button>
                )
              })}
            </div>
            <ChipRow>
              <Chip icon={Clock} data-testid="counted-at-echo">
                {formatTime(countedAt.toISOString())}
              </Chip>
              {!certain && (
                <>
                  <Chip tone="neutral">~ ±15 min</Chip>
                  <Button
                    type="button"
                    size="phone"
                    variant="ghost"
                    onClick={() => setCertain(true)}
                    data-testid="assert-certain"
                  >
                    I&rsquo;m sure
                  </Button>
                </>
              )}
              {boundary && boundary.excludedBills > 0 && (
                <Chip tone="neutral" data-testid="excluded-by-time">
                  leaves out <Money paise={boundary.excludedPaise} /> · {boundary.excludedBills}
                </Chip>
              )}
            </ChipRow>
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-sm font-bold text-content">2 · What was in it?</legend>
            <Input
              inputMode="decimal"
              value={counted}
              onChange={(event) => setCounted(event.target.value)}
              placeholder="8950"
              aria-label="Counted amount in rupees"
              data-testid="counted-input"
            />
            {advice && (
              // On the keystroke, before anything is saved. Never behind a tap.
              <div className="space-y-1" data-testid="count-difference">
                {advice.direction === 'balanced' ? (
                  <ChipRow>
                    <Chip tone="good" icon={Check}>
                      matches <Money paise={advice.expectedPaise} />
                    </Chip>
                  </ChipRow>
                ) : (
                  <ChipRow>
                    <Chip
                      tone="bad"
                      icon={advice.direction === 'short' ? ArrowDownRight : ArrowUpRight}
                      // Its own handle, because the block around it also contains
                      // the `Why` button's screen-reader label — "what short and
                      // over mean here" — which carries both words and makes any
                      // direction test over the whole block read `short` always.
                      data-testid="count-direction"
                    >
                      <Money paise={Math.abs(advice.differencePaise)} />{' '}
                      {advice.direction === 'short' ? 'short' : 'over'}
                    </Chip>
                    <Why label="what short and over mean here">
                      {advice.direction === 'short'
                        ? 'This much is missing from the drawer against what was expected.'
                        : 'This much more than expected was counted.'}
                    </Why>
                  </ChipRow>
                )}

                {advice.coincidence && (
                  // An exact hit is unlikely to be chance, so saying so is an
                  // observation rather than an excuse.
                  <p className="text-xs text-content" data-testid="exact-coincidence">
                    Exactly the {advice.coincidence.bills.length} cash{' '}
                    {advice.coincidence.bills.length === 1 ? 'bill' : 'bills'} between{' '}
                    {formatTime(advice.coincidence.bills[0]?.paidAt.toISOString() ?? '')} and{' '}
                    {formatTime(advice.coincidence.bills.at(-1)?.paidAt.toISOString() ?? '')}.
                  </p>
                )}

                {!advice.coincidence && advice.direction !== 'balanced' && (
                  <ChipRow data-testid="no-coincidence">
                    <Chip tone="neutral">no run of bills matches</Chip>
                    {advice.timingCouldExplainPaise !== null &&
                      advice.timingCouldExplainPaise > 0 && (
                        <>
                          <Chip tone="neutral">
                            <Money paise={advice.timingCouldExplainPaise} /> moved nearby
                          </Chip>
                          <Why label="what nearby cash means for this difference">
                            Your time is approximate, so the timing could account for part of the
                            difference. Nothing here proposes a time — move the count time only if
                            you recognise the bills.
                          </Why>
                        </>
                      )}
                  </ChipRow>
                )}
              </div>
            )}
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-sm font-bold text-content">3 · Collecting any?</legend>
            <Input
              inputMode="decimal"
              value={collecting}
              onChange={(event) => setCollecting(event.target.value)}
              placeholder="7500"
              aria-label="Amount collected in rupees"
              data-testid="collecting-input"
            />
            {collectingIsAdding && (
              // **On the keystroke, not at submission, and never behind a tap.**
              // This alert is the whole protection against a mistyped minus.
              <p
                role="alert"
                className="rounded-lg bg-warning px-2 py-1 text-sm font-bold text-on-warning"
                data-testid="negative-warning"
              >
                A minus means you are ADDING money to the drawer, not taking it out.
              </p>
            )}
            {leavingPaise !== null && (
              <ChipRow>
                <Chip
                  tone="neutral"
                  icon={collectingIsAdding ? Plus : Minus}
                  data-testid="leaving-preview"
                >
                  leaving <Money paise={leavingPaise} />
                </Chip>
              </ChipRow>
            )}
          </fieldset>

          <div className="space-y-1">
            <label htmlFor="count-away" className="text-xs font-semibold text-content-muted">
              Not at the outlet? Say why
            </label>
            <Input
              id="count-away"
              value={awayReason}
              onChange={(event) => setAwayReason(event.target.value)}
              placeholder="counted at the counter, typed at home"
              data-testid="away-reason"
            />
            <p className="text-xs text-content-muted">
              Nothing is refused for being elsewhere. The record just says where you were.
            </p>
          </div>
        </form>
      </FormSheet>

      {/* ── Collect cash, and the rare spend ───────────────────────────── */}
      <FormSheet
        open={sheet === 'collect' || sheet === 'spend'}
        onClose={closeSheets}
        title={
          sheet === 'spend' ? 'Cash spend' : movementIsAdding ? 'Add to drawer' : 'Collect cash'
        }
        error={error}
        footer={
          <Button
            type="submit"
            form="movement-form"
            className="w-full"
            disabled={busy || !movementUsable || movementPaise === 0}
            data-testid="save-movement"
          >
            {sheet === 'spend' ? 'Record spend' : movementIsAdding ? 'Add to drawer' : 'Collect'}
          </Button>
        }
      >
        <form
          id="movement-form"
          onSubmit={(event) => submitMovement(event, sheet === 'spend' ? 'spend' : 'collection')}
          className="space-y-4"
        >
          <div className="space-y-2">
            <label htmlFor="movement-amount" className="text-sm font-bold text-content">
              How much?
            </label>
            <Input
              id="movement-amount"
              inputMode="decimal"
              value={movementAmount}
              onChange={(event) => setMovementAmount(event.target.value)}
              placeholder="5000"
              data-testid="movement-amount"
            />
            {movementIsAdding && sheet !== 'spend' && (
              <p
                role="alert"
                className="rounded-lg bg-warning px-2 py-1 text-sm font-bold text-on-warning"
                data-testid="movement-negative-warning"
              >
                A minus means you are ADDING money to the drawer, not taking it out.
              </p>
            )}
            {movementUsable && state && (
              <ChipRow>
                <Chip tone="neutral" data-testid="movement-preview">
                  <Money paise={state.expectedNowPaise ?? 0} /> →{' '}
                  <Money paise={(state.expectedNowPaise ?? 0) - movementPaise} />
                </Chip>
              </ChipRow>
            )}
          </div>

          {sheet === 'spend' ? (
            <div className="space-y-2">
              <label htmlFor="movement-reason" className="text-sm font-bold text-content">
                What did it buy?
              </label>
              <Input
                id="movement-reason"
                value={movementReason}
                onChange={(event) => setMovementReason(event.target.value)}
                placeholder="Chest freezer for the prep counter"
                data-testid="movement-reason"
              />
              <ChipRow>
                <Chip tone="neutral" data-testid="spend-not-an-expense">
                  not in the month&rsquo;s expenses
                </Chip>
                <Why label="why a spend is not an expense">
                  The drawer is genuinely lighter, but a fridge is not a running cost. Putting it
                  through expenses would move the drawer correctly and wreck the month.
                </Why>
              </ChipRow>
            </div>
          ) : (
            <ChipRow>
              <Chip tone="neutral" data-testid="collect-not-verified">
                nothing verified
              </Chip>
              <Why label="what collecting without counting does not do">
                You are not counting, so no difference is recorded and nothing is checked against
                the drawer.
              </Why>
            </ChipRow>
          )}
        </form>
      </FormSheet>

      {/* ── Adjust a locked count ──────────────────────────────────────── */}
      <FormSheet
        open={sheet === 'adjust'}
        onClose={closeSheets}
        title="Adjust a count"
        error={error}
        footer={
          <Button
            type="submit"
            form="adjust-form"
            className="w-full"
            disabled={busy || adjustReason.trim() === ''}
            data-testid="save-adjustment"
          >
            Post adjustment
          </Button>
        }
      >
        <form id="adjust-form" onSubmit={submitAdjustment} className="space-y-4">
          {adjusting && (
            <>
              <div className="space-y-2">
                <p className="flex items-baseline justify-between gap-2">
                  <span className="text-sm text-content-muted">
                    {formatDayTime(adjusting.countedAt)}
                  </span>
                  <Money paise={adjusting.countedTotalPaise} className="font-semibold" />
                </p>
                <ChipRow>
                  <Chip tone="neutral" icon={Lock}>
                    locked
                  </Chip>
                  <Why label="why this count is locked">
                    A later count read this figure as its own opening, which is the moment it became
                    load-bearing. Both figures stay on the record, and the later count re-anchors
                    the balance on what was physically there — so nothing after it moves.
                  </Why>
                </ChipRow>
              </div>

              <div className="space-y-1">
                <label htmlFor="adjusted-amount" className="text-sm font-bold text-content">
                  What should it have been?
                </label>
                <Input
                  id="adjusted-amount"
                  inputMode="decimal"
                  value={adjustedAmount}
                  onChange={(event) => setAdjustedAmount(event.target.value)}
                  data-testid="adjusted-amount"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="adjust-reason" className="text-sm font-bold text-content">
                  Why? (required)
                </label>
                <Input
                  id="adjust-reason"
                  value={adjustReason}
                  onChange={(event) => setAdjustReason(event.target.value)}
                  placeholder="miscounted, found a 500 note"
                  data-testid="adjust-reason"
                />
              </div>
            </>
          )}
        </form>
      </FormSheet>
    </div>
  )
}

/** One figure in the three-up strip. */
function Figure({
  label,
  paise,
  rows,
  testId,
  signed = false,
}: {
  label: string
  paise: number
  rows?: number
  testId: string
  signed?: boolean
}) {
  return (
    <div>
      <p className="text-[0.6875rem] uppercase tracking-wide text-content-muted">{label}</p>
      <Money
        paise={paise}
        className={signed && paise > 0 ? 'text-success' : undefined}
        data-testid={testId}
      />
      {rows !== undefined && <p className="text-[0.6875rem] text-content-muted">{rows}</p>}
    </div>
  )
}

/**
 * One recent count: the figure, then what it came to, as chips.
 *
 * Two lines rather than a paragraph. The first version of this row ran the
 * amount, the difference, the collection, the recorder and the break together in
 * one sentence, which on a phone wrapped to four lines of prose per count.
 */
function ObservationRow({
  observation,
  locked,
  onAdjust,
}: {
  observation: DrawerObservationRecord
  locked: boolean
  onAdjust: () => void
}) {
  const collected = observation.ownCashOut.reduce((sum, movement) => sum + movement.amountPaise, 0)
  const difference = observation.differencePaise ?? 0

  return (
    <div
      className="space-y-1 border-t border-border pt-2 first:border-t-0 first:pt-0"
      data-testid={`observation-${observation.id}`}
    >
      <p className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 text-xs text-content-muted">
          {formatDayTime(observation.countedAt)}
        </span>
        <Money
          paise={observation.countedTotalPaise}
          className="shrink-0 whitespace-nowrap text-sm font-semibold"
        />
      </p>

      <ChipRow>
        {observation.isAnchor ? (
          <>
            <Chip tone="neutral" data-testid={`anchor-${observation.id}`}>
              first count
            </Chip>
            <Why label="what a first count means">
              The drawer began here — there is nothing before it to compare against, so this count
              records no difference at all.
            </Why>
          </>
        ) : difference === 0 ? (
          <Chip tone="good" icon={Check}>
            matched
          </Chip>
        ) : (
          <Chip tone="bad" icon={difference < 0 ? ArrowDownRight : ArrowUpRight}>
            <Money paise={Math.abs(difference)} /> {difference < 0 ? 'short' : 'over'}
          </Chip>
        )}

        {collected !== 0 && (
          <Chip tone="neutral" icon={collected < 0 ? Plus : Minus}>
            <Money paise={Math.abs(collected)} /> {collected < 0 ? 'in' : 'out'}
          </Chip>
        )}

        {observation.isApproximate && <Chip tone="neutral">~ approx</Chip>}

        {!observation.onSite && (
          <Chip tone="neutral" icon={MapPinOff}>
            away
          </Chip>
        )}

        {observation.openingBreakPaise !== null && (
          <>
            <Chip tone="warn" icon={TriangleAlert} data-testid={`break-${observation.id}`}>
              break <Money paise={observation.openingBreakPaise} />
            </Chip>
            <Why label="why the break is not repaired">
              This count opened at a figure the previous one does not carry to. It is reported and
              not repaired: a figure somebody&rsquo;s count produced is evidence, and a recomputed
              one is not.
            </Why>
          </>
        )}

        {locked && (
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold text-content-muted underline focus-visible:focus-ring"
            onClick={onAdjust}
            data-testid={`adjust-${observation.id}`}
          >
            <Lock aria-hidden size={11} /> adjust
          </button>
        )}
      </ChipRow>

      {(observation.recordedByName || observation.awayReason) && (
        <p className="text-[0.6875rem] text-content-muted">
          {observation.recordedByName}
          {observation.correctedByName &&
            observation.correctedByName !== observation.recordedByName &&
            ` · corrected by ${observation.correctedByName}`}
          {observation.awayReason && ` · ${observation.awayReason}`}
        </p>
      )}

      {observation.adjustments.map((adjustment) => (
        <p key={adjustment.id} className="text-[0.6875rem] text-content-muted">
          → <Money paise={adjustment.correctedCountedTotalPaise} /> (was{' '}
          <Money paise={adjustment.originalCountedTotalPaise} />) · {adjustment.reason}
        </p>
      ))}
    </div>
  )
}
