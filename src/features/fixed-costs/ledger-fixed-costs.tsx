import { CalendarClock } from 'lucide-react'
import { Link } from 'react-router'

import { Card } from '@/components/ui/card'
import { Money } from '@/components/ui/money'
import type { FixedCostsReading } from '@/data-access/fixed-costs'
import {
  coveredPercent,
  shortOfCoveringPaise,
  fixedCostLabel,
  monthOf,
  proRataPnl,
  readProRata,
} from '@/domain/fixed-costs'

import { monthName } from './words'

const SHORT = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  timeZone: 'Asia/Kolkata',
})

/** **Fixed**, drawn as the Cash chip is. */
export function FixedChip({
  paidOn,
  testId,
}: {
  paidOn?: string | null | undefined
  testId?: string
}) {
  return (
    <>
      <span
        data-testid={testId}
        className="inline-flex items-center gap-1 rounded-lg border border-primary px-2 py-0.5 text-xs font-semibold text-content"
      >
        <CalendarClock aria-hidden size={12} />
        Fixed
        <span className="sr-only"> cost payment</span>
      </span>
      {paidOn && (
        <span className="text-xs font-normal text-content-muted">
          paid {SHORT.format(new Date(`${paidOn}T12:00:00+05:30`))}
        </span>
      )}
    </>
  )
}

/**
 * The current month's P&L (Pro-rata) on the Ledger (design D6, D9): P&L, the
 * unpaid share of this month's fixed costs owed so far, Pro-rata P&L with how
 * far through the month it is, then the month's fixed costs, how much of them
 * trading covers so far, and what is still to pay, then each fixed cost.
 *
 * Shown only for the current month, and only where it has a fixed cost: a past
 * month reads P&L from what was paid, and nothing else (owner, 2026-10-19).
 */
export function ProRataCard({
  month,
  pnlPaise,
  reading,
  fixedCostsPath,
  search = '',
}: {
  month: string
  pnlPaise: number
  reading: FixedCostsReading
  fixedCostsPath: string
  search?: string
}) {
  if (monthOf(reading.today) !== `${month.slice(0, 7)}-01`) return null
  const proRata = readProRata(reading.costs, reading.today)
  if (proRata.lines.length === 0) return null
  const figure = proRataPnl(pnlPaise, proRata)
  const covered = coveredPercent(pnlPaise, proRata)
  const short = shortOfCoveringPaise(pnlPaise, proRata)
  return (
    <Card className="space-y-2" data-testid="month-pro-rata">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-content">P&amp;L</span>
        <Money paise={pnlPaise} className="text-sm font-semibold" />
      </div>
      <div className="flex items-baseline justify-between gap-2 text-sm text-content-muted">
        <span>Fixed costs owed so far, unpaid</span>
        <Money paise={-proRata.unpaidPaise} data-testid="month-pro-rata-unpaid" />
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-t border-border pt-2">
        <span className="text-sm font-bold text-content">P&amp;L (Pro-rata)</span>
        <Money paise={figure} display data-testid="month-pro-rata-figure" />
      </div>
      <p className="text-sm font-semibold text-content">
        This month&rsquo;s fixed costs charged to today
      </p>

      <dl className="grid grid-cols-3 gap-2 pt-1">
        <div className="rounded-lg bg-surface-raised px-3 py-2">
          <dt className="text-xs text-content-muted">Fixed costs</dt>
          <dd className="text-sm font-semibold">
            <Money paise={proRata.monthPaise} />
          </dd>
        </div>
        <div className="rounded-lg bg-surface-raised px-3 py-2">
          <dt className="text-xs text-content-muted">Covered</dt>
          <dd className="text-sm font-semibold" data-testid="month-pro-rata-covered">
            {covered}%
          </dd>
        </div>
        <div className="rounded-lg bg-surface-raised px-3 py-2">
          <dt className="text-xs text-content-muted">Left to pay</dt>
          <dd className="text-sm font-semibold">
            <Money paise={proRata.stillToPayPaise} />
          </dd>
        </div>
      </dl>
      <div
        className="h-2 overflow-hidden rounded-full bg-surface-raised"
        role="progressbar"
        aria-label="Fixed costs covered by trading so far"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={covered}
      >
        <div className="h-full rounded-full bg-primary" style={{ width: `${covered}%` }} />
      </div>
      {/*
        The finish line beside the headline (owner, 2026-10-19): P&L (Pro-rata)
        says how the month is going at this pace; this says how far its trading
        is from covering the whole month's fixed costs. Gone once it covers them.
      */}
      {short > 0 && (
        <div
          className="flex items-baseline justify-between gap-2 text-sm"
          data-testid="month-short-of-covering"
        >
          <span className="text-content">Short of covering {monthName(proRata.month)}</span>
          <Money paise={short} className="font-semibold" />
        </div>
      )}

      <ul className="space-y-1 pt-2" data-testid="month-fixed-costs">
        {proRata.lines.map((line) => (
          <li key={line.id}>
            <Link
              to={`${fixedCostsPath}/${line.id}${search}`}
              className="flex items-baseline justify-between gap-2 rounded-md text-xs focus-visible:focus-ring"
            >
              <span className="min-w-0 text-content">
                {fixedCostLabel(line.name, line.category)}
                <span className="text-content-muted">
                  {' '}
                  · {line.stillToPayPaise === 0 ? 'paid' : `to pay `}
                  {line.stillToPayPaise > 0 && <Money paise={line.stillToPayPaise} />}
                </span>
              </span>
              <Money paise={line.costPaise} className="shrink-0 text-content-muted" />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  )
}
