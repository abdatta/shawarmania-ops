import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'

import { PageHeader } from '@/components/layout/page-header'
import { Card } from '@/components/ui/card'
import { LoadingBlock } from '@/components/ui/loading'
import { DayField, PeriodBar } from '@/components/ui/period-bar'
import { useAdapters } from '@/data-access'
import { resolveBusinessDate, shiftBusinessDate } from '@/domain'
import { useOutletScope } from '@/features/outlet-scope'
import { cn } from '@/lib/cn'

import { LedgerDay } from './ledger-day'
import { LedgerMonth } from './ledger-month'
import { monthOf } from './ledger'

/**
 * The manual ledger (#36) — **a stopgap with a known end date, and the whole
 * folder goes when it ends.**
 *
 * Billing (#10), expenses (#11) and daily cash (#12) are not live while August
 * 2026 is trading, and nobody can reconstruct a month from memory in September.
 * This is where the owner writes it down until those surfaces land, so that two
 * questions stay answerable: did the drawer balance today, and did this month's
 * trading cover its costs.
 *
 * It is a **notebook, not a workflow**. No day sign-off, no approval, no
 * correction history, no badge. A wrong figure is retyped, because there is
 * exactly one reader and one writer and a correction trail would cost more than
 * the month of data it protected (design D6).
 *
 * **It grants no authority that survives it.** The owner may type cash figures
 * here because no drawer record exists yet to corrupt. The live boundary in
 * `docs/LIMITATIONS.md` is untouched: a Super Admin still cannot record a cash
 * expense, take cash out, or close a day at an outlet remotely, and #12 must not
 * inherit this permission when it carries these rows across.
 */

/**
 * How far back either control reaches, this month included.
 *
 * One number for both: the day field's floor is the first of the earliest month
 * the month stepper can reach, so the two controls cannot disagree about how much
 * history this ledger admits to having.
 */
const MONTHS_OFFERED = 4

type View = 'day' | 'month'

export function ManualLedgerSurface() {
  const { outlets } = useAdapters()

  // Which outlet. One tap, remembered per person per device (#28), and it confers
  // nothing — the database decides every write from the assignment.
  const { outletId, selector: outletSelector } = useOutletScope()

  // Read once, not watched. It is where the day OPENS, not what it is: the
  // reader can step to another day from here, and a watched parameter would drag
  // them back to the linked one every time they did.
  const [searchParams] = useSearchParams()
  const requested = searchParams.get('date')
  const requestedDate = requested && /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : null

  const [today, setToday] = useState<string | null>(null)
  const [businessDate, setBusinessDate] = useState<string | null>(null)
  const [month, setMonth] = useState<string | null>(null)
  const [view, setView] = useState<View>('day')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!outletId) return
    let active = true

    void outlets
      .getOutlet(outletId)
      .then((outlet) => {
        if (!active || !outlet) return
        // Through the outlet's cutover, never off the device clock: a figure typed
        // at 00:30 belongs to the trading day that is still running.
        const resolved = resolveBusinessDate(new Date(), outlet.business_day_cutover)
        setToday(resolved)
        // `?date=` opens a particular trading day, so one can be linked to.
        // Clamped to today rather than trusted: this ledger refuses a future
        // date at the database, and a link that opened a day nothing can be
        // saved on would be a dead end rather than a shortcut.
        const asked = requestedDate
        const opening = asked && asked <= resolved ? asked : resolved
        setBusinessDate(opening)
        setMonth(monthOf(opening))
      })
      .catch(() => {
        if (active) setError('Could not work out which day this is. Try again in a moment.')
      })

    return () => {
      active = false
    }
  }, [outlets, outletId])

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        scope={outletSelector}
        title="Ledger"
        subtitle="Written down by hand until billing, expenses and cash go live."
      />

      {error && (
        <p
          role="alert"
          data-testid="ledger-surface-error"
          className="mb-3 text-sm font-semibold text-danger"
        >
          {error}
        </p>
      )}

      {/*
        Two controls, each its own full-width bar: what to look at, and which one.
        The period bar is the same shape the attendance range picker uses — a
        bordered strip with a step either side of the label — because they answer
        the same question and a second idiom for it would be a second thing to
        learn.
      */}
      <div className="mb-3 space-y-2">
        <div
          role="group"
          aria-label="What to look at"
          className="grid grid-cols-2 gap-1 rounded-xl border border-border bg-surface p-1"
          data-testid="ledger-view"
        >
          {(['day', 'month'] as const).map((candidate) => (
            <button
              key={candidate}
              type="button"
              aria-pressed={view === candidate}
              data-testid={`ledger-view-${candidate}`}
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

        {today === null ? (
          // The bar's own silhouette, so the panel below it does not move when the
          // outlet's today lands.
          <LoadingBlock
            label="which day can be recorded"
            className="h-[calc(var(--size-control-phone)+0.5rem+2px)] w-full"
            data-testid="ledger-picker-loading"
          />
        ) : view === 'day' ? (
          <PeriodBar
            label="Day"
            testIdPrefix="ledger"
            onStep={(by) => setBusinessDate(shiftBusinessDate(businessDate ?? today, by))}
            canStepForward={(businessDate ?? today) < today}
          >
            <DayField
              businessDate={businessDate ?? today}
              today={today}
              earliest={`${monthsBack(today, MONTHS_OFFERED).at(-1) ?? monthOf(today)}-01`}
              testIdPrefix="ledger"
              onChange={setBusinessDate}
            />
          </PeriodBar>
        ) : (
          <PeriodBar
            label="Month"
            testIdPrefix="ledger"
            onStep={(by) => setMonth(shiftMonth(month ?? monthOf(today), by))}
            canStepForward={(month ?? monthOf(today)) < monthOf(today)}
          >
            {/*
              A label rather than a field, exactly as the attendance picker does
              it: `input type="month"` is a text box in Firefox, and there is
              nothing to type here that two taps do not reach.
            */}
            <span
              data-testid="ledger-month-picker"
              data-month={month ?? monthOf(today)}
              className="font-semibold text-content"
            >
              {monthLabel(month ?? monthOf(today))}
            </span>
          </PeriodBar>
        )}
      </div>

      {!outletId ? (
        <Card data-testid="ledger-no-outlet">
          <p className="text-sm text-content-muted">
            There is no outlet to record against yet. Create one under Outlets first.
          </p>
        </Card>
      ) : view === 'day' ? (
        businessDate === null ? (
          <LoadingBlock label="this day" className="h-64" data-testid="ledger-day-waiting" />
        ) : (
          // Keyed on what it is about, so changing the outlet or the day remounts
          // it with empty state and it waits behind its own shimmer. Without this
          // the previous day's figures would sit under the new day's heading
          // until the read landed, which is the one thing a placeholder exists to
          // prevent.
          <LedgerDay
            key={`${outletId}-${businessDate}`}
            outletId={outletId}
            businessDate={businessDate}
          />
        )
      ) : month === null ? (
        <LoadingBlock label="this month" className="h-64" data-testid="ledger-month-waiting" />
      ) : (
        <LedgerMonth key={`${outletId}-${month}`} outletId={outletId} month={month} />
      )}
    </div>
  )
}

/** `YYYY-MM` moved by whole months. Zero-based, so stepping over January is free. */
function shiftMonth(month: string, by: number): string {
  const [year, monthNumber] = month.split('-').map(Number)
  const zeroBased = (year ?? 0) * 12 + (monthNumber ?? 1) - 1 + by
  return `${Math.floor(zeroBased / 12)}-${String((zeroBased % 12) + 1).padStart(2, '0')}`
}

/** `YYYY-MM` for this month and the ones before it, most recent first. */
function monthsBack(today: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => shiftMonth(monthOf(today), -index))
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

function monthLabel(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number)
  return `${MONTH_NAMES[(monthNumber ?? 1) - 1] ?? month} ${year ?? ''}`
}
