import { useEffect, useState, type ReactNode } from 'react'
import { Info } from 'lucide-react'
import { useSearchParams } from 'react-router'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Chip } from '@/components/ui/chip'
import { Explain } from '@/components/ui/why'
import { LoadingRegion, Shimmer } from '@/components/ui/loading'
import { useAdapters } from '@/data-access'
import type { AnalyticsSnapshot, AnalyticsSubject } from '@/data-access/analytics'
import { resolveBusinessDate } from '@/domain'
import { validAnalyticsDate, periodDays, shiftDate } from '@/domain/sales-analytics'
import { useOutletScope } from '@/features/outlet-scope'
import { AnalyticsRange } from './analytics-range'
import { ItemsPanel } from './items-panel'
import { AnalyticsControls } from './analytics-controls'
import { ITEM_GRAINS, ITEM_METRICS, SALES_GRAINS, SALES_METRICS } from './analytics-trend'
import { SalesPanel } from './sales-panel'

export function AnalyticsSurface({ kind }: { kind: 'items' | 'trends' }) {
  const { outletId, selector } = useOutletScope()
  useEffect(() => {
    const page = document.scrollingElement
    if (page) page.scrollTop = 0
  }, [kind])
  return (
    <OutletAnalytics
      key={outletId ?? 'loading'}
      outletId={outletId}
      selector={selector}
      kind={kind}
    />
  )
}

function OutletAnalytics({
  outletId,
  selector,
  kind,
}: {
  outletId: string | null
  selector: ReactNode
  kind: 'items' | 'trends'
}) {
  const { analytics, outlets } = useAdapters()
  const [params, setParams] = useSearchParams()
  const [today, setToday] = useState<string | null>(null)
  const from = params.get('from') ?? (today ? shiftDate(today, -7) : '')
  const to = params.get('to') ?? (today ? shiftDate(today, -1) : '')
  const grain =
    params.get('grain') === 'week' ? 'week' : params.get('grain') === 'hour' ? 'hour' : 'day'
  const metric =
    params.get('metric') === 'orders'
      ? 'orders'
      : params.get('metric') === 'aov'
        ? 'aov'
        : 'revenue'
  const itemMetric = params.get('metric') === 'revenue' ? 'revenue' : 'units'
  // What the Items chart draws, so a reload or a shared link keeps it.
  const subject: AnalyticsSubject = params.get('dish')
    ? { kind: 'item', key: params.get('dish')! }
    : params.get('category')
      ? { kind: 'category', name: params.get('category')! }
      : { kind: 'all' }
  const periods = Math.max(1, Math.min(4, Number(params.get('periods')) || 2))
  const [loaded, setLoaded] = useState<{ key: string; data: AnalyticsSnapshot } | null>(null)
  // Items always reads its previous period, for each dish's change with Compare off.
  const readPeriods = Math.max(kind === 'items' ? 2 : 1, Math.floor(periods))
  const readKey = `${outletId}:${from}:${to}:${kind}:${readPeriods}`
  const data = loaded?.key === readKey ? loaded.data : null
  const [error, setError] = useState(false)
  const [retry, setRetry] = useState(0)
  const valid =
    validAnalyticsDate(from) && validAnalyticsDate(to) && to >= from && periodDays(from, to) <= 92
  useEffect(() => {
    let alive = true
    if (outletId)
      void outlets
        .getOutlet(outletId)
        .then((o) => {
          if (alive && o) setToday(resolveBusinessDate(new Date(), o.business_day_cutover))
          else if (alive) setError(true)
        })
        .catch(() => {
          if (alive) setError(true)
        })
    return () => {
      alive = false
    }
  }, [outletId, outlets, retry])
  useEffect(() => {
    let alive = true
    if (!outletId || !valid || !today) return
    void analytics
      .read(outletId, from, to, {
        view: kind === 'items' ? 'items' : 'sales',
        periods: readPeriods,
      })
      .then((next) => {
        if (alive) {
          setLoaded({ key: readKey, data: next })
          setError(false)
        }
      })
      .catch(() => {
        if (alive) setError(true)
      })
    return () => {
      alive = false
    }
  }, [analytics, outletId, from, to, valid, today, retry, readKey, kind, readPeriods])
  function change(values: Record<string, string>) {
    if ('from' in values || 'to' in values) {
      setError(false)
      setRetry((n) => n + 1)
    }
    setParams((previous) => {
      const next = new URLSearchParams(previous)
      Object.entries(values).forEach(([key, value]) =>
        value ? next.set(key, value) : next.delete(key),
      )
      return next
    })
  }
  return (
    <div className="mx-auto max-w-5xl space-y-3">
      <PageHeader
        title={kind === 'items' ? 'Items' : 'Sales'}
        scope={selector}
        action={
          <Explain
            label="About these figures"
            className="min-h-11 min-w-11 justify-center rounded-lg"
            explanation={
              <div className="space-y-3">
                <p>
                  Settled counter bills synced to the server. Open and voided orders are excluded;
                  bills still on an offline tablet arrive after sync.
                </p>
                <p>
                  Equal adjacent ranges, using the outlet’s Kolkata business dates. The previous
                  range is{' '}
                  {valid
                    ? `${shiftDate(from, -periodDays(from, to))} to ${shiftDate(from, -1)}`
                    : 'available after choosing dates'}
                  .
                </p>
                <p>
                  Dish revenue uses captured line prices and line discounts; it excludes bill-level
                  discounts, tax, rounding and packaging. Order shares can total more than 100%
                  because an order can contain several dishes.
                </p>
                <p>
                  Availability is today’s state. Check stock and launch dates before retiring a
                  dish. Sales do not establish profit or explain what caused a change.
                </p>
              </div>
            }
          >
            <Info size={18} aria-hidden />
            <span className="sr-only">About these figures</span>
          </Explain>
        }
      />
      <AnalyticsRange from={from} to={to} today={today} onChange={(next) => change(next)} />
      <AnalyticsControls
        grain={grain}
        grains={kind === 'items' ? ITEM_GRAINS : SALES_GRAINS}
        metric={kind === 'items' ? itemMetric : metric}
        metrics={kind === 'items' ? ITEM_METRICS : SALES_METRICS}
        periods={Math.floor(periods)}
        from={from}
        to={to}
        onChange={change}
      />
      {today && !valid && (
        <p role="alert" className="text-sm text-danger">
          Choose a valid range of 1–92 days.
        </p>
      )}
      {!!today && to >= today && <Chip tone="warn">Incomplete period</Chip>}
      {error ? (
        <Card>
          <p role="alert">Could not load analytics. Please try again.</p>
          <Button
            size="phone"
            className="mt-3"
            onClick={() => {
              setError(false)
              setLoaded(null)
              setRetry((n) => n + 1)
            }}
          >
            Retry
          </Button>
        </Card>
      ) : today && !valid ? null : !data ? (
        <AnalyticsLoading kind={kind} />
      ) : kind === 'items' ? (
        <ItemsPanel
          key={readKey}
          data={data}
          outletId={outletId!}
          from={from}
          to={to}
          grain={grain}
          metric={itemMetric}
          periods={Math.floor(periods)}
          subject={subject}
          onSubject={(next) =>
            change({
              dish: next.kind === 'item' ? next.key : '',
              category: next.kind === 'category' ? next.name : '',
            })
          }
        />
      ) : (
        <SalesPanel
          data={data}
          from={from}
          to={to}
          grain={grain}
          metric={metric}
          periods={Math.floor(periods)}
        />
      )}
    </div>
  )
}

function AnalyticsLoading({ kind }: { kind: 'items' | 'trends' }) {
  return (
    <LoadingRegion label="Loading analytics">
      {/* The trend card, then the lists or the hourly card beneath it. */}
      <Shimmer className="h-[24rem]" />
      <Shimmer className={`mt-3 ${kind === 'items' ? 'h-[32rem]' : 'h-72'}`} />
    </LoadingRegion>
  )
}
