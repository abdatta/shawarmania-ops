import { CalendarClock } from 'lucide-react'
import { Link } from 'react-router'

import { Money } from '@/components/ui/money'
import { Explain } from '@/components/ui/why'
import type { FixedCostsReading } from '@/data-access/fixed-costs'
import {
  aheadOfCoveringPaise,
  coveredPercent,
  fixedCostLabel,
  monthOf,
  proRataPnl,
  readProRata,
  type ProRataReading,
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
 * The current month's fixed costs read against P&L at the Ledger's `today`, or
 * null where the month shown is not the current one or has no fixed cost: a past
 * month reads P&L from what was paid, and nothing else (owner, 2026-10-19).
 */
export function currentProRata(month: string, reading: FixedCostsReading) {
  if (monthOf(reading.today) !== `${month.slice(0, 7)}-01`) return null
  const proRata = readProRata(reading.costs, reading.today)
  return proRata.lines.length === 0 ? null : proRata
}

/**
 * The rest of the month's one P&L card where the current month has fixed costs
 * (design D6, D9, *Short or Ahead*): the unpaid share of this month's fixed costs
 * owed so far, P&L (Pro-rata) as the card's headline, how far the month is Short
 * of or Ahead of covering its fixed costs, then the month's fixed costs, how much
 * of them is covered, what is left to pay, and each fixed cost.
 */
export function ProRataRows({
  pnlPaise,
  proRata,
  fixedCostsPath,
  search = '',
}: {
  pnlPaise: number
  proRata: ProRataReading
  fixedCostsPath: string
  search?: string
}) {
  const figure = proRataPnl(pnlPaise, proRata)
  const covered = coveredPercent(pnlPaise, proRata)
  const ahead = aheadOfCoveringPaise(pnlPaise, proRata)
  const name = monthName(proRata.month)
  return (
    <div className="space-y-2" data-testid="month-pro-rata">
      <div className="flex items-baseline justify-between gap-2 text-sm text-content-muted">
        <span>Fixed costs owed so far, unpaid</span>
        <Money paise={-proRata.unpaidPaise} data-testid="month-pro-rata-unpaid" />
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-t border-border pt-2">
        <Explain
          label="what P&L (Pro-rata) means"
          className="text-sm font-bold text-content"
          explanation={
            <>
              Current profit less the part of {name}&rsquo;s fixed costs owed up to today and not
              yet paid. Once a fixed cost is paid, the payment is in Current profit and stops being
              spread.
            </>
          }
        >
          P&amp;L (Pro-rata)
        </Explain>
        <Money paise={figure} display data-testid="month-pro-rata-figure" />
      </div>
      {/*
        The finish line beside the headline (owner, 2026-10-19, 2026-10-21): P&L
        (Pro-rata) says how the month is going at this pace; this says how far it
        is from covering the whole month's fixed costs, and then how far past.
      */}
      <div
        className="flex items-baseline justify-between gap-2 text-sm"
        data-testid="month-covering"
      >
        <Explain
          label={`what ${ahead < 0 ? 'short' : 'ahead'} of covering means`}
          className="text-content"
          explanation={
            <>
              Current profit with all of {name}&rsquo;s fixed costs charged, paid or not. Short
              until the month&rsquo;s trading covers them, Ahead after.
            </>
          }
        >
          {ahead < 0 ? 'Short' : 'Ahead'} of covering {name}
        </Explain>
        <Money paise={Math.abs(ahead)} className="font-semibold" />
      </div>

      <dl className="grid grid-cols-3 gap-2 border-t border-border pt-3">
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
        aria-label="Fixed costs covered so far"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={covered}
      >
        <div className="h-full rounded-full bg-primary" style={{ width: `${covered}%` }} />
      </div>

      <ul className="space-y-1 pt-1" data-testid="month-fixed-costs">
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
    </div>
  )
}
