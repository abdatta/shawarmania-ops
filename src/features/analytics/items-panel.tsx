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
  AnalyticsCategory,
  AnalyticsItem,
  AnalyticsSeries,
  AnalyticsSnapshot,
  AnalyticsSubject,
} from '@/domain/sales-analytics-types'
import { periodDays, periodDirection, periodUnit, totalDays } from '@/domain/sales-analytics'
import { ChangeChip, MiniBar, PeriodBars, TrendChip } from './analytics-widgets'
import { download } from './analytics-utils'
import { AnalyticsScrollList } from './analytics-scroll-list'
import { metricText } from './analytics-chart'
import {
  trendView,
  type TrendClock,
  HOURS,
  hourTrend,
  periodTrend,
  seriesDays,
} from './analytics-trend'
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
  clock,
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
  clock?: TrendClock | undefined
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
  // Against two or three earlier periods a row shows where it is heading, and
  // Rising and Slow mean that direction rather than beating the last period.
  const trend = periods >= 3
  const unit = periodUnit(periodDays(from, to))
  const oldestFirst = (values: number[]) => [...values].slice(0, periods).reverse()
  // The lists follow the page's measure, as everything on Sales does: with
  // Revenue chosen they show, rank, compare and filter on dish revenue.
  const byRevenue = metric === 'revenue'
  const value = (row: AnalyticsItem | AnalyticsCategory) => (byRevenue ? row.revenue : row.units)
  const previousValue = (row: AnalyticsItem | AnalyticsCategory) =>
    byRevenue ? row.previousRevenue : row.previousUnits
  const periodValues = (row: AnalyticsItem | AnalyticsCategory) =>
    byRevenue ? row.periodRevenue : row.periodUnits
  const shown = (n: number) => metricText(n, metric)
  const barsLabel = byRevenue ? 'Dish revenue by period' : 'Items by period'
  const total = data.items.reduce((sum, row) => sum + value(row), 0)
  const share = (row: AnalyticsItem | AnalyticsCategory) =>
    total ? `${Math.round((value(row) / total) * 100)}% of ${byRevenue ? 'revenue' : 'items'}` : '—'
  const direction = new Map(
    data.items.map((i) => [i.key, periodDirection(oldestFirst(periodValues(i)))]),
  )
  const growth = (i: AnalyticsItem) =>
    trend ? (direction.get(i.key)!.rate ?? 0) : value(i) / previousValue(i)
  const ranked = [...data.items].sort((a, b) => value(b) - value(a) || a.name.localeCompare(b.name))
  const max = Math.max(1, ...data.items.map(value))
  const items = ranked.filter(
    (i) =>
      i.name.toLowerCase().includes(search.toLowerCase()) &&
      (view === 'all' || i.active) &&
      (view !== 'rising' ||
        (trend
          ? direction.get(i.key)!.direction === 'up'
          : previousValue(i) > 0 && value(i) > previousValue(i))) &&
      (view !== 'slow' ||
        (trend
          ? direction.get(i.key)!.direction === 'down'
          : previousValue(i) > 0 && value(i) < previousValue(i))),
  )
  if (view === 'worst') items.sort((a, b) => value(a) - value(b) || a.name.localeCompare(b.name))
  if (view === 'rising' || view === 'slow')
    items.sort(
      (a, b) =>
        (view === 'rising' ? -1 : 1) * (growth(a) - growth(b)) || a.name.localeCompare(b.name),
    )
  const change = (current: number, previous: number, values: number[], label: string) =>
    trend ? (
      <span className="inline-flex items-center gap-1.5">
        <PeriodBars values={oldestFirst(values)} label={label} format={shown} />
        <TrendChip values={oldestFirst(values)} unit={unit} />
      </span>
    ) : (
      <ChangeChip current={current} previous={previous} />
    )
  const categories = [...data.categories].sort(
    (a, b) => value(b) - value(a) || a.name.localeCompare(b.name),
  )
  const categoryMax = Math.max(1, ...categories.map(value))
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
          clock={clock}
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
                {byRevenue ? 'Dish revenue (line totals less line discounts)' : 'Items sold'} from
                synced, settled counter bills. Shares use all{' '}
                {byRevenue ? 'dish revenue' : 'items sold'} in this outlet and range, including
                captured retired sales. Search, filters and the chart subject do not change the
                total. Against one earlier period each dish shows its change; against two or three,
                a bar per period (oldest left, each from zero) and the direction they are heading,
                per period, or steady when the movement is within the periods' usual wobble. All is
                ordered most sold first; Worst is least sold first, including zero sellers. Rising
                and Slow show active dishes heading up or down, fastest first. Tap a dish to chart
                it. Zero sales do not prove a dish was stocked throughout; check stock, launch dates
                and another comparable period before removal.
              </p>
            }
          >
            <span data-testid="items-total" data-value={total}>
              {shown(total)} {byRevenue ? 'dish revenue' : 'items sold'}
            </span>
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
                data-value={value(i)}
                data-previous-value={previousValue(i)}
                aria-pressed={chosen === `item:${i.key}`}
                aria-label={`Chart ${i.name}`}
                onClick={() => chart({ kind: 'item', key: i.key })}
                className={`w-full rounded-lg px-2 py-3 text-left transition-colors hover:bg-surface-raised ${chosen === `item:${i.key}` ? 'bg-surface-raised ring-1 ring-primary' : ''}`}
              >
                <span className="flex items-start justify-between gap-3">
                  <span className="min-w-0 break-words text-sm font-semibold">{i.name}</span>
                  <span className="shrink-0 text-base font-bold tabular-nums">
                    {shown(value(i))}
                  </span>
                </span>
                <span className="my-2 block">
                  <MiniBar value={value(i)} max={max} />
                </span>
                <span className="flex flex-wrap items-center gap-1">
                  {change(value(i), previousValue(i), periodValues(i), barsLabel)}
                  {!i.active ? (
                    <Chip>Retired</Chip>
                  ) : !i.available ? (
                    <Chip>Unavailable</Chip>
                  ) : i.highlighted ? (
                    <Chip icon={Flame}>Highlighted</Chip>
                  ) : null}
                  <span data-testid="dish-share" className="ml-auto text-xs text-content-muted">
                    {share(i)}
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
                {byRevenue ? 'Dish revenue' : 'Items sold'}, grouped by the category captured on the
                bill, against the previous equal period. Older bills without a category snapshot are
                Uncategorised; today’s category is not used to rewrite history. Tap a category to
                chart it. Shares use the same full outlet and range total as Dishes.
              </p>
            }
          >
            {byRevenue ? 'Revenue' : 'Items'} · captured
          </Explain>
        </div>
        {/*
         * One grid shared by every row (each row a subgrid): the chip and the
         * number columns take the widest one shown, so the period bars stand
         * in one vertical line whatever each row's figures are.
         */}
        <ul
          className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-x-2"
          aria-label="Category rankings"
        >
          {categories.map((c) => (
            <li
              key={c.name}
              className="col-span-full grid grid-cols-subgrid border-t border-border first:border-t-0"
            >
              <button
                type="button"
                data-testid="category-row"
                data-value={value(c)}
                aria-pressed={chosen === `category:${c.name}`}
                aria-label={`Chart ${c.name}`}
                onClick={() => chart({ kind: 'category', name: c.name })}
                className={`col-span-full grid grid-cols-subgrid items-center gap-y-1.5 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-surface-raised ${chosen === `category:${c.name}` ? 'bg-surface-raised ring-1 ring-primary' : ''}`}
              >
                <span className="min-w-0 break-words text-sm font-medium">{c.name}</span>
                <span className="justify-self-end">
                  {trend ? (
                    <TrendChip values={oldestFirst(periodValues(c))} unit={unit} />
                  ) : (
                    <ChangeChip current={value(c)} previous={previousValue(c)} />
                  )}
                </span>
                <span className="flex">
                  {trend && (
                    <PeriodBars
                      values={oldestFirst(periodValues(c))}
                      label={barsLabel}
                      format={shown}
                    />
                  )}
                </span>
                <span
                  className="text-right text-sm font-bold tabular-nums"
                  data-testid="category-units"
                >
                  {shown(value(c))}
                </span>
                <span className="col-span-full">
                  <MiniBar value={value(c)} max={categoryMax} />
                </span>
                <span
                  data-testid="category-share"
                  className="col-span-full text-right text-xs text-content-muted"
                >
                  {share(c)}
                </span>
              </button>
            </li>
          ))}
          {!categories.length && (
            <li className="col-span-full py-3 text-sm text-content-muted">No sales to chart.</li>
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
                [
                  'Dish',
                  'Category',
                  'Items',
                  'Previous items',
                  'Line revenue (paise)',
                  byRevenue ? 'Share of revenue' : 'Share of items',
                ],
                ...items.map((i) => [
                  i.name,
                  i.category,
                  i.units,
                  i.previousUnits,
                  i.revenue,
                  share(i),
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
                  {[
                    'Dish',
                    'Items',
                    'Previous items',
                    'Dish revenue',
                    byRevenue ? 'Share of revenue' : 'Share of items',
                  ].map((h) => (
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
                    <td className="whitespace-nowrap p-2">{share(i)}</td>
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
  clock,
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
  clock?: TrendClock | undefined
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
  const picker = (
    <SubjectPicker
      data={data}
      name={name}
      metric={metric}
      subject={subject}
      onSubject={onSubject}
    />
  )
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
    cutover: clock?.cutover,
  })
  const hours = metric === 'units' ? series.hourUnits : series.hourRevenue
  const hourly = grain === 'hour'
  // The trading part of the day across every compared period.
  const view = trendView(
    hourly
      ? hourTrend(trend.periods, (period, hour) => hours[period * 24 + hour] ?? 0, clock?.cutover)
      : trend.series,
    hourly ? HOURS : trend.axis,
    from,
    to,
    grain,
    clock,
  )
  const totals = trend.periods.map((p) => (metric === 'units' ? p.total.units : p.total.revenue))
  return (
    <TrendCard
      id="items-trend"
      title={metric === 'units' ? 'Items sold' : 'Dish revenue'}
      metric={metric}
      totals={totals}
      days={periodDays(from, to)}
      caption={
        hourly
          ? 'Counter bills by Kolkata order hour, totals across the range'
          : metric === 'units'
            ? 'Counter bills · delivery has no dish detail'
            : 'Line totals less line discounts · counter only'
      }
      subject={picker}
      series={view.series}
      axis={view.axis}
      rowHeader={hourly ? 'Hour' : grain === 'day' ? 'Day' : 'Week'}
      newestFirst={!hourly}
      exportName={`item-trend-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
      exportUnit={metric === 'units' ? 'items' : 'dish revenue (paise)'}
    />
  )
}

function SubjectPicker({
  data,
  name,
  metric,
  subject,
  onSubject,
}: {
  data: AnalyticsSnapshot
  name: string
  metric: ItemMetric
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
  const value = (row: AnalyticsItem | AnalyticsCategory) =>
    metric === 'revenue' ? row.revenue : row.units
  const categories = [...data.categories]
    .sort((a, b) => value(b) - value(a) || a.name.localeCompare(b.name))
    .filter((c) => match(c.name))
  const dishes = [...data.items]
    .sort((a, b) => value(b) - value(a) || a.name.localeCompare(b.name))
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
                option(c.name, { kind: 'category', name: c.name }, metricText(value(c), metric)),
              )}
            </section>
          )}
          {!!dishes.length && (
            <section aria-label="Dishes">
              <p className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-content-muted">
                Dishes
              </p>
              {dishes.map((i) =>
                option(i.name, { kind: 'item', key: i.key }, metricText(value(i), metric)),
              )}
            </section>
          )}
        </div>
      </FormSheet>
    </>
  )
}
