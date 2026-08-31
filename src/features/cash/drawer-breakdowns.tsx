import { ArrowDownRight, ArrowUpRight, Check, MapPinOff, Pencil, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'

import { FormSheet } from '@/components/layout/form-sheet'
import { Button } from '@/components/ui/button'
import { Chip, ChipRow } from '@/components/ui/chip'
import { Money } from '@/components/ui/money'
import { useAdapters } from '@/data-access'
import type { DrawerObservationRecord, DrawerState, ExpenseRecord } from '@/data-access/adapters'
import {
  formatDayTime,
  formatPaise,
  formatTime,
  nextOpeningPaise,
  resolveBusinessDate,
} from '@/domain'
import { ExpenseList } from '@/features/expenses/expense-list'

/**
 * The two readings behind the balance card's figures.
 *
 * **The subject is the interval, and the business date is only how it is read**
 * (design D1). The card states a balance over `(last count, now]`, bounded by
 * instants; these breakdowns partition that interval by business date. They do
 * not fetch whole days and trim them, which is the model #11 replaced, and the
 * distinction shows in exactly one place: the oldest group is routinely a
 * *fragment* of its business date, and its heading names the count that cut it.
 *
 * **Every figure here is the database's.** The groups come from
 * `drawer_cash_receipts_by_day` and `drawer_cash_expenses_by_day`, built on the
 * same relation, predicate and interval convention as the scalar readers behind
 * the tiles — one `group by` apart. Nothing is re-added in TypeScript, because a
 * breakdown that does not sum to the figure it was opened from is worse than no
 * breakdown at all.
 */

/**
 * How a business date reads in a heading.
 *
 * `Today` for the outlet's current trading day, which is the group somebody is
 * standing in. Otherwise the date, with the year dropped where it is this year's
 * — the same rule the count history uses, for the same reason: a year repeated
 * down a list is the part the reader already knows.
 */
function businessDateLabel(businessDate: string, today: string): string {
  if (businessDate === today) return 'Today'
  const at = new Date(`${businessDate}T00:00:00Z`)
  const sameYear = businessDate.slice(0, 4) === today.slice(0, 4)
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'UTC',
    day: '2-digit',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(at)
}

/**
 * The heading for one group, qualified where the group is only part of its day.
 *
 * A group is a fragment exactly when its business date is the one the bounding
 * count fell on: the count landed after that date's cutover, so everything on
 * that date before it was settled by that count and is not in this interval. A
 * group wholly inside the interval carries no qualifier, which is every group
 * once a count lands before the next date's cutover.
 */
function groupHeading(
  businessDate: string,
  today: string,
  countBusinessDate: string | null,
  countedAt: string | null,
): string {
  const label = businessDateLabel(businessDate, today)
  if (countBusinessDate === null || countedAt === null) return label
  if (businessDate !== countBusinessDate) return label
  return `${label} · since the count at ${formatTime(countedAt)}`
}

/**
 * What a count came to, in the fewest words that say it.
 *
 * **One implementation, two readers.** It lives here rather than beside the
 * count history because the Last Left reading states the same verdict about the
 * same observation, and a second copy is a second place for `matched` and
 * `first count` to drift apart. The surface imports it; nothing imports back.
 */
export function verdictOf(observation: DrawerObservationRecord): {
  chip: ReactNode
  spoken: string
} {
  if (observation.isAnchor) {
    return {
      chip: (
        <Chip tone="neutral" data-testid={`anchor-${observation.id}`}>
          first count
        </Chip>
      ),
      spoken: 'first count',
    }
  }
  const difference = observation.differencePaise ?? 0
  if (difference === 0) {
    return {
      chip: (
        <Chip tone="good" icon={Check}>
          matched
        </Chip>
      ),
      spoken: 'matched',
    }
  }
  return {
    chip: (
      <Chip tone="bad" icon={difference < 0 ? ArrowDownRight : ArrowUpRight}>
        <Money paise={Math.abs(difference)} /> {difference < 0 ? 'short' : 'over'}
      </Chip>
    ),
    spoken: `${formatPaise(Math.abs(difference))} ${difference < 0 ? 'short' : 'over'}`,
  }
}

/** `coalesce(occurred_at, created_at)` — the instant the drawer arithmetic uses. */
function instantOf(expense: ExpenseRecord): string {
  return expense.occurredAt ?? expense.createdAt
}

export interface BreakdownContext {
  state: DrawerState
  /** The outlet's own current business date, resolved through its own cutover. */
  today: string
  /** The business date the bounding count fell on, through the same cutover. */
  countBusinessDate: string | null
}

/** The context both breakdowns need, or null before there is anything to read. */
export function breakdownContext(
  state: DrawerState,
  cutover: string | null,
): BreakdownContext | null {
  if (!state.lastObservation || !cutover) return null
  return {
    state,
    today: resolveBusinessDate(new Date(), cutover),
    countBusinessDate: resolveBusinessDate(new Date(state.lastObservation.countedAt), cutover),
  }
}

/** One line of the reading: a label left, a figure right, down one column. */
function Row({
  label,
  value,
  emphasis = false,
}: {
  label: string
  value: ReactNode
  /** The line the others add up to. */
  emphasis?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className={emphasis ? 'text-sm font-bold text-content' : 'text-sm text-content-muted'}>
        {label}
      </span>
      <span className={emphasis ? 'shrink-0 font-bold text-content' : 'shrink-0 text-content'}>
        {value}
      </span>
    </div>
  )
}

/**
 * Last Left, and where it came from.
 *
 * **This tile is not an interval, so it does not open a day-by-day reading.** It
 * is a single stored figure — the last count's counted total, less that count's
 * own collection — and what somebody wants when they tap it is the count that
 * produced it. So the reading is that observation: what was counted, what was
 * taken out with it, what that leaves, and the verdict the count came to.
 *
 * The arithmetic is `nextOpeningPaise`, the same function the tile itself and the
 * count history both use — nothing is recomputed here.
 *
 * **And it carries the same Fix control the count history does**
 * [owner, 2026-08-30]. That is not a second correction path: the tile always
 * shows the newest count, which is by definition the one nothing has anchored
 * on, so the offer here is the same edit `Recent counts` offers on the same row
 * — `cash-drawer` requires exactly one of an edit or an adjustment *per count*,
 * not per doorway. Pressing it swaps this reading for the edit sheet rather than
 * stacking a second sheet on top of it, so there is one sheet on screen at a
 * time and one implementation of the edit.
 *
 * **What it does not offer is amending the collection.** `edit_drawer_observation`
 * corrects an observation; the movement written beside it is a row of its own
 * with no command to amend it, so the amount collected is stated here and
 * corrected by counting again. Offering a field that quietly did nothing would
 * be worse than not offering it.
 */
export function LastLeftBreakdown({
  open,
  onClose,
  observation,
  onFix,
}: {
  open: boolean
  onClose: () => void
  observation: DrawerObservationRecord | null
  /** Swap this reading for the edit sheet on the same count. */
  onFix: () => void
}) {
  const collected = (observation?.ownCashOut ?? []).reduce(
    (sum, movement) => sum + movement.amountPaise,
    0,
  )
  const left = observation ? nextOpeningPaise(observation.countedTotalPaise, collected) : 0
  const verdict = observation ? verdictOf(observation) : null
  const movementNotes = (observation?.ownCashOut ?? []).flatMap((movement) =>
    movement.reason ? [movement.reason] : [],
  )

  return (
    <FormSheet open={open} onClose={onClose} title="Last Left">
      {observation ? (
        <div className="space-y-3" data-testid="last-left-breakdown">
          <p className="text-sm text-content-muted">
            {observation.isLegacyImprecise
              ? 'Hour was never recorded'
              : formatDayTime(observation.countedAt)}
            {observation.recordedByName && ` · by ${observation.recordedByName}`}
          </p>

          <ChipRow>
            {verdict?.chip}
            {!observation.onSite && (
              <Chip tone="neutral" icon={MapPinOff}>
                away
              </Chip>
            )}
            {observation.openingBreakPaise !== null && (
              <Chip tone="warn" icon={TriangleAlert}>
                break <Money paise={observation.openingBreakPaise} />
              </Chip>
            )}
          </ChipRow>

          <div className="space-y-2 border-t border-border pt-2">
            <Row
              label="Counted"
              value={
                <Money paise={observation.countedTotalPaise} data-testid="last-left-counted" />
              }
            />
            {/*
              Signed, through the same rule the balance strip uses: a negative
              collection is cash somebody put back into a thin drawer, and it
              raises what was left rather than needing a branch of its own.
            */}
            <Row
              label={collected < 0 ? 'Added' : 'Collected'}
              value={<Money paise={collected} data-testid="last-left-collected" />}
            />
            <Row
              label="Left in the drawer"
              emphasis
              value={<Money paise={left} data-testid="last-left-left" />}
            />
          </div>

          {observation.expectedPaise !== null && (
            <Row
              label="Expected at that count"
              value={<Money paise={observation.expectedPaise} />}
            />
          )}

          {movementNotes.length > 0 && (
            <div className="border-t border-border pt-2">
              <p className="text-xs text-content-muted">Cash movement note</p>
              {movementNotes.map((note, index) => (
                <p key={`${note}-${index}`} className="text-sm text-content">
                  {note}
                </p>
              ))}
            </div>
          )}

          {observation.note && (
            <div className="border-t border-border pt-2">
              <p className="text-xs text-content-muted">Note</p>
              <p className="text-sm text-content">{observation.note}</p>
            </div>
          )}

          {observation.awayReason && (
            <div className="border-t border-border pt-2">
              <p className="text-xs text-content-muted">Why away</p>
              <p className="text-sm text-content">{observation.awayReason}</p>
            </div>
          )}

          <div className="border-t border-border pt-3">
            <Button size="phone" variant="secondary" onClick={onFix} data-testid="last-left-fix">
              <Pencil aria-hidden size={14} /> Fix this count
            </Button>
            {/*
              Said rather than left to be discovered by a field that does
              nothing: an observation is correctable, a movement is not.
            */}
            <p className="mt-2 text-xs text-content-muted">
              The amount {collected < 0 ? 'added' : 'collected'} is part of the movement recorded
              with this count and is corrected by counting again.
            </p>
          </div>
        </div>
      ) : null}
    </FormSheet>
  )
}

/**
 * Cash from Bills, day by day.
 *
 * The owner's question standing at the drawer is never *what is the total* — the
 * total is on screen. It is *which day did that come from*.
 */
export function ReceiptsBreakdown({
  open,
  onClose,
  context,
}: {
  open: boolean
  onClose: () => void
  context: BreakdownContext | null
}) {
  const state = context?.state ?? null
  const countedAt = state?.lastObservation?.countedAt ?? null

  return (
    <FormSheet open={open} onClose={onClose} title="Cash from Bills">
      {context && state ? (
        <div className="space-y-3" data-testid="receipts-breakdown">
          <ul className="space-y-2">
            {state.receiptsByDay.map((day) => (
              <li
                key={day.businessDate}
                className="flex items-baseline justify-between gap-3 border-b border-border pb-2 last:border-b-0"
                data-testid={`receipts-day-${day.businessDate}`}
              >
                <span className="min-w-0 text-sm font-semibold text-content">
                  {groupHeading(
                    day.businessDate,
                    context.today,
                    context.countBusinessDate,
                    countedAt,
                  )}
                </span>
                <span className="shrink-0 text-right">
                  <Money paise={day.paise} className="text-base font-bold text-content" />
                  <span className="block text-[0.6875rem] text-content-muted">
                    {day.bills} {day.bills === 1 ? 'bill' : 'bills'}
                  </span>
                </span>
              </li>
            ))}
          </ul>

          {state.receiptsByDay.length === 0 && (
            <p className="text-sm text-content-muted" data-testid="receipts-breakdown-empty">
              No cash has come in since the last count.
            </p>
          )}

          {/*
            The figure the breakdown was opened from, restated at the foot of it.
            It is the tile's own number rather than a sum taken here — the groups
            and the tile come from one predicate, and a total added up on this
            side would be a second opinion about the same money.
          */}
          <p className="flex items-baseline justify-between gap-3 border-t border-border pt-2">
            <span className="text-sm font-bold text-content">Since the last count</span>
            <Money
              paise={state.cashReceiptsSincePaise}
              className="text-base font-bold text-content"
              data-testid="receipts-breakdown-total"
            />
          </p>
        </div>
      ) : null}
    </FormSheet>
  )
}

/**
 * Cash Expenses, as the expense list itself.
 *
 * **Adding from here is the point, not a convenience.** An expense recorded now
 * against 27 Aug carries today's recording instant, so it lands inside the
 * current interval and the expected balance moves the moment it is saved — which
 * is exactly what somebody standing at an unreconciled drawer wants.
 *
 * One `ExpenseList` per business date, because that component's header row is
 * already a heading on the left and an Add on the right (design D4). Each holds
 * its own draft, its own expanded row and its own category fetch; the interval
 * is one to three days in every observed case, and the alternative is lifting
 * that component's form state into a parent two other surfaces and the tablet
 * depend on.
 */
export function ExpensesBreakdown({
  open,
  onClose,
  context,
  outletId,
  viewerId,
  onChanged,
}: {
  open: boolean
  onClose: () => void
  context: BreakdownContext | null
  outletId: string
  viewerId: string
  /** Reload the drawer, so a saved expense moves the expected balance at once. */
  onChanged: () => Promise<void> | void
}) {
  const { expenses: expensesAdapter } = useAdapters()
  const [rows, setRows] = useState<ExpenseRecord[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const state = context?.state ?? null
  const countedAt = state?.lastObservation?.countedAt ?? null

  /**
   * Today first, then whatever business dates the interval's expenses fell on.
   *
   * Today is always present so there is always somewhere to add; a past date
   * appears only where the interval actually holds rows for it (design D4).
   *
   * Carried through the effect as a joined string rather than as an array,
   * because an array rebuilt on every render is a new dependency on every
   * render — which is a read loop, not a reload.
   */
  const datesKey = [
    ...new Set([
      ...(context ? [context.today] : []),
      ...(state?.cashExpensesByDay ?? []).map((day) => day.businessDate),
    ]),
  ]
    .sort((a, b) => b.localeCompare(a))
    .join('|')
  const dates = datesKey === '' ? [] : datesKey.split('|')

  /**
   * The rows, re-read whenever the popup opens or the interval's dates change.
   *
   * `active` is the same guard every other surface here uses: a read that
   * resolves after the outlet moved must not paint the previous outlet's rows
   * under the new one's name.
   */
  const [reloadToken, setReloadToken] = useState(0)
  useEffect(() => {
    if (!open || outletId === '' || datesKey === '') return
    let active = true
    void expensesAdapter
      .listRecentExpenses(outletId, datesKey.split('|'))
      .then((found) => {
        if (!active) return
        setRows(found)
        setError(null)
      })
      .catch(() => {
        if (active) setError('Could not read the expenses for these days.')
      })
    return () => {
      active = false
    }
  }, [expensesAdapter, open, outletId, datesKey, reloadToken])

  /**
   * What `ExpenseList` calls after it writes: re-read these rows, and re-read
   * the drawer, so a saved expense moves the expected balance without a refresh.
   */
  const reload = useCallback(async () => {
    setReloadToken((token) => token + 1)
    await onChanged()
  }, [onChanged])

  return (
    <FormSheet open={open} onClose={onClose} title="Cash Expenses" error={error}>
      {context && state ? (
        <div className="space-y-5" data-testid="expenses-breakdown">
          {dates.map((businessDate) => {
            const group = state.cashExpensesByDay.find((day) => day.businessDate === businessDate)
            // **The interval's rows, by the same instant the SQL groups on.**
            // Listing the whole day would pull in cash the previous count
            // already settled, and the breakdown would stop adding up to the
            // tile it was opened from (design D3).
            const inInterval = (rows ?? []).filter(
              (expense) =>
                expense.businessDate === businessDate &&
                (countedAt === null || instantOf(expense) > countedAt),
            )
            // Counted, never listed. Listing them would re-raise the
            // disagreement the filter exists to prevent; omitting the sentence
            // would let somebody re-enter an expense they already recorded.
            const settledEarlier = (rows ?? []).filter(
              (expense) =>
                expense.businessDate === businessDate &&
                expense.isCash &&
                expense.voidedAt === null &&
                countedAt !== null &&
                instantOf(expense) <= countedAt,
            ).length

            return (
              <section key={businessDate} data-testid={`expenses-day-${businessDate}`}>
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-sm font-bold text-content">
                    {groupHeading(
                      businessDate,
                      context.today,
                      context.countBusinessDate,
                      countedAt,
                    )}
                  </h3>
                  {/*
                    Cash only, from the grouped reader. A non-cash expense is
                    listed and marked below and reaches no total here, because it
                    never came out of the drawer.
                  */}
                  <Money
                    paise={group?.paise ?? 0}
                    className="text-base font-bold text-content"
                    data-testid={`expenses-day-total-${businessDate}`}
                  />
                </div>

                {settledEarlier > 0 && (
                  <p
                    className="mt-0.5 text-xs text-content-muted"
                    data-testid={`expenses-day-settled-${businessDate}`}
                  >
                    {settledEarlier} earlier {settledEarlier === 1 ? 'expense' : 'expenses'} this
                    day {settledEarlier === 1 ? 'was' : 'were'} in the last count.
                  </p>
                )}

                <ExpenseList
                  expenses={rows === null ? null : inInterval}
                  outletId={outletId}
                  businessDate={businessDate}
                  currentBusinessDate={context.today}
                  // **True unconditionally, and that is safe rather than lazy.**
                  // This surface is gated by `app_may_reach_drawer()`, the
                  // owner-or-manager-at-this-outlet predicate, so nobody who
                  // cannot correct an expense can open this popup at all. It is
                  // deliberately NOT the expression `outlet-expenses-surface`
                  // computes: that surface serves Billers and Employees, and
                  // this one cannot be reached by either (design D4).
                  viewer={{ id: viewerId, mayTouchAnyRow: true }}
                  showDates={false}
                  heading={null}
                  emptyTitle="Nothing was recorded for this day."
                  onChanged={reload}
                />
              </section>
            )
          })}

          <p className="flex items-baseline justify-between gap-3 border-t border-border pt-2">
            <span className="text-sm font-bold text-content">Since the last count</span>
            <Money
              paise={state.cashExpensesSincePaise}
              className="text-base font-bold text-content"
              data-testid="expenses-breakdown-total"
            />
          </p>
        </div>
      ) : null}
    </FormSheet>
  )
}
