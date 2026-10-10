import { useEffect, useRef, useState } from 'react'
import { ArrowDownWideNarrow, ChevronDown, Flame, Search } from 'lucide-react'
import { FormSheet } from '@/components/layout/form-sheet'
import { Button } from '@/components/ui/button'
import { Card, CardTitle } from '@/components/ui/card'
import { Chip } from '@/components/ui/chip'
import { Input } from '@/components/ui/input'
import { LoadingRegion, Shimmer } from '@/components/ui/loading'
import { Money } from '@/components/ui/money'
import { Explain } from '@/components/ui/why'
import { useAdapters } from '@/data-access'
import type {
  AnalyticsSeries,
  AnalyticsSnapshot,
  AnalyticsSubject,
} from '@/domain/sales-analytics-types'
import { totalDays } from '@/domain/sales-analytics'
import { ChangeChip, MiniBar } from './analytics-widgets'
import { download } from './analytics-utils'
import { AnalyticsScrollList } from './analytics-scroll-list'
import { metricText } from './analytics-chart'
import { HOURS, hourTrend, periodTrend, seriesDays } from './analytics-trend'
import { TrendCard } from './analytics-trend-card'

type ItemMetric = 'units' | 'revenue'

function subjectKey(subject: AnalyticsSubject) {
  return subject.kind === 'item'
    ? `item:${subject.key}`
    : subject.kind === 'category'
      ? `category:${subject.name}`
      : 'all'
}

export function ItemsPanel({
  data,
  outletId,
  from,
  to,
  grain,
  metric,
  periods,
  subject,
  onSubject,
}: {
  data: AnalyticsSnapshot
  outletId: string
  from: string
  to: string
  grain: 'hour' | 'day' | 'week'
  metric: ItemMetric
  periods: number
  subject: AnalyticsSubject
  onSubject: (subject: AnalyticsSubject) => void
}) {
  const [search, setSearch] = useState('')
  const [view, setView] = useState('all')
  const trendRef = useRef<HTMLDivElement>(null)
  const orders = totalDays(data.days.filter((d) => d.date >= from)).orders
  const byUnits = [...data.items].sort((a, b) => b.units - a.units || a.name.localeCompare(b.name))
  const max = Math.max(1, ...data.items.map((i) => i.units))
  const items = byUnits.filter(
    (i) =>
      i.name.toLowerCase().includes(search.toLowerCase()) &&
      (view === 'all' || i.active) &&
      (view !== 'rising' || (i.previousUnits > 0 && i.units > i.previousUnits)) &&
      (view !== 'slow' || (i.previousUnits > 0 && i.units < i.previousUnits)),
  )
  if (view === 'worst') items.sort((a, b) => a.units - b.units || a.name.localeCompare(b.name))
  if (view === 'rising' || view === 'slow')
    items.sort(
      (a, b) =>
        (view === 'rising' ? -1 : 1) * (a.units / a.previousUnits - b.units / b.previousUnits) ||
        a.name.localeCompare(b.name),
    )
  const categories = [...data.categories].sort(
    (a, b) => b.units - a.units || a.name.localeCompare(b.name),
  )
  const categoryMax = Math.max(1, ...categories.map((c) => c.units))
  const chosen = subjectKey(subject)
  const chart = (next: AnalyticsSubject) => {
    onSubject(next)
    trendRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  return (
    <>
      <div ref={trendRef} className="scroll-mt-20">
        <ItemTrend
          data={data}
          outletId={outletId}
          from={from}
          to={to}
          grain={grain}
          metric={metric}
          periods={periods}
          subject={subject}
          onSubject={onSubject}
        />
      </div>
      {!orders && (
        <Card className="py-3">
          <CardTitle>No settled sales in this period</CardTitle>
          <p className="mt-1 text-sm text-content-muted">Try another range.</p>
        </Card>
      )}
      <Card>
        <div className="mb-3 flex items-center justify-between gap-2">
          <CardTitle>Dishes</CardTitle>
          <Explain
            label="Ranking context"
            className="min-h-11 text-xs text-content-muted"
            explanation={
              <p>
                Units sold in {orders} synced, settled counter orders, against the previous equal
                period. All is ordered most sold first; Worst is least sold first, including zero
                sellers. Rising and Slow show active dishes with growth or decline against a nonzero
                prior period, ordered by percentage change. Tap a dish to chart it. Zero sales do
                not prove a dish was stocked throughout; check stock, launch dates and another
                comparable period before removal.
              </p>
            }
          >
            {orders} counter orders
          </Explain>
        </div>
        <div className="relative mb-2">
          <Search
            size={16}
            aria-hidden
            className="pointer-events-none absolute left-3 top-3.5 text-content-muted"
          />
          <Input
            aria-label="Search dishes"
            placeholder="Find a dish"
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="mb-3 grid grid-cols-4 gap-1" role="group" aria-label="Dish filters">
          {[
            ['all', 'All'],
            ['worst', 'Worst'],
            ['rising', 'Rising'],
            ['slow', 'Slow'],
          ].map(([value, label]) => (
            <Button
              key={value}
              size="phone"
              variant="ghost"
              className={`px-1 text-xs ${view === value ? 'bg-surface-raised text-accent-text' : 'text-content-muted'}`}
              aria-pressed={view === value}
              onClick={() => setView(value!)}
            >
              {label}
            </Button>
          ))}
        </div>
        <AnalyticsScrollList
          key={`${view}:${search}`}
          rows={items}
          label="Dish rankings"
          render={(i) => (
            <li key={i.key}>
              <button
                type="button"
                data-testid="dish-row"
                data-units={i.units}
                data-previous-units={i.previousUnits}
                aria-pressed={chosen === `item:${i.key}`}
                aria-label={`Chart ${i.name}`}
                onClick={() => chart({ kind: 'item', key: i.key })}
                className={`w-full rounded-lg px-2 py-3 text-left transition-colors hover:bg-surface-raised ${chosen === `item:${i.key}` ? 'bg-surface-raised ring-1 ring-primary' : ''}`}
              >
                <span className="flex items-start justify-between gap-3">
                  <span className="min-w-0 break-words text-sm font-semibold">{i.name}</span>
                  <span className="shrink-0 text-base font-bold tabular-nums">{i.units}</span>
                </span>
                <span className="my-2 block">
                  <MiniBar value={i.units} max={max} />
                </span>
                <span className="flex flex-wrap items-center gap-1">
                  <ChangeChip current={i.units} previous={i.previousUnits} />
                  {!i.active ? (
                    <Chip>Retired</Chip>
                  ) : !i.available ? (
                    <Chip>Unavailable</Chip>
                  ) : i.highlighted ? (
                    <Chip icon={Flame}>Highlighted</Chip>
                  ) : null}
                  <span className="ml-auto text-xs text-content-muted">
                    {orders ? `${Math.round((i.orders / orders) * 100)}% of orders` : '—'}
                  </span>
                </span>
              </button>
            </li>
          )}
        />
      </Card>
      <Card>
        <div className="mb-3 flex items-center justify-between gap-2">
          <CardTitle>Categories</CardTitle>
          <Explain
            label="Category snapshots"
            className="min-h-11 text-xs text-content-muted"
            explanation={
              <p>
                Units sold, grouped by the category captured on the bill, against the previous equal
                period. Older bills without a category snapshot are Uncategorised; today’s category
                is not used to rewrite history. Tap a category to chart it.
              </p>
            }
          >
            Units · captured
          </Explain>
        </div>
        <ul className="divide-y divide-border" aria-label="Category rankings">
          {categories.map((c) => (
            <li key={c.name}>
              <button
                type="button"
                data-testid="category-row"
                aria-pressed={chosen === `category:${c.name}`}
                aria-label={`Chart ${c.name}`}
                onClick={() => chart({ kind: 'category', name: c.name })}
                className={`w-full rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-surface-raised ${chosen === `category:${c.name}` ? 'bg-surface-raised ring-1 ring-primary' : ''}`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="min-w-0 break-words text-sm font-medium">{c.name}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    <ChangeChip current={c.units} previous={c.previousUnits} />
                    <span className="w-10 text-right text-sm font-bold tabular-nums">
                      {c.units}
                    </span>
                  </span>
                </span>
                <span className="mt-1.5 block">
                  <MiniBar value={c.units} max={categoryMax} />
                </span>
              </button>
            </li>
          ))}
          {!categories.length && (
            <li className="py-3 text-sm text-content-muted">No sales to chart.</li>
          )}
        </ul>
      </Card>
      <details className="rounded-xl border border-border bg-surface px-4">
        <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-semibold">
          <ArrowDownWideNarrow size={16} aria-hidden />
          Detailed figures & export
        </summary>
        <div className="space-y-3 pb-4">
          <Button
            size="phone"
            variant="secondary"
            onClick={() =>
              download('item-performance', [
                ['Dish', 'Category', 'Units', 'Previous units', 'Line revenue (paise)', 'Orders'],
                ...items.map((i) => [
                  i.name,
                  i.category,
                  i.units,
                  i.previousUnits,
                  i.revenue,
                  i.orders,
                ]),
              ])
            }
          >
            Export CSV
          </Button>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr>
                  {['Dish', 'Units', 'Previous', 'Dish revenue'].map((h) => (
                    <th key={h} scope="col" className="p-2">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.key} className="border-t border-border">
                    <th scope="row" className="min-w-40 p-2 font-medium">
                      {i.name}
                    </th>
                    <td className="p-2">{i.units}</td>
                    <td className="p-2">{i.previousUnits}</td>
                    <td className="whitespace-nowrap p-2">
                      <Money paise={i.revenue} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </details>
    </>
  )
}

/**
 * The chart of one subject over the chosen windows. Its series is read only for
 * the subject on screen, and kept for the life of the page so switching back to
 * a dish already charted costs no request.
 */
function ItemTrend({
  data,
  outletId,
  from,
  to,
  grain,
  metric,
  periods,
  subject,
  onSubject,
}: {
  data: AnalyticsSnapshot
  outletId: string
  from: string
  to: string
  grain: 'hour' | 'day' | 'week'
  metric: ItemMetric
  periods: number
  subject: AnalyticsSubject
  onSubject: (subject: AnalyticsSubject) => void
}) {
  const { analytics } = useAdapters()
  const [cache, setCache] = useState(() => new Map<string, AnalyticsSeries>())
  const key = `${outletId}:${from}:${to}:${periods}:${subjectKey(subject)}`
  const [failed, setFailed] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const series = cache.get(key) ?? null
  const cached = cache.has(key)
  useEffect(() => {
    if (cached) return
    let alive = true
    analytics
      .series(outletId, from, to, periods, subject)
      .then((next) => {
        if (alive) setCache((previous) => new Map(previous).set(key, next))
      })
      .catch(() => {
        if (alive) setFailed(key)
      })
    return () => {
      alive = false
    }
    // `subject` is captured by `key`; the object itself changes identity per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analytics, key, cached, retry])
  const name =
    subject.kind === 'item'
      ? (data.items.find((i) => i.key === subject.key)?.name ?? 'Dish')
      : subject.kind === 'category'
        ? subject.name
        : 'All dishes'
  const picker = <SubjectPicker data={data} name={name} subject={subject} onSubject={onSubject} />
  if (failed === key && !series)
    return (
      <Card>
        {picker}
        <p role="alert" className="mt-2">
          Could not load this chart. Please try again.
        </p>
        <Button
          size="phone"
          className="mt-3"
          onClick={() => {
            setFailed(null)
            setRetry((n) => n + 1)
          }}
        >
          Retry
        </Button>
      </Card>
    )
  if (!series)
    return (
      <Card>
        {picker}
        <LoadingRegion label="Loading the chart">
          <Shimmer className="mt-2 h-10 w-40" />
          <Shimmer className="mt-3 h-52" />
        </LoadingRegion>
      </Card>
    )
  const trend = periodTrend({
    days: seriesDays(series),
    from,
    to,
    periods,
    grain: grain === 'hour' ? 'day' : grain,
    value: (b) => (metric === 'units' ? b.units : b.revenue),
  })
  const hours = metric === 'units' ? series.hourUnits : series.hourRevenue
  const hourly = grain === 'hour'
  const [current, previous] = trend.periods.map((p) =>
    metric === 'units' ? p.total.units : p.total.revenue,
  )
  return (
    <TrendCard
      id="items-trend"
      title={metric === 'units' ? 'Units sold' : 'Dish revenue'}
      metric={metric}
      value={current ?? null}
      previous={previous}
      caption={
        hourly
          ? 'Counter bills by Kolkata order hour, totals across the range'
          : metric === 'units'
            ? 'Counter bills · delivery has no dish detail'
            : 'Line totals less line discounts · counter only'
      }
      subject={picker}
      series={
        hourly
          ? hourTrend(trend.periods, (period, hour) => hours[period * 24 + hour] ?? 0)
          : trend.series
      }
      axis={hourly ? HOURS : trend.axis}
      rowHeader={hourly ? 'Hour' : grain === 'day' ? 'Day' : 'Week'}
      newestFirst={!hourly}
      exportName={`item-trend-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
      exportUnit={metric === 'units' ? 'units' : 'dish revenue (paise)'}
    />
  )
}

function SubjectPicker({
  data,
  name,
  subject,
  onSubject,
}: {
  data: AnalyticsSnapshot
  name: string
  subject: AnalyticsSubject
  onSubject: (subject: AnalyticsSubject) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const match = (text: string) => text.toLowerCase().includes(search.toLowerCase())
  const choose = (next: AnalyticsSubject) => {
    onSubject(next)
    setOpen(false)
  }
  const option = (label: string, next: AnalyticsSubject, detail?: string) => (
    <button
      key={subjectKey(next)}
      type="button"
      aria-pressed={subjectKey(next) === subjectKey(subject)}
      onClick={() => choose(next)}
      className={`flex min-h-12 w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-surface-raised ${subjectKey(next) === subjectKey(subject) ? 'bg-surface-raised text-accent-text' : ''}`}
    >
      <span className="min-w-0 flex-1 break-words text-sm font-medium">{label}</span>
      {detail && <span className="shrink-0 text-xs tabular-nums text-content-muted">{detail}</span>}
    </button>
  )
  const categories = data.categories.filter((c) => match(c.name))
  const dishes = [...data.items]
    .sort((a, b) => b.units - a.units || a.name.localeCompare(b.name))
    .filter((i) => match(i.name))
  return (
    <>
      <Button
        size="phone"
        variant="ghost"
        className="-ml-2 mb-1 max-w-full justify-start gap-1 px-2 text-sm font-semibold text-accent-text"
        aria-label={`Charting ${name}. Choose what to chart`}
        aria-haspopup="dialog"
        onClick={() => {
          setSearch('')
          setOpen(true)
        }}
      >
        <span className="truncate">{name}</span>
        <ChevronDown size={16} aria-hidden className="shrink-0" />
      </Button>
      <FormSheet open={open} onClose={() => setOpen(false)} title="Chart">
        <Input
          aria-label="Find a dish or category"
          placeholder="Find a dish or category"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="mt-3 space-y-3">
          {match('All dishes') && option('All dishes', { kind: 'all' })}
          {!!categories.length && (
            <section aria-label="Categories">
              <p className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-content-muted">
                Categories
              </p>
              {categories.map((c) =>
                option(c.name, { kind: 'category', name: c.name }, metricText(c.units, 'units')),
              )}
            </section>
          )}
          {!!dishes.length && (
            <section aria-label="Dishes">
              <p className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-content-muted">
                Dishes
              </p>
              {dishes.map((i) =>
                option(i.name, { kind: 'item', key: i.key }, metricText(i.units, 'units')),
              )}
            </section>
          )}
        </div>
      </FormSheet>
    </>
  )
}
