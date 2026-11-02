import { useContext, useEffect, useState, type ReactNode } from 'react'
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
import { windowsFor } from '@/domain/revenue-figures'
import { useOutletScope } from '@/features/outlet-scope'
import { SessionContext } from '@/session/context'
import { AnalyticsRange } from './analytics-range'
import { ItemsPanel } from './items-panel'
import { AnalyticsControls } from './analytics-controls'
import { useChangeGate } from '@/change-gates/context'
import { OrderScopePill } from '@/features/billing/order-scope'
import { useRememberedScope } from '@/features/billing/order-scope-memory'
import { ITEM_GRAINS, ITEM_METRICS, SALES_GRAINS, SALES_METRICS } from './analytics-trend'
import { readRememberedRange, rememberRange, shortcutOf, shortcutRange } from './remembered-choices'
import { SalesPanel } from './sales-panel'
import { useAnalyticsClock } from './use-analytics-clock'

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
  // One Revenue (revenue-reads-the-same-everywhere, design D7) gives Sales the
  // Month shortcut, month-aligned windows, and comparisons cut at the time it is
  // now. Items keeps its range and read, and gains only the "vs" line (owner,
  // 2026-10-16: every comparison chart reads the same way).
  const isSales = kind === 'trends'
  const isItems = kind === 'items'
  const [cutover, setCutover] = useState<string | null>(null)
  const now = useAnalyticsClock(cutover)
  const today = cutover ? resolveBusinessDate(new Date(now), cutover) : null
  const ready = today !== null
  const clock = cutover ? { now, cutover } : undefined
  // With no dates in the address, the page opens on the shortcut last chosen
  // on it (each-analytics-page-remembers-its-range-and-view, design D2).
  const session = useContext(SessionContext)
  const page = kind === 'items' ? 'items' : 'sales'
  const remembered = readRememberedRange(session, page)
  const opening =
    !params.get('from') && today && remembered ? shortcutRange(remembered, today, isSales) : null
  const from = params.get('from') ?? (today ? (opening?.from ?? shiftDate(today, -6)) : '')
  const to = params.get('to') ?? today ?? ''
  const grain =
    params.get('grain') === 'week'
      ? 'week'
      : params.get('grain') === 'hour'
        ? 'hour'
        : params.get('grain')
          ? 'day'
          : (opening?.grain ?? 'day')
  /*
    Counter or Delivery, remembered per page (delivery-orders-are-made-not-billed,
    D7). Delivery orders carry no money, so in Delivery the measure is Orders on
    Sales and Items on Items, and the money measures say why they are unavailable.
  */
  const deliveryGate = useChangeGate('delivery-orders')
  const [scopeChosen, setScope] = useRememberedScope(isItems ? 'items' : 'sales')
  const scope = deliveryGate ? scopeChosen : 'counter'
  const delivery = scope === 'delivery'
  const metric = delivery
    ? 'orders'
    : params.get('metric') === 'orders'
      ? 'orders'
      : params.get('metric') === 'aov'
        ? 'aov'
        : 'revenue'
  const itemMetric = delivery ? 'units' : params.get('metric') === 'revenue' ? 'revenue' : 'units'
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
  const align =
    isSales && (params.get('align') === 'month' || (!params.get('align') && opening?.month))
      ? 'month'
      : 'equal'
  const cut = isSales && today !== null && to === today
  const itemsCut = isItems && today !== null && to === today
  const readKey = `${outletId}:${from}:${to}:${kind}:${readPeriods}${isSales ? `:${align}:${cut}` : `:cut:${itemsCut}`}${deliveryGate ? `:${scope}` : ''}`
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
          if (alive && o) setCutover(o.business_day_cutover)
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
    if (!outletId || !valid || !ready) return
    void analytics
      .read(outletId, from, to, {
        ...(isSales
          ? { view: 'sales' as const, periods: readPeriods, align, cut }
          : {
              view: 'items' as const,
              periods: readPeriods,
              align: 'equal' as const,
              cut: itemsCut,
            }),
        ...(deliveryGate ? { scope } : {}),
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `readKey` carries align and cut
  }, [analytics, outletId, from, to, valid, ready, retry, readKey, kind, readPeriods])
  function change(values: Record<string, string>) {
    if ('from' in values || 'to' in values) {
      setError(false)
      setRetry((n) => n + 1)
      // Only a range a shortcut produces is remembered; a hand-picked one is a one-off.
      const shortcut =
        today &&
        shortcutOf(
          values.from ?? from,
          values.to ?? to,
          today,
          isSales && ('align' in values ? values.align === 'month' : align === 'month'),
        )
      if (shortcut) rememberRange(session, page, shortcut)
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
                {delivery ? (
                  <p>
                    Delivery orders handed over at the counter, synced to the server. They carry no
                    money: what the platforms paid is in Revenue on the Counter view.
                  </p>
                ) : (
                  <p>
                    Settled counter bills synced to the server. Open and voided orders are excluded;
                    bills still on an offline tablet arrive after sync.
                  </p>
                )}
                {isSales && align === 'month' ? (
                  <p>
                    Month compares the same dates in earlier months, using the outlet’s Kolkata
                    business dates. Where the range ends today, earlier periods count up to the same
                    time of day.
                  </p>
                ) : (
                  <p>
                    Equal adjacent ranges, using the outlet’s Kolkata business dates. The previous
                    range is{' '}
                    {valid
                      ? `${shiftDate(from, -periodDays(from, to))} to ${shiftDate(from, -1)}`
                      : 'available after choosing dates'}
                    .{isSales && cut ? ' It counts up to the same time of day as now.' : ''}
                  </p>
                )}
                <p>
                  Dish revenue uses captured line prices and line discounts; it excludes bill-level
                  discounts, tax, rounding and packaging. Dish and category shares use all items
                  sold or all dish revenue in the selected range, following the measure. Search and
                  filters keep that same total; whole-percent rounding may not add to 100%.
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
      <AnalyticsRange
        from={from}
        to={to}
        today={today}
        onChange={(next) => change(next)}
        month={isSales ? { selected: align === 'month' } : null}
      />
      <AnalyticsControls
        {...(deliveryGate
          ? {
              scope: (
                <OrderScopePill
                  scope={scope}
                  onChange={setScope}
                  testId="analytics-scope"
                  compact
                />
              ),
            }
          : {})}
        {...(delivery
          ? {
              unavailable: {
                values: isItems ? ['revenue'] : ['revenue', 'aov'],
                reason: 'Delivery orders carry no money',
              },
            }
          : {})}
        grain={grain}
        grains={kind === 'items' ? ITEM_GRAINS : SALES_GRAINS}
        metric={kind === 'items' ? itemMetric : metric}
        metrics={kind === 'items' ? ITEM_METRICS : SALES_METRICS}
        periods={Math.floor(periods)}
        from={from}
        to={to}
        onChange={change}
        windowsOf={
          isSales && align === 'month' && today && valid
            ? (count) => windowsFor(from, to, count, 'month', today)
            : undefined
        }
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
          clock={clock}
          grain={grain}
          metric={itemMetric}
          {...(delivery ? { scope: 'delivery' as const } : {})}
          periods={Math.floor(periods)}
          subject={subject}
          windows={
            isItems && today && valid
              ? windowsFor(from, to, Math.floor(periods), 'equal', today)
              : undefined
          }
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
          clock={clock}
          grain={grain}
          metric={metric}
          periods={Math.floor(periods)}
          windows={
            isSales && today && valid
              ? windowsFor(from, to, Math.floor(periods), align, today)
              : undefined
          }
        />
      )}
    </div>
  )
}

function AnalyticsLoading({ kind }: { kind: 'items' | 'trends' }) {
  return (
    <LoadingRegion label="Loading analytics">
      {/* Trend, fixed-height Dishes, then Categories with a share line per row. */}
      <Shimmer className="h-[24rem]" />
      <Shimmer className={`mt-3 ${kind === 'items' ? 'h-[32rem]' : 'h-72'}`} />
      {kind === 'items' && (
        <div className="mt-3 space-y-3 rounded-xl border border-border bg-surface p-4">
          <Shimmer className="h-6 w-32" />
          {Array.from({ length: 6 }, (_, index) => (
            <Shimmer key={index} className="h-20" />
          ))}
        </div>
      )}
    </LoadingRegion>
  )
}
