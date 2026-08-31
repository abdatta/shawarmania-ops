import { FileText, Lock } from 'lucide-react'
import { useEffect, useState } from 'react'

import { DataTable, type DataTableColumn } from '@/components/layout/data-table'
import { EmptyState } from '@/components/layout/empty-state'
import { PageHeader } from '@/components/layout/page-header'
import { Card } from '@/components/ui/card'
import { LoadingFigures } from '@/components/ui/loading'
import { Money } from '@/components/ui/money'
import { Select } from '@/components/ui/select'
import { useAdapters, type Tables } from '@/data-access'
import type { PeriodDay, PeriodSummary } from '@/data-access/adapters'
import { describeDifference, formatBusinessDate, formatPaise, resolveBusinessDate } from '@/domain'

import { describePeriod, isPeriodKey, periodFor, PERIOD_KEYS, PERIOD_LABELS } from './period'
import { ProfitFigure } from './profit-figure'

/**
 * Period reports: what a period came to, day by day and in total.
 *
 * **Nothing here produces a file, deliberately.** These are demonstration
 * figures, and a downloadable file of invented revenue is more circulable than
 * a screenshot — it arrives detached from the non-dismissible banner that is the
 * only reason a screenshot of this screen is survivable. So exporting is absent
 * with its reason on screen rather than greyed out, and it becomes possible when
 * the figures become real (`owner-console-live`, #13). See design D7.
 */
export function ReportsSurface() {
  const { outlets, insights } = useAdapters()

  const [available, setAvailable] = useState<Tables<'outlets'>[]>([])
  const [outletId, setOutletId] = useState<string | null>(null)
  const [today, setToday] = useState<string | null>(null)
  // A week, not a month. The day-by-day table lists every business day in the
  // period — deliberately, since dropping quiet days would make a week look
  // busier than it was — so a month-long default opens on a wall of zeros
  // before the first figure a reader is looking for.
  const [periodKey, setPeriodKey] = useState<'today' | 'week' | 'month'>('week')
  const [summary, setSummary] = useState<PeriodSummary | null>()

  useEffect(() => {
    let active = true
    void outlets.listOutlets().then((list) => {
      if (!active) return
      setAvailable(list)
      const first = list[0]
      if (first) {
        setOutletId((current) => current ?? first.id)
        setToday(resolveBusinessDate(new Date(), first.business_day_cutover))
      }
    })
    return () => {
      active = false
    }
  }, [outlets])

  useEffect(() => {
    if (!outletId || !today) return
    let active = true
    void insights.periodSummary(outletId, periodFor(periodKey, today), 'cash').then((result) => {
      if (active) setSummary(result)
    })
    return () => {
      active = false
    }
  }, [insights, outletId, today, periodKey])

  const period = today ? periodFor(periodKey, today) : null

  const dayColumns: DataTableColumn<PeriodDay>[] = [
    {
      id: 'date',
      header: 'Day',
      cell: (day) => formatBusinessDate(day.businessDate),
    },
    { id: 'sales', header: 'Sales', money: true, paise: (day) => day.salesPaise },
    {
      id: 'drawer',
      header: 'Drawer',
      align: 'right',
      cell: (day) =>
        !day.dayClosed ? (
          <span className="text-content-muted">not closed</span>
        ) : day.cashDifferencePaise === 0 || day.cashDifferencePaise === null ? (
          <span className="text-content-muted">balanced</span>
        ) : (
          <span data-difference={describeDifference(day.cashDifferencePaise)}>
            {formatPaise(Math.abs(day.cashDifferencePaise))}{' '}
            {describeDifference(day.cashDifferencePaise)}
          </span>
        ),
    },
  ]

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Reports"
        subtitle={period ? describePeriod(period) : 'A period, summarised'}
      />

      <div className="mb-3 flex flex-wrap items-center gap-3">
        {available.length > 1 && (
          <div className="flex items-center gap-2">
            <label htmlFor="report-outlet" className="text-xs font-semibold text-content-muted">
              Outlet
            </label>
            <Select
              id="report-outlet"
              data-testid="report-outlet"
              className="h-11 w-auto"
              value={outletId ?? ''}
              onChange={(event) => setOutletId(event.target.value)}
            >
              {available.map((outlet) => (
                <option key={outlet.id} value={outlet.id}>
                  {outlet.name}
                </option>
              ))}
            </Select>
          </div>
        )}

        <div className="flex items-center gap-2">
          <label htmlFor="report-period" className="text-xs font-semibold text-content-muted">
            Period
          </label>
          <Select
            id="report-period"
            data-testid="report-period"
            className="h-11 w-auto"
            value={periodKey}
            onChange={(event) => {
              const value = event.target.value
              if (isPeriodKey(value)) setPeriodKey(value)
            }}
          >
            {PERIOD_KEYS.map((key) => (
              <option key={key} value={key}>
                {PERIOD_LABELS[key]}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {summary === undefined ? (
        // The totals, the spend breakdown and the profit figure — the three
        // cards this report opens with.
        <LoadingFigures label="this period’s report" rows={[5, 4, 4]} />
      ) : summary === null ? (
        <EmptyState
          icon={FileText}
          title="No figures for this outlet yet — a report is summed from recorded bills, expenses and stock movements."
        />
      ) : (
        <div className="space-y-3">
          <Card className="space-y-2" data-testid="report-totals">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-bold text-content">Sales</span>
              <Money paise={summary.salesPaise} display data-testid="report-sales" />
            </div>
            <p className="text-xs text-content-muted">
              {summary.billCount === 1 ? '1 bill' : `${summary.billCount} bills`} over{' '}
              {summary.days.length === 1 ? '1 day' : `${summary.days.length} days`}
            </p>
            <ul className="space-y-1 border-t border-border pt-2 text-xs">
              {summary.salesByMethod.map((total) => (
                <li key={total.method} className="flex items-baseline justify-between">
                  <span className="text-content-muted">{total.method}</span>
                  <Money paise={total.amountPaise} />
                </li>
              ))}
            </ul>
          </Card>

          <Card className="space-y-2" data-testid="report-expenses">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-bold text-content">Spent</span>
              <Money paise={summary.expensesPaise} data-testid="report-expenses-total" />
            </div>
            <ul className="space-y-1 border-t border-border pt-2 text-xs">
              {summary.expensesByCategory.map((total) => (
                <li key={total.category} className="flex items-baseline justify-between">
                  <span className="text-content-muted">{total.category.replace(/_/g, ' ')}</span>
                  <Money paise={total.amountPaise} />
                </li>
              ))}
            </ul>
          </Card>

          <Card data-testid="report-profit">
            <ProfitFigure estimate={summary.profit} testId="report-profit-figure" />
          </Card>

          <div data-testid="report-days">
            <h2 className="mb-2 text-sm font-bold text-content">Day by day</h2>
            <DataTable
              columns={dayColumns}
              rows={summary.days}
              rowKey={(day) => day.businessDate}
              empty={<EmptyState title="This period contains no business days." />}
            />
          </div>

          <Card className="space-y-1" data-testid="export-unavailable">
            <p className="flex items-center gap-2 text-sm font-bold text-content">
              <Lock aria-hidden size={16} />
              These figures cannot be exported
            </p>
            <p className="text-xs text-content-muted">
              Everything on this screen is demonstration data. A file of invented revenue is far
              easier to forward than a screenshot, and it would arrive without the banner that says
              what it is — so there is deliberately no way to produce one. Exporting arrives when
              the figures do.
            </p>
          </Card>
        </div>
      )}
    </div>
  )
}
