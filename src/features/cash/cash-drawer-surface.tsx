import { Banknote, Lock, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'

import { FormSheet } from '@/components/layout/form-sheet'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { LoadingFigures } from '@/components/ui/loading'
import { Money } from '@/components/ui/money'
import { useAdapters } from '@/data-access'
import { DataActionError, type DrawerState } from '@/data-access/adapters'
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
 * Three things here are load-bearing and each has a test asserting it:
 *
 *   * **The difference appears on the keystroke that produces it**, before
 *     anything is submitted, with its direction in words as well as by sign. A
 *     minus is the first thing a small screen loses, and *"₹240 short"* is not a
 *     sentence anyone misreads.
 *
 *   * **A negative amount announces that it means money ADDED**, on the keystroke
 *     that makes it negative rather than at submission. That alert is the entire
 *     protection against a mistyped minus, and it is required rather than
 *     advisory: the stated action, the balance preview and the confirming control
 *     all flip with the sign.
 *
 *   * **An exact bill-run coincidence is reported as a fact; a nearby instant is
 *     never proposed.** See `drawer-arithmetic.ts`, where the refusal lives so it
 *     can be asserted directly.
 */

const DIFFERENCE_WORDS = {
  short: 'short — this much is missing from the drawer',
  over: 'over — this much more than expected was counted',
  balanced: 'the drawer balances exactly',
} as const

type Sheet = 'none' | 'count' | 'collect' | 'spend' | 'adjust'

export function CashDrawerSurface() {
  const { cashDrawer: adapter } = useAdapters()
  const { outletId, selector: outletSelector } = useOutletScope()

  const [state, setState] = useState<DrawerState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [sheet, setSheet] = useState<Sheet>('none')

  // The count sheet's three inputs, plus the instant and the certainty control.
  const [counted, setCounted] = useState('')
  const [collecting, setCollecting] = useState('')
  const [countedAt, setCountedAt] = useState<Date>(() => new Date())
  /**
   * The instant the sheet opened, and the base every relative chip counts back
   * from.
   *
   * Captured once rather than read per render. `Date.now()` in the chip loop
   * made "30 min ago" mean a slightly different moment on every re-render, so
   * the chip highlighting drifted and the saved instant depended on how many
   * times React had re-rendered — which is the impurity the linter names.
   */
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
  // **A negative is cash going IN.** The same field, the same record, no second
  // control — and the meaning is stated on the keystroke that creates it.
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

  async function submitCount(event: FormEvent) {
    event.preventDefault()
    if (!outletId || !countedUsable) return
    const ok = await run(async () => {
      await adapter.recordObservation({
        outletId,
        countedAt: countedAt.toISOString(),
        countedTotalPaise: rupeesToPaise(countedRupees),
        certain,
        // No position in this build: the browser fix is captured by the
        // attendance surface and the drawer records what it is given. A count
        // with no position asks for a reason, exactly as one from home does —
        // nobody can tell from the row that the person was standing there.
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
      setError('Enter what the count should have been, as a number of rupees.')
      return
    }
    const ok = await run(async () => {
      await adapter.adjustObservation(adjustingId, rupeesToPaise(rupees), adjustReason)
    })
    if (ok) closeSheets()
  }

  const adjusting = state?.recentObservations.find((row) => row.id === adjustingId) ?? null
  // Editable until the next observation anchors on it. The most recent one is
  // the only one nothing has anchored on.
  const newestId = state?.recentObservations[0]?.id ?? null

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        scope={outletSelector}
        title="Cash drawer"
        subtitle="What should be in the drawer now, and what has moved since it was last counted."
      />

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
        <LoadingFigures label="the drawer" rows={[5, 3]} data-testid="drawer-loading" />
      ) : (
        <div className="space-y-3">
          {state.exceptions.length > 0 && (
            <Card className="space-y-2 border-warning" data-testid="drawer-exception">
              <p className="flex items-start gap-2 text-sm font-bold text-content">
                <TriangleAlert aria-hidden size={16} className="mt-0.5 shrink-0 text-warning" />
                Needs a look
              </p>
              <ul className="space-y-2 text-xs text-content">
                {state.exceptions.map((exception) => (
                  <li key={exception.sourceId} data-testid={`exception-${exception.sourceId}`}>
                    {exception.label} — <Money paise={exception.amountPaise} />, rung{' '}
                    {formatTime(exception.occurredAt)} and arrived{' '}
                    {formatDateTime(exception.arrivedAt)}.{' '}
                    {exception.explainsRecordedVariance ? (
                      <strong>This explains the difference on that count.</strong>
                    ) : (
                      <>
                        Had it been there, the difference would have been{' '}
                        <Money paise={exception.differenceWouldHaveBeenPaise} />.
                      </>
                    )}
                    {exception.acknowledgedAt && (
                      <em className="block text-content-muted">
                        Accepted {formatDateTime(exception.acknowledgedAt)}
                        {exception.acknowledgedByName ? ` by ${exception.acknowledgedByName}` : ''}
                        {exception.acknowledgementNote ? ` — ${exception.acknowledgementNote}` : ''}
                      </em>
                    )}
                    {!exception.acknowledgedAt && (
                      <span className="mt-1 flex gap-2">
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
                        <Button size="phone" variant="secondary" onClick={() => setSheet('count')}>
                          Count again
                        </Button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-content-muted">
                The recorded figures have <strong>not</strong> been changed. A count is what
                somebody saw, and work landing afterwards must not rewrite it.
              </p>
            </Card>
          )}

          <Card className="space-y-2" data-testid="drawer-balance">
            {state.lastObservation === null ? (
              // Before the anchor there is no balance to state, and inventing one
              // would be the fabricated figure decision 18 refuses.
              <div className="space-y-1" data-testid="drawer-not-tracked">
                <p className="text-sm font-bold text-content">This drawer is not tracked yet.</p>
                <p className="text-xs text-content-muted">
                  Count it once and the record begins there. Earlier days keep their revenue and
                  expenses, and say plainly that the drawer was not being followed — rather than
                  showing a balance nobody checked.
                </p>
              </div>
            ) : (
              <>
                <div className="flex items-baseline justify-between">
                  <span className="text-sm font-bold text-content">
                    Should be in the drawer now
                  </span>
                  <Money paise={state.expectedNowPaise ?? 0} display data-testid="expected-now" />
                </div>

                <p className="text-xs text-content-muted" data-testid="last-counted">
                  Last counted {formatDayTime(state.lastObservation.countedAt)}
                  {state.lastObservation.isApproximate ? ' (time approximate)' : ''}
                  {state.lastObservation.onSite ? '' : ', recorded away from the outlet'}
                </p>

                {state.daysCovered > 1 && (
                  <p className="text-xs font-semibold text-warning" data-testid="days-covered">
                    Nothing has been counted for {state.daysCovered} days. The next count will cover
                    all of them, so a difference cannot be pinned to one night.
                  </p>
                )}

                <Row label="Left in drawer" paise={state.leftInDrawerPaise ?? 0} testId="left" />
                <Row
                  label="Cash bills since"
                  paise={state.cashReceiptsSincePaise}
                  testId="receipts-since"
                  hint={`${state.cashReceiptsSinceCount} ${
                    state.cashReceiptsSinceCount === 1 ? 'bill' : 'bills'
                  }`}
                />
                <Row
                  label="Cash expenses since"
                  paise={-state.cashExpensesSincePaise}
                  testId="expenses-since"
                  hint={`${state.cashExpensesSinceCount} ${
                    state.cashExpensesSinceCount === 1 ? 'entry' : 'entries'
                  }`}
                />
                {state.cashOutSinceCount > 0 && (
                  <Row
                    label={state.cashOutSincePaise < 0 ? 'Cash added since' : 'Cash taken since'}
                    paise={-state.cashOutSincePaise}
                    testId="cash-out-since"
                  />
                )}
              </>
            )}
          </Card>

          <div className="space-y-2">
            <Button
              className="w-full"
              onClick={() => {
                const now = Date.now()
                setSheetOpenedAt(now)
                setCountedAt(new Date(now))
                setCertain(true)
                setSheet('count')
              }}
              data-testid="open-count"
            >
              <Banknote aria-hidden size={16} /> Count the drawer
            </Button>
            <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs">
              <button
                type="button"
                className="underline text-content-muted"
                onClick={() => setSheet('collect')}
                data-testid="open-collect"
              >
                collect cash without counting
              </button>
              {/* Deliberately less prominent than a collection: the escape hatch
                  has to survive, and it survives as a small link well away from
                  the primary action (design D5). */}
              <button
                type="button"
                className="underline text-content-muted"
                onClick={() => setSheet('spend')}
                data-testid="open-spend"
              >
                spent it on something? record a cash spend
              </button>
            </div>
          </div>

          {state.recentObservations.length > 0 && (
            <Card className="space-y-2" data-testid="recent-counts">
              <h2 className="text-sm font-bold text-content">Recent counts</h2>
              {state.recentObservations.map((observation) => (
                <div
                  key={observation.id}
                  className="border-t border-border pt-2 text-xs first:border-t-0 first:pt-0"
                  data-testid={`observation-${observation.id}`}
                >
                  <p className="flex items-baseline justify-between">
                    <span className="text-content-muted">
                      {formatDayTime(observation.countedAt)}
                      {observation.isApproximate && ' ~'}
                    </span>
                    <Money paise={observation.countedTotalPaise} className="font-semibold" />
                  </p>
                  <p className="text-content-muted">
                    {observation.isAnchor ? (
                      // The anchor has no arithmetic at all, and the row says so
                      // rather than showing a difference of nought.
                      <span data-testid={`anchor-${observation.id}`}>
                        the drawer began here — nothing to compare it against
                      </span>
                    ) : (
                      <>
                        {observation.differencePaise === 0 ? (
                          'matched'
                        ) : (
                          <>
                            <Money paise={Math.abs(observation.differencePaise ?? 0)} />{' '}
                            {(observation.differencePaise ?? 0) < 0 ? 'short' : 'over'}
                          </>
                        )}
                        {observation.ownCashOut.length > 0 && (
                          <>
                            {' · '}
                            {observation.ownCashOut[0] &&
                            observation.ownCashOut[0].amountPaise < 0 ? (
                              <>
                                added{' '}
                                <Money paise={Math.abs(observation.ownCashOut[0].amountPaise)} />
                              </>
                            ) : (
                              <>
                                took <Money paise={observation.ownCashOut[0]?.amountPaise ?? 0} />
                              </>
                            )}
                          </>
                        )}
                      </>
                    )}
                    {observation.recordedByName && ` · ${observation.recordedByName}`}
                    {observation.correctedByName &&
                      observation.correctedByName !== observation.recordedByName &&
                      `, corrected by ${observation.correctedByName}`}
                    {!observation.onSite && ' · recorded away'}
                  </p>
                  {observation.awayReason && (
                    <p className="italic text-content-muted">{observation.awayReason}</p>
                  )}
                  {observation.openingBreakPaise !== null && (
                    <p
                      className="font-semibold text-warning"
                      data-testid={`break-${observation.id}`}
                    >
                      This count opened at a figure the previous one does not carry to, by{' '}
                      <Money paise={observation.openingBreakPaise} />. Reported, not repaired.
                    </p>
                  )}
                  {observation.adjustments.map((adjustment) => (
                    <p key={adjustment.id} className="text-content-muted">
                      Adjusted to <Money paise={adjustment.correctedCountedTotalPaise} /> from{' '}
                      <Money paise={adjustment.originalCountedTotalPaise} /> — {adjustment.reason}
                      {adjustment.adjustedByName ? `, ${adjustment.adjustedByName}` : ''}
                    </p>
                  ))}
                  {observation.id !== newestId && (
                    <button
                      type="button"
                      className="mt-1 flex items-center gap-1 underline text-content-muted"
                      onClick={() => {
                        setAdjustingId(observation.id)
                        setAdjustedAmount('')
                        setAdjustReason('')
                        setSheet('adjust')
                      }}
                      data-testid={`adjust-${observation.id}`}
                    >
                      <Lock aria-hidden size={12} /> adjust this count
                    </button>
                  )}
                </div>
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
          <fieldset className="space-y-1">
            <legend className="text-sm font-bold text-content">1 · When did you count it?</legend>
            <div className="flex flex-wrap gap-2">
              {[
                { label: 'Just now', minutes: 0 },
                { label: '30 min ago', minutes: 30 },
                { label: '1 hr ago', minutes: 60 },
                { label: '2 hr ago', minutes: 120 },
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
            <p className="text-xs text-content-muted" data-testid="counted-at-echo">
              Counting at {formatTime(countedAt.toISOString())}
              {!certain && ` (approximate, ±15 min)`}
            </p>
            {boundary && boundary.excludedBills > 0 && (
              <p className="text-xs text-content-muted" data-testid="excluded-by-time">
                That leaves out <Money paise={boundary.excludedPaise} /> of cash from{' '}
                {boundary.excludedBills} {boundary.excludedBills === 1 ? 'bill' : 'bills'} rung
                afterwards.
              </p>
            )}
            {!certain && (
              <Button
                type="button"
                size="phone"
                variant="secondary"
                onClick={() => setCertain(true)}
                data-testid="assert-certain"
              >
                I&rsquo;m sure of the time
              </Button>
            )}
          </fieldset>

          <fieldset className="space-y-1">
            <legend className="text-sm font-bold text-content">2 · What was in the drawer?</legend>
            <Input
              inputMode="decimal"
              value={counted}
              onChange={(event) => setCounted(event.target.value)}
              placeholder="8950"
              aria-label="Counted amount in rupees"
              data-testid="counted-input"
            />
            {advice && (
              // The difference appears the moment the amount is typed, before
              // anything is saved, with its direction in words as well as by sign.
              <div className="space-y-1" data-testid="count-difference">
                <p
                  className={
                    advice.direction === 'balanced'
                      ? 'text-sm font-semibold text-content'
                      : 'text-sm font-bold text-warning'
                  }
                >
                  {advice.direction === 'balanced' ? (
                    <>
                      Matches <Money paise={advice.expectedPaise} />
                    </>
                  ) : (
                    <>
                      <Money paise={Math.abs(advice.differencePaise)} />{' '}
                      {DIFFERENCE_WORDS[advice.direction]}
                    </>
                  )}
                </p>

                {advice.coincidence && (
                  // An exact hit is unlikely to be chance, so saying so is an
                  // observation rather than an excuse.
                  <p className="text-xs text-content" data-testid="exact-coincidence">
                    That is exactly the {advice.coincidence.bills.length} cash{' '}
                    {advice.coincidence.bills.length === 1 ? 'bill' : 'bills'} rung between{' '}
                    {formatTime(advice.coincidence.bills[0]?.paidAt.toISOString() ?? '')} and{' '}
                    {formatTime(advice.coincidence.bills.at(-1)?.paidAt.toISOString() ?? '')}.
                  </p>
                )}

                {!advice.coincidence && advice.direction !== 'balanced' && (
                  <p className="text-xs text-content-muted" data-testid="no-coincidence">
                    No run of bills matches that amount.
                    {advice.timingCouldExplainPaise !== null &&
                      advice.timingCouldExplainPaise > 0 && (
                        <>
                          {' '}
                          Your time is approximate, and{' '}
                          <Money paise={advice.timingCouldExplainPaise} /> of cash moved near it, so
                          the timing could account for part of it.
                        </>
                      )}
                  </p>
                )}
              </div>
            )}
          </fieldset>

          <fieldset className="space-y-1">
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
              // **On the keystroke, not at submission.** This alert is the whole
              // protection against a mistyped minus.
              <p
                role="alert"
                className="text-sm font-bold text-warning"
                data-testid="negative-warning"
              >
                A minus means you are ADDING money to the drawer, not taking it out.
              </p>
            )}
            {leavingPaise !== null && (
              <p className="text-xs text-content-muted" data-testid="leaving-preview">
                Leaving <Money paise={leavingPaise} /> in the drawer
              </p>
            )}
          </fieldset>

          <div className="space-y-1">
            <label htmlFor="count-away" className="text-xs font-semibold text-content-muted">
              Recording this away from the outlet? Say why.
            </label>
            <Input
              id="count-away"
              value={awayReason}
              onChange={(event) => setAwayReason(event.target.value)}
              placeholder="counted at the counter, entered after getting home"
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
          sheet === 'spend'
            ? 'Record a cash spend'
            : movementIsAdding
              ? 'Add to drawer'
              : 'Collect cash'
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
          <div className="space-y-1">
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
                className="text-sm font-bold text-warning"
                data-testid="movement-negative-warning"
              >
                A minus means you are ADDING money to the drawer, not taking it out.
              </p>
            )}
            {movementUsable && state?.expectedNowPaise !== null && state && (
              <p className="text-xs text-content-muted" data-testid="movement-preview">
                Drawer goes <Money paise={state.expectedNowPaise ?? 0} /> →{' '}
                <Money paise={(state.expectedNowPaise ?? 0) - movementPaise} />
              </p>
            )}
          </div>

          {sheet === 'spend' ? (
            <div className="space-y-1">
              <label htmlFor="movement-reason" className="text-sm font-bold text-content">
                What did it buy? (required)
              </label>
              <Input
                id="movement-reason"
                value={movementReason}
                onChange={(event) => setMovementReason(event.target.value)}
                placeholder="Chest freezer for the prep counter"
                data-testid="movement-reason"
              />
              <p className="text-xs text-content-muted" data-testid="spend-not-an-expense">
                This will <strong>not</strong> enter the month&rsquo;s operating expenses. The
                drawer is genuinely lighter, but a fridge is not a running cost, and putting it
                through expenses would wreck the month.
              </p>
            </div>
          ) : (
            <p className="text-xs text-content-muted" data-testid="collect-not-verified">
              You are not counting. Nothing is verified.
            </p>
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
              <div>
                <p className="text-sm text-content">{formatDayTime(adjusting.countedAt)}</p>
                <p className="flex items-baseline justify-between text-sm">
                  <span className="text-content-muted">Recorded</span>
                  <Money paise={adjusting.countedTotalPaise} className="font-semibold" />
                </p>
                <p className="flex items-center gap-1 text-xs font-semibold text-content-muted">
                  <Lock aria-hidden size={12} /> Locked. A later count anchored on this figure.
                </p>
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

              <p className="text-xs text-content-muted" data-testid="adjust-explains-anchor">
                Both figures stay on the record. The next count re-anchors the balance on what was
                physically there, so nothing after it moves.
              </p>
            </>
          )}
        </form>
      </FormSheet>
    </div>
  )
}

function Row({
  label,
  paise,
  testId,
  hint,
}: {
  label: string
  paise: number
  testId: string
  hint?: string
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-xs text-content-muted">
        {label}
        {hint && <span className="block">{hint}</span>}
      </span>
      <Money paise={paise} data-testid={testId} />
    </div>
  )
}
