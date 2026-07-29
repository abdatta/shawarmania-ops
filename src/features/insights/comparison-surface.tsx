import { BarChart3 } from 'lucide-react'
import { useEffect, useState } from 'react'

import { DataTable, type DataTableColumn } from '@/components/layout/data-table'
import { EmptyState } from '@/components/layout/empty-state'
import { PageHeader } from '@/components/layout/page-header'
import { Money } from '@/components/ui/money'
import { Select } from '@/components/ui/select'
import { useAdapters } from '@/data-access'
import type { OutletComparisonRow } from '@/data-access/adapters'
import {
  describeDifference,
  formatPaise,
  PROFIT_BASIS_LABELS,
  resolveBusinessDate,
  type ProfitBasis,
} from '@/domain'

import { BasisPicker } from './profit-figure'
import { describePeriod, isPeriodKey, periodFor, PERIOD_KEYS, PERIOD_LABELS } from './period'

/**
 * Outlets side by side over a period — the screen that justifies the whole
 * system for a multi-outlet owner.
 *
 * The period and the profit basis are both **stated on screen**, not implied by
 * a control's position. Two outlets compared on different bases, or over ranges
 * the reader has to remember, is a comparison that misleads more reliably than
 * no comparison at all.
 */
export function ComparisonSurface() {
  const { outlets, insights } = useAdapters()

  const [periodKey, setPeriodKey] = useState<'today' | 'week' | 'month'>('week')
  const [basis, setBasis] = useState<ProfitBasis>('cash')
  const [today, setToday] = useState<string | null>(null)
  const [rows, setRows] = useState<OutletComparisonRow[]>()

  useEffect(() => {
    let active = true
    void outlets.listOutlets().then((list) => {
      if (!active || list.length === 0) {
        if (active) setRows([])
        return
      }
      // Every demo outlet shares a cutover; the first one's is as good as any,
      // and a comparison over two different business days would not be one.
      const first = list[0]
      if (first) setToday(resolveBusinessDate(new Date(), first.business_day_cutover))
    })
    return () => {
      active = false
    }
  }, [outlets])

  useEffect(() => {
    if (!today) return
    let active = true

    void (async () => {
      const list = await outlets.listOutlets()
      const result = await insights.comparison(
        list.map((outlet) => outlet.id),
        periodFor(periodKey, today),
        basis,
      )
      if (active) setRows(result)
    })()

    return () => {
      active = false
    }
  }, [outlets, insights, today, periodKey, basis])

  const period = today ? periodFor(periodKey, today) : null

  const columns: DataTableColumn<OutletComparisonRow>[] = [
    { id: 'outlet', header: 'Outlet', cell: (row) => row.outletName },
    { id: 'sales', header: 'Sales', money: true, paise: (row) => row.salesPaise },
    { id: 'expenses', header: 'Spent', money: true, paise: (row) => row.expensesPaise },
    { id: 'profit', header: 'Profit', money: true, paise: (row) => row.profitPaise },
    {
      id: 'difference',
      header: 'Drawer',
      align: 'right',
      cell: (row) =>
        row.cashDifferencePaise === null ? (
          <span className="text-content-muted">no closed day</span>
        ) : row.cashDifferencePaise === 0 ? (
          <span className="text-content-muted">balanced</span>
        ) : (
          <span data-difference={describeDifference(row.cashDifferencePaise)}>
            {formatPaise(Math.abs(row.cashDifferencePaise))}{' '}
            {describeDifference(row.cashDifferencePaise)}
          </span>
        ),
    },
  ]

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Compare outlets"
        subtitle={
          period
            ? `${describePeriod(period)} · ${PROFIT_BASIS_LABELS[basis]}`
            : 'Side by side over a period'
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label htmlFor="comparison-period" className="text-xs font-semibold text-content-muted">
            Period
          </label>
          <Select
            id="comparison-period"
            data-testid="comparison-period"
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
        <BasisPicker id="comparison-basis" value={basis} onChange={setBasis} />
      </div>

      {rows === undefined ? (
        <p className="text-sm text-content-muted">Loading…</p>
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(row) => row.outletId}
            empty={
              <EmptyState
                icon={BarChart3}
                title="There is nothing to compare yet — a comparison needs at least one outlet with recorded trade."
              />
            }
          />

          {rows.length > 0 && (
            <div className="mt-3 space-y-2 text-xs text-content-muted">
              <p data-testid="comparison-basis-note">
                <strong className="text-content">{PROFIT_BASIS_LABELS[basis]}.</strong>{' '}
                {basis === 'cash'
                  ? 'Profit here is sales minus everything spent, including stock bought.'
                  : 'Profit here is sales minus running costs minus the stock actually used — so food bought and food used are never both subtracted.'}
              </p>
              <p>
                Every figure is summed from the bills, expenses and stock movements each outlet
                recorded. A day that has been closed contributes what was counted and signed off,
                never a recomputation of it.
              </p>
            </div>
          )}

          {rows.length > 0 && (
            <dl className="mt-4 space-y-1 text-sm" data-testid="comparison-totals">
              <div className="flex items-baseline justify-between border-t border-border pt-2">
                <dt className="font-bold text-content">Across every outlet shown</dt>
                <dd>
                  <Money
                    paise={rows.reduce((running, row) => running + row.profitPaise, 0)}
                    className="font-bold"
                    data-testid="comparison-total-profit"
                  />
                </dd>
              </div>
            </dl>
          )}
        </>
      )}
    </div>
  )
}
