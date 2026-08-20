import { Info, Link2Off, Pencil } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { LoadingFigures } from '@/components/ui/loading'
import { Money } from '@/components/ui/money'
import { useAdapters } from '@/data-access'
import {
  DataActionError,
  type ManualLedgerCounterRevenue,
  type ManualLedgerDay,
  type ManualLedgerDayInput,
  type ManualLedgerExpense,
  type ZomatoSettlement,
} from '@/data-access/adapters'
import { formatBusinessDate, rupeesToPaise } from '@/domain'
import { cn } from '@/lib/cn'
import { useSession } from '@/session/context'

import { ExpenseList } from './expense-list'
import {
  checkOpeningChain,
  netAggregatorPaise,
  readDay,
  type ChainSignal,
  type DayReading,
} from './ledger'

/**
 * One trading day in the manual ledger (#36) — **temporary, deleted with the
 * capability.**
 *
 * Built like the real cash screen rather than like a form: the figures are typed
 * into one card and **the difference appears as they are typed**, through the same
 * derivation module the month reading uses. A save button that had to be pressed
 * before the drawer's difference could be seen would make the one number this
 * surface exists for the hardest one to reach.
 *
 * **A recorded day is a reading, not a form.** Once the figures are in, the entry
 * card collapses to the same dense card the drawer and the month use, and the
 * inputs go behind an Edit button. Twelve inputs holding figures nobody intends to
 * retype are twelve chances to change one by accident, and they bury the two
 * readings this surface exists for under a screen of boxes. Editing is one tap
 * away, and every field comes back exactly as it was stored.
 *
 * Two defaults and no more. Opening cash is offered as the previous recorded
 * day's count, and the commission as the amount that day was charged — all editable,
 * because they are **stored per day** and correcting one day must not disturb
 * another (design D2). On an outlet's first tracked day there is nothing to
 * inherit, and all three are required with no default rather than quietly zero.
 *
 * Where the offered opening is overwritten and the chain breaks, the surface says
 * so and repairs nothing. A repair would hide the compounding error the stored
 * opening exists to catch.
 */

/** Distinct sentences, because "short" and "over" must never read alike. */
const DIFFERENCE_WORDS = {
  short: 'short — this much is missing from the drawer',
  over: 'over — this much more than expected was counted',
  balanced: 'the drawer balances exactly',
} as const

/**
 * Every money field as the string that was typed, in rupees.
 *
 * Strings rather than numbers throughout, so a half-typed `1` in a field the
 * person is still filling in is not read as ₹1, and an emptied field is empty
 * rather than silently zero.
 */
interface DayDraft {
  openingCash: string
  cashRevenue: string
  upiRevenue: string
  zomatoRevenue: string
  swiggyRevenue: string
  cashAdded: string
  cashAddedReason: string
  cashRemoved: string
  cashRemovedReason: string
  countedCash: string
  /** Per cent, as a person says it: `22.5`. Stored as 2250 basis points. */
  zomatoCommission: string
  swiggyCommission: string
  note: string
}

const BLANK_DRAFT: DayDraft = {
  openingCash: '',
  cashRevenue: '',
  upiRevenue: '',
  zomatoRevenue: '',
  swiggyRevenue: '',
  cashAdded: '',
  cashAddedReason: '',
  cashRemoved: '',
  cashRemovedReason: '',
  countedCash: '',
  zomatoCommission: '',
  swiggyCommission: '',
  note: '',
}

/** Rupees as typed, in paise. Blank is zero for a figure that may legitimately be nil. */
function paise(text: string): number | null {
  const trimmed = text.trim()
  if (trimmed === '') return 0
  const rupees = Number(trimmed)
  return Number.isFinite(rupees) ? rupeesToPaise(rupees) : null
}

/** Blank is *not* zero here: a required figure left empty is unanswered. */
function requiredPaise(text: string): number | null {
  if (text.trim() === '') return null
  return paise(text)
}

/**
 * What an aggregator's block shows as actually received, from the two fields above
 * it, or null while either is unanswered.
 *
 * Through the shared derivation, never a second rounding rule: a net figure that
 * disagreed with the month's by a paisa would be impossible to explain. Since
 * commission became an amount [owner, 2026-08-17] there is no rounding left to
 * disagree about, and this is one subtraction.
 */
function netOf(stated: string, commission: string): number | null {
  const statedPaise = paise(stated)
  if (statedPaise === null) return null
  // A blank commission beside real revenue is an unanswered question, not nought.
  // Showing the stated figure as though all of it arrived would overstate the
  // takings, which is the one direction this screen must never be wrong in.
  if (statedPaise !== 0 && commission.trim() === '') return null
  const commissionPaise = paise(commission)
  if (commissionPaise === null) return null
  return netAggregatorPaise(statedPaise, commissionPaise)
}

/**
 * A channel's commission: an amount, nought, or undetermined.
 *
 * Three states, and the two kinds of "empty" are the whole subtlety:
 *
 *  - A channel that sold nothing was charged nothing. Blank means nought there,
 *    which is KNOWN, and most Swiggy days at these outlets are exactly that.
 *  - A channel that sold something and has a blank commission is **undetermined**
 *    [owner, 2026-08-17]. That is a legitimate saved state, not an unfinished
 *    form: Zomato does not say what it kept until the week closes, so a day
 *    recorded tonight genuinely cannot answer. It is filled in by the weekly
 *    settlement, or by hand later.
 *  - Anything typed that is not a number blocks the save, which is what
 *    `undefined` means below.
 *
 * Returning `null` for the middle case is why this cannot simply use
 * `requiredPaise`: that treats blank as unanswered and would make an ordinary
 * day unsaveable until somebody invented a figure for it.
 */
function commissionFor(revenue: string, commission: string): number | null | undefined {
  const revenuePaise = paise(revenue)
  if (revenuePaise === null) return undefined
  if (revenuePaise === 0) return paise(commission) === 0 ? 0 : paise(commission)
  if (commission.trim() === '') return null
  return paise(commission) ?? undefined
}

function draftFrom(day: ManualLedgerDay): DayDraft {
  const rupees = (value: number) => String(value / 100)
  return {
    openingCash: rupees(day.openingCashPaise),
    cashRevenue: rupees(day.cashRevenuePaise),
    upiRevenue: rupees(day.upiRevenuePaise),
    zomatoRevenue: rupees(day.zomatoRevenuePaise),
    swiggyRevenue: rupees(day.swiggyRevenuePaise),
    cashAdded: rupees(day.cashAddedPaise),
    cashAddedReason: day.cashAddedReason ?? '',
    cashRemoved: rupees(day.cashRemovedPaise),
    cashRemovedReason: day.cashRemovedReason ?? '',
    countedCash: rupees(day.countedCashPaise),
    // An undetermined commission opens as an empty field, which is how it was
    // stored and how it saves again unless somebody types a figure into it.
    zomatoCommission: day.zomatoCommissionPaise === null ? '' : rupees(day.zomatoCommissionPaise),
    swiggyCommission: day.swiggyCommissionPaise === null ? '' : rupees(day.swiggyCommissionPaise),
    note: day.note ?? '',
  }
}

/**
 * What a new day is offered: the previous row's close, and nothing else.
 *
 * The commission fields used to be seeded from yesterday's rates, which made sense
 * while a rate was a slow-moving property of a contract. It is an amount now
 * [owner, 2026-08-17], and yesterday's amount is a function of yesterday's
 * revenue: carrying it forward would offer a figure that is wrong by construction
 * and looks deliberate. Opening cash still carries, because the drawer really does
 * open with what it closed on.
 */
function draftInheriting(previous: ManualLedgerDay | null): DayDraft {
  if (!previous) return BLANK_DRAFT
  return { ...BLANK_DRAFT, openingCash: String(previous.countedCashPaise / 100) }
}

/**
 * The draft as a day, or null while it is not yet a day at all.
 *
 * Null is the honest answer for a half-filled form: the alternative is guessing
 * zero for a figure nobody has typed and showing a difference computed from it.
 */
function draftToDay(
  draft: DayDraft,
  outletId: string,
  businessDate: string,
  counterRevenue: ManualLedgerCounterRevenue | null,
): ManualLedgerDayInput | null {
  const openingCashPaise = requiredPaise(draft.openingCash)
  const countedCashPaise = requiredPaise(draft.countedCash)
  const swiggyCommissionPaise = commissionFor(draft.swiggyRevenue, draft.swiggyCommission)
  const cashRevenuePaise = counterRevenue?.cashRevenuePaise ?? paise(draft.cashRevenue)
  const upiRevenuePaise = counterRevenue?.upiRevenuePaise ?? paise(draft.upiRevenue)
  const swiggyRevenuePaise = paise(draft.swiggyRevenue)
  const cashAddedPaise = paise(draft.cashAdded)
  const cashRemovedPaise = paise(draft.cashRemoved)

  if (
    openingCashPaise === null ||
    countedCashPaise === null ||
    // `undefined` is an unparseable entry and blocks the save; `null` is a
    // deliberate "not known yet" and does not.
    swiggyCommissionPaise === undefined ||
    cashRevenuePaise === null ||
    upiRevenuePaise === null ||
    swiggyRevenuePaise === null ||
    cashAddedPaise === null ||
    cashRemovedPaise === null ||
    openingCashPaise < 0 ||
    countedCashPaise < 0 ||
    cashAddedPaise < 0 ||
    cashRemovedPaise < 0
  ) {
    return null
  }

  return {
    outletId,
    businessDate,
    openingCashPaise,
    cashRevenuePaise,
    upiRevenuePaise,
    // Zomato is sourced and frozen: the form sends nothing for it, and the write
    // ignores these two regardless. They are held at the type's shape — nought
    // revenue, undetermined commission — so a stale value can never travel.
    zomatoRevenuePaise: 0,
    swiggyRevenuePaise,
    cashAddedPaise,
    cashAddedReason: draft.cashAddedReason.trim() || null,
    cashRemovedPaise,
    cashRemovedReason: draft.cashRemovedReason.trim() || null,
    countedCashPaise,
    zomatoCommissionPaise: null,
    swiggyCommissionPaise,
    note: draft.note.trim() || null,
  }
}

export function LedgerDay({ outletId, businessDate }: { outletId: string; businessDate: string }) {
  const { manualLedger: adapter } = useAdapters()
  const { userId } = useSession()

  const [previous, setPrevious] = useState<ManualLedgerDay | null>(null)
  const [recorded, setRecorded] = useState<ManualLedgerDay | null>(null)
  // The Zomato figures for this date, read on their own so they show even on a
  // day nobody counted — where `recorded` is null and would otherwise hide them.
  const [dayFigures, setDayFigures] = useState<ZomatoSettlement | null>(null)
  const [counterRevenue, setCounterRevenue] = useState<
    ManualLedgerCounterRevenue | null | undefined
  >(undefined)
  /** Null while the day is still being read: the whole card waits behind a shape. */
  const [draft, setDraft] = useState<DayDraft | null>(null)
  const [expenses, setExpenses] = useState<ManualLedgerExpense[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  /**
   * Whether the inputs are on screen for a day that is already recorded. A day
   * with nothing recorded needs no such flag: there is nothing to read, so the
   * form is the only thing it can show.
   */
  const [editingDay, setEditingDay] = useState(false)

  const loadExpenses = useCallback(async () => {
    setExpenses(await adapter.listExpenses(outletId, businessDate))
  }, [adapter, outletId, businessDate])

  // Loads once per mount, and the parent remounts this component when the outlet
  // or the day changes (see the `key` in `manual-ledger-surface.tsx`). That is why
  // there is no reset here: clearing the draft in the effect body would be a
  // cascading render, and leaving it would show the previous day's figures under
  // the new day's heading — the exact bug the shimmer contract exists to prevent.
  useEffect(() => {
    let active = true

    void Promise.all([
      adapter.getDay(outletId, businessDate),
      adapter.getPreviousDay(outletId, businessDate),
      adapter.listExpenses(outletId, businessDate),
      adapter.getCounterRevenue(outletId, businessDate),
      adapter.getDayFigures(outletId, businessDate),
    ])
      .then(([day, earlier, list, fromCounter, figures]) => {
        if (!active) return
        setRecorded(day)
        setPrevious(earlier)
        setDayFigures(figures)
        // A recorded day is shown as it was stored. A new one inherits the
        // previous close, and inherits nothing on the first day.
        const nextDraft = day ? draftFrom(day) : draftInheriting(earlier)
        if (fromCounter) {
          nextDraft.cashRevenue = String(fromCounter.cashRevenuePaise / 100)
          nextDraft.upiRevenue = String(fromCounter.upiRevenuePaise / 100)
        }
        setCounterRevenue(fromCounter)
        setDraft(nextDraft)
        setExpenses(list)
      })
      .catch(() => {
        if (active) setError('Could not load this day. Try again in a moment.')
      })

    return () => {
      active = false
    }
  }, [adapter, outletId, businessDate])

  /**
   * The day the two readings below are computed from.
   *
   * `stored` is non-null exactly when the entry card is showing a reading rather
   * than inputs, which is also what decides which card renders — so the reading
   * and the card can never disagree about which day they are describing. While
   * the figures are being typed it is the draft, incomplete draft included, which
   * is what makes the difference appear as it is typed.
   */
  const stored = editingDay ? null : recorded
  const typed = draft ? draftToDay(draft, outletId, businessDate, counterRevenue ?? null) : null
  const day = stored ?? typed
  const reading: DayReading | null = day ? readDay(day, expenses ?? []) : null
  const chain: ChainSignal | null = day ? checkOpeningChain(day, previous) : null

  function change<K extends keyof DayDraft>(field: K, value: DayDraft[K]) {
    setSaved(false)
    setDraft((current) => (current ? { ...current, [field]: value } : current))
  }

  /** Back to the inputs, seeded from what is stored rather than from anything left over. */
  function edit() {
    if (!recorded) return
    setError(null)
    setSaved(false)
    setDraft(draftFrom(recorded))
    setEditingDay(true)
  }

  /** Away from the inputs, discarding whatever was typed. Nothing was written. */
  function cancel() {
    if (!recorded) return
    setError(null)
    setDraft(draftFrom(recorded))
    setEditingDay(false)
  }

  async function save() {
    if (!draft) return
    if (!day) {
      setError(
        'Opening cash, the counted amount, and the commission on any channel that earned something, are needed before this day can be saved.',
      )
      return
    }
    if (day.cashAddedPaise > 0 && !day.cashAddedReason) {
      setError('Say why cash was brought in.')
      return
    }
    if (day.cashRemovedPaise > 0 && !day.cashRemovedReason) {
      setError('Say why cash was taken out.')
      return
    }

    setBusy(true)
    setError(null)
    try {
      const written = await adapter.upsertDay(day)
      setRecorded(written)
      setSaved(true)
      // Back to the reading, because that is what a saved day is. The figures
      // just typed are the ones now on screen, so nothing has to be re-read to
      // trust it.
      setEditingDay(false)
    } catch (cause) {
      setError(
        cause instanceof DataActionError
          ? cause.message
          : 'That did not save. Try again in a moment.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      {error && (
        <p role="alert" data-testid="ledger-error" className="text-sm font-semibold text-danger">
          {error}
        </p>
      )}

      {draft === null ? (
        // The entry card and the drawer beneath it. Which entry card — the form or
        // the reading — is not knowable until the read lands, so the placeholder is
        // shaped like the taller of the two rather than guessing.
        <LoadingFigures
          label="this day’s figures"
          rows={[10, 4]}
          data-testid="ledger-day-loading"
        />
      ) : stored && reading ? (
        <>
          <RecordedDay
            businessDate={businessDate}
            day={stored}
            reading={reading}
            saved={saved}
            fromCounter={counterRevenue != null}
            onEdit={edit}
          />
          <ChainBreak chain={chain} />
          <DayReadingCard day={stored} reading={reading} fromCounter={counterRevenue != null} />
        </>
      ) : (
        <>
          <Card className="space-y-4" data-testid="ledger-day-form">
            <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
              <h2 className="text-sm font-bold text-content">{formatBusinessDate(businessDate)}</h2>
              <p className="text-xs text-content-muted" data-testid="ledger-day-state">
                {recorded ? 'Editing a recorded day' : 'Not recorded yet'}
              </p>
            </div>

            <section className="space-y-2">
              <SectionHeading title="Sales breakdown" hintTestId="hint-revenue">
                <p>
                  Zomato and Swiggy as <strong>they</strong> state it; commission comes off inside
                  each block, as the amount they actually charged rather than a percentage. Both are
                  stored against this day, so editing either moves this day only, and never the
                  drawer.
                </p>
                <p>A refund is recorded by lowering Cash, so a negative figure is allowed there.</p>
              </SectionHeading>

              {counterRevenue ? (
                <div
                  className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-surface-raised p-3"
                  data-testid="counter-revenue"
                >
                  <Row
                    label="Cash · from counter"
                    paise={counterRevenue.cashRevenuePaise}
                    testId="cash-revenue"
                  />
                  <Row
                    label="UPI · from counter"
                    paise={counterRevenue.upiRevenuePaise}
                    testId="upi-revenue"
                  />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <NumberField
                    id="cash-revenue"
                    label="Cash"
                    value={draft.cashRevenue}
                    onChange={(value) => change('cashRevenue', value)}
                    testId="cash-revenue"
                  />
                  <NumberField
                    id="upi-revenue"
                    label="UPI"
                    value={draft.upiRevenue}
                    onChange={(value) => change('upiRevenue', value)}
                    testId="upi-revenue"
                  />
                </div>
              )}

              {/*
                Each aggregator is one outlined block: the stated figure, the
                commission charged on it, and what those two produce. Splitting them
                across a revenue group and a commission group put the commission
                three fields away from the figure it reduces, and left the net — the
                only one of the three that is actually money received — nowhere at
                all.
              */}
              {/*
                Zomato is a reading, not an entry. Its figures are sourced from
                the daily read or a settlement statement and no longer live on
                this row, so there is no field to type into — even while the rest
                of the day is being edited. Swiggy is not sourced, so it keeps its
                fields, and the note below says why the two look different rather
                than leaving the asymmetry to read as a fault.
              */}
              <ZomatoReading settlement={recorded?.zomatoSettlement ?? dayFigures} />
              <Aggregator
                name="Swiggy"
                statedId="swiggy-revenue"
                stated={draft.swiggyRevenue}
                onStated={(value) => change('swiggyRevenue', value)}
                commissionId="swiggy-commission"
                commission={draft.swiggyCommission}
                onCommission={(value) => change('swiggyCommission', value)}
                netPaise={netOf(draft.swiggyRevenue, draft.swiggyCommission)}
              />
              <p className="px-1 text-xs text-content-muted" data-testid="why-zomato-differs">
                Zomato&rsquo;s figures are read from Zomato and cannot be typed. Swiggy is still
                entered by hand until its statements are read too.
              </p>
            </section>

            <section className="space-y-2">
              <SectionHeading title="The drawer" hintTestId="hint-drawer">
                <p>
                  Opening is offered as the previous recorded day&rsquo;s count and stays editable,
                  because it is stored against this day rather than worked out when read.
                </p>
                <p>
                  Equipment bought with drawer cash belongs in <strong>Cash withdrawn</strong>, with
                  what it was, and <strong>not</strong> as an expense. The drawer is genuinely
                  lighter, so this is what keeps the count reconciling — and this ledger records no
                  equipment, which is why the month&rsquo;s figure is an operating one.
                </p>
              </SectionHeading>

              <div className="grid grid-cols-2 gap-2">
                <NumberField
                  id="opening-cash"
                  label="Opening cash"
                  value={draft.openingCash}
                  onChange={(value) => change('openingCash', value)}
                  testId="opening-cash"
                />
                <NumberField
                  id="counted-cash"
                  label="Counted at close"
                  value={draft.countedCash}
                  onChange={(value) => change('countedCash', value)}
                  testId="counted-cash"
                />
              </div>
              {/*
                Kept visible rather than folded into the hint: on an outlet's first
                day it is the reason two required fields arrive empty, and it is the
                one instruction somebody cannot guess.
              */}
              <p className="text-xs text-content-muted">
                {previous
                  ? `Opening is the ${formatBusinessDate(previous.businessDate)} count.`
                  : 'The first day at this outlet, so nothing is inherited — count the drawer and type what it held.'}
              </p>

              <div className="grid grid-cols-2 gap-2">
                <NumberField
                  id="cash-added"
                  label="Cash added"
                  value={draft.cashAdded}
                  onChange={(value) => change('cashAdded', value)}
                  testId="cash-added"
                />
                <NumberField
                  id="cash-removed"
                  label="Cash withdrawn"
                  value={draft.cashRemoved}
                  onChange={(value) => change('cashRemoved', value)}
                  testId="cash-removed"
                />
              </div>
              {paise(draft.cashAdded) !== 0 && (
                <TextField
                  id="cash-added-reason"
                  label="Why cash was added"
                  required
                  value={draft.cashAddedReason}
                  placeholder="e.g. Float topped up"
                  onChange={(value) => change('cashAddedReason', value)}
                  testId="cash-added-reason"
                />
              )}
              {paise(draft.cashRemoved) !== 0 && (
                <TextField
                  id="cash-removed-reason"
                  label="Why cash was withdrawn"
                  required
                  value={draft.cashRemovedReason}
                  placeholder="e.g. Banked on the way home"
                  onChange={(value) => change('cashRemovedReason', value)}
                  testId="cash-removed-reason"
                />
              )}
            </section>

            <TextField
              id="day-note"
              label="Note (optional)"
              value={draft.note}
              placeholder="e.g. Counted twice"
              onChange={(value) => change('note', value)}
              testId="day-note"
            />

            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="phone"
                disabled={busy}
                data-testid="save-day"
                onClick={() => void save()}
              >
                {busy ? 'Saving…' : recorded ? 'Save the correction' : 'Save this day'}
              </Button>
              {/*
                Only for a day already recorded: there is a reading to go back to.
                On a day with nothing stored, leaving the form would leave an empty
                screen, and the button would be a way to lose what was typed.
              */}
              {recorded && (
                <Button
                  variant="secondary"
                  size="phone"
                  disabled={busy}
                  data-testid="cancel-day-edit"
                  onClick={cancel}
                >
                  Cancel
                </Button>
              )}
            </div>
          </Card>

          <ChainBreak chain={chain} />

          {day && reading ? (
            <DayReadingCard day={day} reading={reading} fromCounter={counterRevenue != null} />
          ) : (
            <Card data-testid="reading-incomplete">
              <p className="text-sm text-content-muted">
                The drawer&rsquo;s difference appears here as you type, once the opening, the count
                and any commission charged is in.
              </p>
            </Card>
          )}
        </>
      )}

      {/*
        The same list the staff surface mounts, with the day's figures around it
        rather than alone (design D7).

        `mayTouchAnyRow` is unconditionally true because this surface is
        reachable only by an owner or by a manager at this outlet, both of whom
        may correct any row on any date — so `currentBusinessDate` never narrows
        anything here. It is passed anyway rather than made optional: the
        component asks one question of every reader, and a prop that appeared
        only for staff would be a role branch wearing a different hat.
      */}
      <ExpenseList
        expenses={expenses}
        outletId={outletId}
        businessDate={businessDate}
        currentBusinessDate={businessDate}
        viewer={{ id: userId, mayTouchAnyRow: true }}
        emptyTitle="Nothing recorded for this day yet. Add what was spent under the category the month should use."
        onChanged={loadExpenses}
      />
    </div>
  )
}

/**
 * A recorded day, read rather than edited.
 *
 * Deliberately the revenue side and nothing else: every drawer figure is on the
 * card below this one, and a card that repeated them would put two answers to the
 * same question a thumb's width apart. What only this card can show is what the
 * drawer never sees — UPI, and each aggregator reduced by **the commission that
 * day was actually charged**, shown as its own line so the figure can be checked
 * without opening the form.
 */
function RecordedDay({
  businessDate,
  day,
  reading,
  saved,
  fromCounter,
  onEdit,
}: {
  businessDate: string
  day: ManualLedgerDayInput
  reading: DayReading
  saved: boolean
  fromCounter: boolean
  onEdit: () => void
}) {
  /*
   * An undetermined commission leaves three figures unknown, and each says so
   * rather than showing a number.
   *
   * Nought would be the convenient substitute and the wrong one: it would claim
   * the whole of the day's Zomato revenue arrived, which is the one direction an
   * error here flatters the shop.
   */
  const zomatoCommissionPaise =
    reading.netZomatoPaise === null ? null : day.zomatoRevenuePaise - reading.netZomatoPaise
  const swiggyCommissionPaise =
    reading.netSwiggyPaise === null ? null : day.swiggyRevenuePaise - reading.netSwiggyPaise
  const netRevenuePaise =
    reading.netZomatoPaise === null || reading.netSwiggyPaise === null
      ? null
      : day.cashRevenuePaise + day.upiRevenuePaise + reading.netZomatoPaise + reading.netSwiggyPaise

  return (
    <Card className="space-y-2" data-testid="ledger-day-recorded">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="text-sm font-bold text-content">{formatBusinessDate(businessDate)}</h2>
          <span className="text-xs text-content-muted" data-testid="ledger-day-state">
            Recorded
          </span>
          {saved && (
            <span className="text-xs font-semibold text-content" data-testid="day-saved">
              Saved.
            </span>
          )}
        </div>
        <Button variant="secondary" size="phone" data-testid="edit-day" onClick={onEdit}>
          <Pencil aria-hidden size={16} />
          Edit
        </Button>
      </div>

      <h3 className="text-xs font-bold uppercase tracking-wide text-content-muted">
        Sales breakdown
      </h3>
      <Row
        label={fromCounter ? 'Cash · from counter' : 'Cash'}
        paise={day.cashRevenuePaise}
        testId="recorded-cash"
      />
      <Row
        label={fromCounter ? 'UPI · from counter' : 'UPI'}
        paise={day.upiRevenuePaise}
        testId="recorded-upi"
      />

      <div className="space-y-1 border-t border-border pt-2">
        <Row
          label="Zomato, as stated"
          paise={day.zomatoRevenuePaise}
          testId="recorded-zomato-gross"
          tag={<SourceTag channel="zomato" settlement={reading.zomato.settlement} />}
        />
        <Row
          label="Less commission"
          paise={zomatoCommissionPaise === null ? null : -zomatoCommissionPaise}
          testId="recorded-zomato-commission"
        />
        <Row
          label="Zomato, actually received"
          paise={reading.netZomatoPaise}
          testId="recorded-zomato-net"
        />
        <SupersededNote settlement={reading.zomato.settlement} />
      </div>

      <div className="space-y-1 border-t border-border pt-2">
        <Row
          label="Swiggy, as stated"
          paise={day.swiggyRevenuePaise}
          testId="recorded-swiggy-gross"
          // Always typed: Swiggy is not synced, and the chip says so rather than
          // leaving the reader to infer it from an absence.
          tag={<SourceTag channel="swiggy" settlement={null} />}
        />
        <Row
          label="Less commission"
          paise={swiggyCommissionPaise === null ? null : -swiggyCommissionPaise}
          testId="recorded-swiggy-commission"
        />
        <Row
          label="Swiggy, actually received"
          paise={reading.netSwiggyPaise}
          testId="recorded-swiggy-net"
        />
      </div>

      <div className="flex items-baseline justify-between border-t border-border pt-2">
        <span className="text-sm font-bold text-content">
          {netRevenuePaise === null ? 'Revenue received, at most' : 'Revenue actually received'}
        </span>
        {netRevenuePaise === null ? (
          /*
           * A ceiling, and the label says so.
           *
           * Commission can only reduce this, so the gross is the most that can have
           * arrived. Showing it under the ordinary heading would state an
           * approximation as a fact; changing the heading is what makes the same
           * number honest.
           */
          <Money
            paise={
              day.cashRevenuePaise +
              day.upiRevenuePaise +
              day.zomatoRevenuePaise +
              day.swiggyRevenuePaise
            }
            className="font-bold"
            data-testid="recorded-revenue-net"
          />
        ) : (
          <Money paise={netRevenuePaise} className="font-bold" data-testid="recorded-revenue-net" />
        )}
      </div>
      <p className="text-xs text-content-muted">
        {netRevenuePaise === null
          ? 'One channel’s commission is not known yet, so this is the most that can have arrived. It settles when the week does. Of all this, only the cash reached the drawer.'
          : 'Commission is the amount charged on this day. Of all this, only the cash reached the drawer.'}
      </p>
    </Card>
  )
}

/**
 * The opening-cash chain, where it broke.
 *
 * Shown on a recorded day as well as while one is being typed, because a break is
 * a fact about what is stored and not about what is on screen. Says what happened
 * and repairs nothing — see `checkOpeningChain`.
 */
function ChainBreak({ chain }: { chain: ChainSignal | null }) {
  if (chain?.kind !== 'disagrees') return null

  return (
    <Card className="space-y-1 border-warning" data-testid="chain-break">
      <p className="flex items-start gap-2 text-sm font-bold text-content">
        <Link2Off aria-hidden size={16} className="mt-0.5 shrink-0 text-warning" />
        <span>
          This day opens with <Money paise={chain.storedOpeningPaise} />, but{' '}
          {formatBusinessDate(chain.previousBusinessDate)} closed on{' '}
          <Money paise={chain.previousCountPaise} /> — a gap of{' '}
          <Money paise={Math.abs(chain.gapPaise)} />.
        </span>
      </p>
      <p className="text-xs text-content-muted">
        Nothing here has been changed. A figure somebody counted is evidence, and quietly replacing
        it would hide the very gap it just showed. Correct whichever day is wrong.
      </p>
    </Card>
  )
}

/**
 * The drawer, worked out from the figures above it.
 *
 * Everything on this card is derived and labelled as derived. The person supplies
 * the count; the difference is the screen's answer, and it is stated in words as
 * well as by sign — a minus sign is the first thing a bright counter or a small
 * screen loses, and "₹250 short" is not a sentence anybody misreads.
 */
function DayReadingCard({
  day,
  reading,
  fromCounter,
}: {
  day: ManualLedgerDayInput
  reading: DayReading
  fromCounter: boolean
}) {
  return (
    <Card className="space-y-2" data-testid="day-reading">
      <Row label="Opening cash" paise={day.openingCashPaise} testId="reading-opening" />
      <Row
        label={fromCounter ? 'Cash from sales · from counter' : 'Cash from sales'}
        paise={day.cashRevenuePaise}
        testId="reading-cash-revenue"
      />
      {/*
        The reason sits under the amount it explains, which is the only place it is
        any use: "₹2,000 brought in" a month later is a figure nobody can account
        for, and the form that captured the reason is not on screen.
      */}
      <Row
        label="Cash added"
        paise={day.cashAddedPaise}
        testId="reading-cash-added"
        hint={day.cashAddedReason}
      />
      <Row
        label="Cash expenses"
        paise={-reading.cashExpensesPaise}
        testId="reading-cash-expenses"
        hint="Only expenses marked as cash."
      />
      <Row
        label="Cash withdrawn"
        paise={-day.cashRemovedPaise}
        testId="reading-cash-removed"
        hint={day.cashRemovedReason}
      />

      <div className="flex items-baseline justify-between border-t border-border pt-2">
        <span className="text-sm font-bold text-content">Should be in the drawer</span>
        <Money
          paise={reading.expectedCashPaise}
          className="font-bold"
          data-testid="expected-cash"
        />
      </div>
      <Row label="Counted" paise={reading.countedCashPaise} testId="reading-counted" />

      <div
        data-testid="day-difference"
        data-difference={reading.difference}
        className={
          reading.difference === 'balanced'
            ? 'rounded-lg border border-border bg-surface-raised p-2'
            : 'rounded-lg border border-warning bg-surface-raised p-2'
        }
      >
        <p className="flex items-baseline justify-between">
          <span className="text-sm font-bold text-content">Difference</span>
          <Money paise={reading.differencePaise} display />
        </p>
        <p className="text-xs text-content-muted">{DIFFERENCE_WORDS[reading.difference]}</p>
        {day.note && (
          <p className="mt-1 text-xs text-content" data-testid="difference-note">
            {day.note}
          </p>
        )}
      </div>

      <p className="text-xs text-content-muted">
        UPI, Zomato and Swiggy are revenue and never drawer, so none of them appears above. They are
        in the month.
      </p>
    </Card>
  )
}

/**
 * A section's title, with everything that used to be a paragraph under it.
 *
 * The rules this ledger runs on are load-bearing — commission stored per day, a
 * fridge that is cash out and not an expense — but they are read once and then
 * known, while the form is opened nightly. Left on screen they cost more vertical
 * space than the fields, and a form nobody can see the end of is a form that gets
 * filled in badly. Behind a marked control they stay one tap from the field they
 * govern.
 */
function SectionHeading({
  title,
  hintTestId,
  children,
}: {
  title: string
  hintTestId: string
  children: ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h3 className="text-xs font-bold uppercase tracking-wide text-content-muted">{title}</h3>
      <InfoHint label={title} testId={hintTestId}>
        {children}
      </InfoHint>
    </div>
  )
}

/**
 * The explanation, on request.
 *
 * A real button rather than a hover target, because half the people reading this
 * are on a phone and a hover tooltip is unreachable there. It states its own state
 * through `aria-expanded`, closes on Escape and on a tap outside, and the panel is
 * absolutely positioned so opening it never moves the field somebody was about to
 * type into.
 *
 * Local to this folder on purpose: the whole capability is deletable, and a
 * primitive parked in `components/ui` for one throwaway surface is how a stopgap
 * leaves things behind. Promote it if a second surface ever wants it.
 */
function InfoHint({
  label,
  testId,
  children,
}: {
  label: string
  testId: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const region = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    function onPointerDown(event: PointerEvent) {
      if (!region.current?.contains(event.target as Node)) setOpen(false)
    }

    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open])

  return (
    <div className="relative" ref={region}>
      <button
        type="button"
        aria-expanded={open}
        aria-label={`What to know about ${label.toLowerCase()}`}
        data-testid={testId}
        onClick={() => setOpen((current) => !current)}
        className="flex size-11 items-center justify-center rounded-full text-content-muted hover:bg-surface-raised hover:text-content focus-visible:focus-ring"
      >
        <Info aria-hidden size={16} />
      </button>

      {open && (
        <div
          role="note"
          data-testid={`${testId}-panel`}
          className="absolute right-0 top-full z-20 mt-1 w-72 max-w-[calc(100vw-3rem)] space-y-2 rounded-lg border border-border bg-surface-raised p-3 text-xs leading-relaxed text-content shadow-lg"
        >
          {children}
        </div>
      )}
    </div>
  )
}

/**
 * One aggregator: what it says it sold, what it kept, and what arrives.
 *
 * The net figure is the point of the block. It is the only one of the three that
 * is money the business actually received, and it is computed here as the figures
 * are typed — through the same `netAggregatorPaise` the month uses, so the day and
 * the month cannot disagree.
 *
 * Both fields are money [owner, 2026-08-17]. The second used to be a percentage,
 * which meant this block mixed two units and needed a `%` suffix to tell them
 * apart; two money fields side by side need no such hint.
 */
/**
 * Zomato as a reading inside the edit form.
 *
 * The same three figures the recorded card shows — gross, commission, net —
 * carrying no field, because the freeze is that a person cannot type them. An
 * undetermined commission says so rather than showing nought, for the reason it
 * does everywhere: nought would claim the whole of the revenue arrived. A day the
 * sync has never reached shows an empty state rather than an input, so nothing
 * about the block invites the figure to be entered.
 */
function ZomatoReading({ settlement }: { settlement: ZomatoSettlement | null }) {
  const netPaise =
    settlement === null || settlement.commissionPaise === null
      ? null
      : settlement.revenuePaise - settlement.commissionPaise

  return (
    <div
      className="space-y-2 rounded-lg border border-border bg-surface-raised/40 p-2.5"
      data-testid="aggregator-zomato"
    >
      <div className="flex items-center justify-between px-1">
        <span className="text-xs font-bold text-content">Zomato</span>
        <SourceTag channel="zomato" settlement={settlement} />
      </div>
      {settlement === null ? (
        <p className="px-1 text-xs text-content-muted" data-testid="zomato-none-yet">
          No Zomato figures have arrived for this day yet.
        </p>
      ) : (
        <>
          <Row label="As stated" paise={settlement.revenuePaise} testId="zomato-revenue" />
          <Row
            label="Commission"
            paise={settlement.commissionPaise === null ? null : -settlement.commissionPaise}
            testId="zomato-commission"
          />
          <p className="flex items-baseline justify-between gap-2">
            <span className="text-xs text-content-muted">Actually received</span>
            {netPaise === null ? (
              <span className="text-sm text-content-muted" data-testid="zomato-revenue-net">
                &mdash;
              </span>
            ) : (
              <Money
                paise={netPaise}
                className="text-sm font-semibold"
                data-testid="zomato-revenue-net"
              />
            )}
          </p>
          <SupersededNote settlement={settlement} />
        </>
      )}
    </div>
  )
}

/**
 * What a figure replaced, where anything did — and never part of a total.
 *
 * Two traces: a figure an earlier origin wrote and this one superseded, and the
 * provisional figure a settling week revised. Both are shown so a number that
 * moved can be seen to have moved, which is the whole reason they are retained;
 * neither is added to anything, because the current figure already is.
 */
function SupersededNote({ settlement }: { settlement: ZomatoSettlement | null }) {
  if (!settlement) return null
  const { supersededTyped, revisedFrom } = settlement
  if (!supersededTyped && !revisedFrom) return null

  const was = supersededTyped ?? revisedFrom
  if (!was) return null
  const net = was.commissionPaise === null ? null : was.revenuePaise - was.commissionPaise

  return (
    <p
      className="flex items-baseline justify-between gap-2 text-xs text-content-muted"
      data-testid="recorded-zomato-superseded"
    >
      <span>{supersededTyped ? 'Was, before the sync' : 'Was, before the week settled'}</span>
      {net === null ? (
        <span>not known then</span>
      ) : (
        <Money paise={net} className="text-xs" data-testid="recorded-zomato-superseded-net" />
      )}
    </p>
  )
}

function Aggregator({
  name,
  statedId,
  stated,
  onStated,
  commissionId,
  commission,
  onCommission,
  netPaise,
}: {
  name: string
  statedId: string
  stated: string
  onStated: (value: string) => void
  commissionId: string
  commission: string
  onCommission: (value: string) => void
  netPaise: number | null
}) {
  return (
    <fieldset
      className="space-y-2 rounded-lg border border-border bg-surface-raised/40 p-2.5"
      data-testid={`aggregator-${name.toLowerCase()}`}
    >
      <legend className="px-1 text-xs font-bold text-content">{name}</legend>
      <div className="grid grid-cols-2 gap-2">
        <NumberField
          id={statedId}
          label="As stated"
          srContext={name}
          value={stated}
          onChange={onStated}
          testId={statedId}
        />
        <NumberField
          id={commissionId}
          label="Commission"
          srContext={name}
          value={commission}
          onChange={onCommission}
          testId={commissionId}
        />
      </div>
      <p className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-content-muted">Actually received</span>
        {netPaise === null ? (
          // Not zero: with the commission unanswered there is nothing to compute,
          // and ₹0 would be a figure where there is only an open question.
          <span className="text-sm text-content-muted" data-testid={`${statedId}-net`}>
            &mdash;
          </span>
        ) : (
          <Money
            paise={netPaise}
            className="text-sm font-semibold"
            data-testid={`${statedId}-net`}
          />
        )}
      </p>
    </fieldset>
  )
}

/**
 * A money or percentage entry, sized to what it holds.
 *
 * The unit is a symbol inside the box rather than `(₹)` after the label, which is
 * what lets two of these sit side by side on a 390px screen with labels that read
 * as words.
 *
 * The rest of the sentence is in the label all the same, hidden: `As stated` reads
 * as "As stated for Zomato, in rupees". A visible label short enough to sit in half
 * a phone width is not a licence to ship four fields that announce themselves
 * identically — the outlined block that makes the grouping obvious to a reader who
 * can see it says nothing to one who cannot.
 */
function NumberField({
  id,
  label,
  value,
  onChange,
  testId,
  srContext,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  testId: string
  srContext?: string
}) {
  return (
    <div className="min-w-0 space-y-1">
      <label htmlFor={id} className="block truncate text-xs font-semibold text-content">
        {label}
        <span className="sr-only">{srContext ? ` for ${srContext}` : ''}, in rupees</span>
      </label>
      <div className="relative">
        {/*
          Every field on this form is money now that commission is an amount [owner,
          2026-08-17], so the `percent` variant is gone rather than left unused. A
          unit nothing passes is a unit somebody re-reaches for, and the reason it
          was removed — that a rate is an estimate dressed as a figure — would not
          travel with it.
        */}
        <span
          aria-hidden
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-base text-content-muted"
        >
          ₹
        </span>
        {/*
          The height is the phone control token; the font size is deliberately NOT
          set here. Anything under 16px makes iOS Safari zoom the viewport on
          focus, which the base layer exists to prevent — a shorter box is a
          density decision, a smaller font is a bug.
        */}
        <Input
          id={id}
          inputMode="decimal"
          value={value}
          data-testid={testId}
          onChange={(event) => onChange(event.target.value)}
          className="h-[var(--size-control-phone)] pl-7 pr-2"
        />
      </div>
    </div>
  )
}

/** Free text: a cash movement's reason, or the day's note. */
function TextField({
  id,
  label,
  value,
  onChange,
  testId,
  placeholder,
  required = false,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  testId: string
  placeholder?: string
  required?: boolean
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-xs font-semibold text-content">
        {label}
      </label>
      <Input
        id={id}
        required={required}
        value={value}
        placeholder={placeholder}
        data-testid={testId}
        onChange={(event) => onChange(event.target.value)}
        className="h-[var(--size-control-phone)]"
      />
    </div>
  )
}

/**
 * Where a channel's figures came from, as a chip.
 *
 * Four sources, not three. A **disputed** day is one Zomato has paid for and whose
 * figures do not add up to that payment, and it must not wear the same chip as a
 * settled one: it is the single state on this screen that wants somebody to look at
 * it. The other three are the ones asked for [owner, 2026-08-18].
 *
 * The words are the ones the rest of the app already uses — the sync surface, the
 * specs and the database all say provisional, settled and disputed — because one
 * vocabulary across two screens is worth more than a better word on one of them.
 * `Daily` is the exception: `provisional` is what the row stores, but what the owner
 * needs to know is that it came from today's read and will firm up on Sunday.
 */
function SourceTag({
  channel,
  settlement,
}: {
  /** Named in the test id; only Swiggy still wears the typed chip. */
  channel: 'zomato' | 'swiggy'
  settlement: ZomatoSettlement | null
}) {
  // Zomato no longer takes a typed figure — it is read from Zomato or from an
  // uploaded statement, full stop. So a Zomato day with nothing read is "not read
  // yet", not "typed", and it wears no chip at all: the row's own words already say
  // no figures have arrived, and a "Typed" chip beside them would contradict that.
  // Swiggy is still entered by hand, so its absence of a reading really is typed.
  if (settlement === null && channel === 'zomato') return null

  const [label, tone, why] =
    settlement === null
      ? ([
          'Typed',
          'border-border text-content-muted',
          'Entered by hand. Nothing was read from the aggregator for this day.',
        ] as const)
      : // A statement supplied by hand is named for how it arrived, not for the
        // week it settles, because that is the fact the reader cares about: the
        // automation was not running and somebody uploaded the file.
        settlement.origin === 'supplied_by_hand'
        ? ([
            'Uploaded',
            'border-primary text-primary',
            'Read from a statement you uploaded, because the automation was not running. The figures are the statement’s own.',
          ] as const)
        : settlement.state === 'settled'
          ? ([
              'Settled',
              'border-success text-success',
              "Read from Zomato's weekly payout statement, and it adds up to what they paid.",
            ] as const)
          : settlement.state === 'disputed'
            ? ([
                'Disputed',
                'border-danger text-danger',
                'Zomato has paid this week and the figures do not add up to the payment. Nothing was overwritten.',
              ] as const)
            : ([
                'Daily',
                'border-primary text-primary',
                'Read from Zomato today. The commission is not stated until the week closes, so this figure firms up on Sunday.',
              ] as const)

  return (
    <span
      data-testid={`source-tag-${channel}-${label.toLowerCase()}`}
      className={cn(
        'inline-flex items-center rounded-full border px-1.5 py-0.5 text-[11px] font-semibold',
        tone,
      )}
      title={why}
    >
      {label}
    </span>
  )
}

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
  /** Nullable, so a stored reason that was never given passes straight through. */
  hint?: string | null
  /** A small chip beside the label, for where a figure came from. */
  tag?: ReactNode
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="inline-flex flex-wrap items-baseline gap-1.5 text-sm text-content-muted">
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
          <span className="text-sm text-content-muted" data-testid={testId}>
            Not known yet
          </span>
        ) : (
          <Money paise={amount} data-testid={testId} />
        )}
      </div>
      {hint && <p className="text-xs text-content-muted">{hint}</p>}
    </div>
  )
}
