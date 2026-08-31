import { TrendingUp } from 'lucide-react'
import { useEffect, useState } from 'react'

import { EmptyState } from '@/components/layout/empty-state'
import { PageHeader } from '@/components/layout/page-header'
import { Card } from '@/components/ui/card'
import { LoadingFigures } from '@/components/ui/loading'
import { Money } from '@/components/ui/money'
import { Select } from '@/components/ui/select'
import { useAdapters, type Tables } from '@/data-access'
import type { PeriodSummary } from '@/data-access/adapters'
import { resolveBusinessDate } from '@/domain'
import { useSession } from '@/session/context'

import { describePeriod, isPeriodKey, periodFor, PERIOD_KEYS, PERIOD_LABELS } from './period'
import { ProfitFigure } from './profit-figure'

/**
 * Profit and loss — one component, two roles.
 *
 * A Franchise Admin sees their own outlet, resolved from the session. The Super
 * Admin picks one, because they belong to none. `admin-pnl` and `owner-pnl` are
 * separate gate entries reaching this component, which is the pattern the menu
 * surface established: the permission difference is visible rather than
 * asserted, and the refusal behind it is the adapter's.
 *
 * The one available cash basis is stated beside every figure.
 */
export function PnlSurface() {
  const session = useSession()
  const { outlets, insights } = useAdapters()

  const [available, setAvailable] = useState<Tables<'outlets'>[]>([])
  const [outletId, setOutletId] = useState<string | null>(session.outletId)
  const [today, setToday] = useState<string | null>(null)
  const [periodKey, setPeriodKey] = useState<'today' | 'week' | 'month'>('week')
  const [summary, setSummary] = useState<PeriodSummary | null>()

  // A manager's outlet is decided by their session and is not theirs to change.
  // The picker is the owner's control, and it must not render for anybody who
  // already belongs somewhere — the outlets adapter lists what the *product*
  // has, not what this caller may report on.
  const fixedOutletId = session.outletId

  useEffect(() => {
    if (fixedOutletId) return
    let active = true
    void outlets.listOutlets().then((list) => {
      if (!active) return
      setAvailable(list)
      // The owner belongs to no outlet, so the first one they may read is the
      // sensible landing place.
      setOutletId((current) => current ?? list[0]?.id ?? null)
    })
    return () => {
      active = false
    }
  }, [outlets, fixedOutletId])

  useEffect(() => {
    if (!outletId) return
    let active = true
    void outlets.getOutlet(outletId).then((outlet) => {
      if (active && outlet) {
        setToday(resolveBusinessDate(new Date(), outlet.business_day_cutover))
      }
    })
    return () => {
      active = false
    }
  }, [outlets, outletId])

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

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Profit and loss"
        subtitle={period ? describePeriod(period) : 'An estimate over a period'}
      />

      <div className="mb-3 flex flex-wrap items-center gap-3">
        {available.length > 1 && (
          <div className="flex items-center gap-2">
            <label htmlFor="pnl-outlet" className="text-xs font-semibold text-content-muted">
              Outlet
            </label>
            <Select
              id="pnl-outlet"
              data-testid="pnl-outlet"
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
          <label htmlFor="pnl-period" className="text-xs font-semibold text-content-muted">
            Period
          </label>
          <Select
            id="pnl-period"
            data-testid="pnl-period"
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
        // The three cards that land: the profit figure, where the money came
        // from, and where it went.
        <LoadingFigures label="this period’s profit and loss" rows={[4, 4, 5]} />
      ) : summary === null ? (
        <EmptyState
          icon={TrendingUp}
          title="No figures for this outlet yet — profit and loss is estimated from recorded bills, expenses and stock movements."
        />
      ) : (
        <div className="space-y-3">
          <Card data-testid="pnl-figure">
            <ProfitFigure estimate={summary.profit} testId="pnl-profit" />
          </Card>

          <Card className="space-y-2" data-testid="pnl-sales">
            <h2 className="text-sm font-bold text-content">Where the money came from</h2>
            {summary.salesByMethod.length === 0 ? (
              <p className="text-xs text-content-muted">Nothing was rung in this period.</p>
            ) : (
              <ul className="space-y-1 text-xs">
                {summary.salesByMethod.map((total) => (
                  <li key={total.method} className="flex items-baseline justify-between">
                    <span className="text-content-muted">{total.method}</span>
                    <Money paise={total.amountPaise} />
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="space-y-2" data-testid="pnl-expenses">
            <h2 className="text-sm font-bold text-content">Where it went</h2>
            {summary.expensesByCategory.length === 0 ? (
              <p className="text-xs text-content-muted">Nothing was recorded in this period.</p>
            ) : (
              <ul className="space-y-1 text-xs">
                {summary.expensesByCategory.map((total) => (
                  <li key={total.category} className="flex items-baseline justify-between">
                    <span className="text-content-muted">{total.category.replace(/_/g, ' ')}</span>
                    <Money paise={total.amountPaise} />
                  </li>
                ))}
              </ul>
            )}
            <p className="border-t border-border pt-2 text-xs text-content-muted">
              Equipment and other capital purchases recorded as drawer spends do not enter this
              operating estimate.
            </p>
          </Card>
        </div>
      )}
    </div>
  )
}
