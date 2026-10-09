import { useState } from 'react'
import { ChevronDown, GitCompareArrows } from 'lucide-react'
import { FormSheet } from '@/components/layout/form-sheet'
import { Button } from '@/components/ui/button'
import { Card, CardTitle } from '@/components/ui/card'
import { Chip } from '@/components/ui/chip'
import { Explain } from '@/components/ui/why'
import type { AnalyticsSnapshot } from '@/domain/sales-analytics-types'
import {
  analyticsRevenueDays,
  bucketDays,
  periodDays,
  salesValue,
  shiftDate,
  totalDays,
  validAnalyticsDate,
  type SalesMetric,
} from '@/domain/sales-analytics'
import { ChangeChip, MiniBar } from './analytics-widgets'
import { AnalyticsChart, metricText, rangeLabel, type ChartSeries } from './analytics-chart'
import { download } from './analytics-utils'
import { AnalyticsScrollList } from './analytics-scroll-list'
const labels = { revenue: 'Revenue', orders: 'Orders', aov: 'AOV' }
export function SalesControls({
  grain,
  metric,
  periods,
  from,
  to,
  onChange,
}: {
  grain: 'hour' | 'day' | 'week'
  metric: SalesMetric
  periods: number
  from: string
  to: string
  onChange: (values: Record<string, string>) => void
}) {
  return (
    <div className="flex gap-2">
      <Choice
        label="Group by"
        value={grain}
        options={[
          ['hour', 'Hour'],
          ['day', 'Day'],
          ['week', 'Week'],
        ]}
        onChange={(value) => onChange({ grain: value })}
      />
      <Choice
        label="Measure"
        value={metric}
        options={[
          ['revenue', 'Revenue'],
          ['orders', 'Orders'],
          ['aov', 'AOV'],
        ]}
        onChange={(value) => onChange({ metric: value })}
      />
      <PeriodComparison
        periods={periods}
        from={from}
        to={to}
        onChange={(value) => onChange({ periods: String(value) })}
      />
    </div>
  )
}
function PeriodComparison({
  periods,
  from,
  to,
  onChange,
}: {
  periods: number
  from: string
  to: string
  onChange: (value: number) => void
}) {
  const [open, setOpen] = useState(false)
  const valid = validAnalyticsDate(from) && validAnalyticsDate(to) && to >= from
  const span = valid ? periodDays(from, to) : 0
  return (
    <>
      <Button
        size="phone"
        variant="ghost"
        className="shrink-0 rounded-full px-1"
        aria-label={`Compare periods: ${periods === 1 ? 'off' : `${periods} periods`}`}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <span className="flex h-8 items-center gap-1.5 rounded-full border border-border bg-surface-raised px-2.5 text-xs">
          <GitCompareArrows size={14} aria-hidden />
          Compare
          <span className="font-bold tabular-nums text-accent-text">
            {periods === 1 ? 'Off' : periods}
          </span>
        </span>
      </Button>
      <FormSheet open={open} onClose={() => setOpen(false)} title="Compare periods">
        <p className="mb-3 text-xs text-content-muted">Current range + earlier equal ranges</p>
        <div className="grid gap-2">
          {[1, 2, 3, 4].map((count) => (
            <Button
              key={count}
              variant={count === periods ? 'primary' : 'secondary'}
              className="h-auto min-h-11 flex-col items-start gap-1 py-3 text-left"
              aria-label={count === 1 ? 'Current only' : `${count} periods`}
              aria-pressed={count === periods}
              onClick={() => {
                onChange(count)
                setOpen(false)
              }}
            >
              <span>{count === 1 ? 'Current only' : `${count} periods`}</span>
              {valid && (
                <span className="text-xs font-normal">
                  {Array.from({ length: count }, (_, period) =>
                    rangeLabel(shiftDate(from, -period * span), shiftDate(to, -period * span)),
                  ).join(' · ')}
                </span>
              )}
            </Button>
          ))}
        </div>
      </FormSheet>
    </>
  )
}
function Choice({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: [string, string][]
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button
        size="phone"
        variant="secondary"
        className="min-w-0 flex-1 justify-between px-2"
        aria-label={`${label}: ${options.find(([key]) => key === value)?.[1]}`}
        onClick={() => setOpen(true)}
      >
        <span className="min-w-0 text-xs">{options.find(([key]) => key === value)?.[1]}</span>
        <ChevronDown size={14} aria-hidden />
      </Button>
      <FormSheet open={open} onClose={() => setOpen(false)} title={label}>
        <div className="grid gap-2">
          {options.map(([key, text]) => (
            <Button
              key={key}
              variant={key === value ? 'primary' : 'secondary'}
              aria-pressed={key === value}
              onClick={() => {
                onChange(key)
                setOpen(false)
              }}
            >
              {text}
            </Button>
          ))}
        </div>
      </FormSheet>
    </>
  )
}
export function SalesPanel({
  data,
  from,
  to,
  grain,
  metric,
  periods,
}: {
  data: AnalyticsSnapshot
  from: string
  to: string
  grain: 'hour' | 'day' | 'week'
  metric: SalesMetric
  periods: number
}) {
  const span = periodDays(from, to)
  const current = data.days.filter((d) => d.date >= from && d.date <= to)
  const dateGrain = grain === 'hour' ? 'day' : grain
  const baseBuckets = bucketDays(current, dateGrain)
  const recorded = analyticsRevenueDays(data, true)
  const allPeriods = Array.from({ length: periods }, (_, period) => {
    const first = shiftDate(from, -period * span),
      last = shiftDate(to, -period * span)
    const days = (metric === 'revenue' ? recorded : data.days).filter(
      (d) => d.date >= first && d.date <= last,
    )
    const buckets = bucketDays(
      days.map((d) => ({ ...d, date: shiftDate(d.date, period * span) })),
      dateGrain,
    )
    const total = totalDays(days)
    return {
      first,
      last,
      days,
      buckets,
      label: rangeLabel(first, last),
      value: salesValue(total.revenue, total.orders, metric),
    }
  })
  const bucketRange = (date: string) => {
    const rows = current.filter((d) => bucketDays([d], dateGrain)[0]?.date === date)
    return [rows[0]!.date, rows.at(-1)!.date] as const
  }
  const dateTrend: ChartSeries[] = allPeriods.map((p, period) => ({
    label: p.label,
    points: baseBuckets.map((b) => {
      const value = p.buckets.find((d) => d.date === b.date)
      const [first, last] = bucketRange(b.date)
      return {
        label: rangeLabel(shiftDate(first, -period * span), shiftDate(last, -period * span)),
        value: salesValue(value?.revenue ?? 0, value?.orders ?? 0, metric),
      }
    }),
  }))
  const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const weekdaySeries: ChartSeries[] = allPeriods.map((p) => ({
    label: p.label,
    points: weekdays.map((label, index) => {
      const days = p.days.filter(
        (d) => (new Date(`${d.date}T12:00:00Z`).getUTCDay() + 6) % 7 === index,
      )
      const sum = totalDays(days)
      const value =
        metric === 'aov'
          ? salesValue(sum.revenue, sum.orders, metric)
          : days.length
            ? (metric === 'orders' ? sum.orders : sum.revenue) / days.length
            : null
      return { label: `${p.label} · ${label}`, value }
    }),
  }))
  const hours = Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, '0')}:00`)
  const hourSeries: ChartSeries[] = allPeriods.map((p, period) => ({
    label: p.label,
    points: hours.map((label, hour) => {
      const row = data.hours.find((h) => h.period === period && h.hour === hour)
      return {
        label: `${p.label} · ${label}`,
        value: salesValue(row?.revenue ?? 0, row?.orders ?? 0, metric),
      }
    }),
  }))
  const hourlyAverages: ChartSeries[] = hourSeries.map((series) => ({
    ...series,
    points: series.points.map((point) => ({
      ...point,
      value: metric === 'aov' || point.value === null ? point.value : point.value / span,
    })),
  }))
  // Focus the pattern on trading hours across every comparison, preserving gaps.
  const tradingHours = data.hours
    .filter((h) => h.period < periods && h.orders > 0)
    .map((h) => h.hour)
  const firstHour = tradingHours.length ? Math.max(0, Math.min(...tradingHours) - 1) : 0
  const lastHour = tradingHours.length ? Math.min(23, Math.max(...tradingHours) + 1) : 23
  const hourlyAxis = hours.slice(firstHour, lastHour + 1)
  const hourlyPattern = hourlyAverages.map((series) => ({
    ...series,
    points: series.points.slice(firstHour, lastHour + 1),
  }))
  const weekdayTitle =
    metric === 'aov' ? 'Average bill by weekday' : `Daily average ${labels[metric].toLowerCase()}`
  const hourlyTitle =
    metric === 'aov' ? 'Average bill by hour' : `Hourly average ${labels[metric].toLowerCase()}`
  const trend = grain === 'hour' ? hourSeries : dateTrend
  const rowLabels =
    grain === 'hour' ? hours : baseBuckets.map((b) => rangeLabel(...bucketRange(b.date)))
  const selected = allPeriods[0]!,
    previous = allPeriods[1]
  const max = Math.max(1, ...trend[0]!.points.map((p) => p.value ?? 0))
  const provisional = data.delivery.filter(
    (d) => d.date >= from && d.date <= to && d.provisional,
  ).length
  const rowValue = (period: number, index: number) => trend[period]?.points[index]?.value ?? null
  return (
    <>
      <Card>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>{labels[metric]}</CardTitle>
          {previous && selected.value !== null && previous.value !== null && (
            <ChangeChip current={selected.value} previous={previous.value} />
          )}
        </div>
        <p className="mt-1 text-3xl font-bold tabular-nums" data-testid="sales-value">
          {metricText(selected.value, metric)}
        </p>
        <p className="mt-1 text-xs text-content-muted">
          {metric === 'revenue' ? 'Counter + delivery' : 'Counter bills only'}
        </p>
        {grain === 'hour' && (
          <p className="mt-2 text-xs text-content-muted">Hourly pattern · counter only · Kolkata</p>
        )}
        <AnalyticsChart
          key={`${from}:${to}:${grain}:${metric}:${periods}`}
          id="sales-trend"
          title={labels[metric]}
          metric={metric}
          series={trend}
          axis={rowLabels}
        />
        {metric === 'revenue' && (
          <Explain
            label="Delivery coverage"
            className="mt-2 min-h-11"
            explanation={
              <p>
                Imported Swiggy/Zomato gross revenue before commission. Missing imports are unknown.{' '}
                {provisional} source-day records are provisional. Delivery order counts and order
                times are unavailable, so Orders, AOV and hourly graphs use counter bills only.
              </p>
            }
          >
            <Chip tone={provisional ? 'warn' : 'neutral'}>
              {provisional ? `${provisional} provisional imports` : 'Delivery coverage'}
            </Chip>
          </Explain>
        )}
      </Card>
      {!totalDays(current).orders && !totalDays(recorded.filter((d) => d.date >= from)).revenue && (
        <Card className="py-3">
          <CardTitle>No settled sales in this period</CardTitle>
          <p className="mt-1 text-sm text-content-muted">Try another range.</p>
        </Card>
      )}
      <Card>
        <div className="mb-3 flex items-center justify-between">
          <CardTitle>{grain === 'hour' ? 'Hours' : grain === 'day' ? 'Days' : 'Weeks'}</CardTitle>
          <Explain
            label="Period alignment"
            className="min-h-11 text-xs text-content-muted"
            explanation={
              <p>
                {grain === 'hour'
                  ? 'Counter totals for each Kolkata clock hour across the selected range. Delivery order times are unavailable. Earlier ranges use the same clock hours.'
                  : 'Weeks start Monday. Boundary weeks include selected dates only. Earlier ranges align by elapsed day within an equal-length period.'}
              </p>
            }
          >
            {grain === 'hour' ? 'Counter only' : 'Aligned dates'}
          </Explain>
        </div>
        <AnalyticsScrollList
          key={`${from}:${to}:${grain}:${metric}:${periods}`}
          rows={rowLabels.map((label, index) => ({ label, index })).reverse()}
          label="Sales periods"
          render={({ label, index }) => (
            <li key={label} data-testid="period-row" className="py-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">{label}</span>
                <span className="ml-auto text-sm font-bold tabular-nums">
                  {metricText(rowValue(0, index), metric)}
                </span>
                {previous && rowValue(0, index) !== null && rowValue(1, index) !== null && (
                  <ChangeChip current={rowValue(0, index)!} previous={rowValue(1, index)!} />
                )}
              </div>
              <div className="mt-2">
                <MiniBar value={rowValue(0, index) ?? 0} max={max} />
              </div>
            </li>
          )}
        />
      </Card>
      <div className="grid gap-3 xl:grid-cols-2">
        <Card>
          <CardTitle>{weekdayTitle}</CardTitle>
          <p className="mt-1 text-xs text-content-muted">
            By weekday · {metric === 'revenue' ? 'Counter + delivery' : 'Counter only'}
          </p>
          <AnalyticsChart
            key={`${from}:${to}:${metric}:${periods}`}
            id="sales-weekdays"
            title={weekdayTitle}
            series={weekdaySeries}
            metric={metric}
            axis={weekdays}
          />
        </Card>
        <Card>
          <CardTitle>{hourlyTitle}</CardTitle>
          <p className="mt-1 text-xs text-content-muted">
            {metric === 'aov' ? 'AOV' : 'Per day'} · Counter only · Kolkata
          </p>
          <AnalyticsChart
            key={`${from}:${to}:${metric}:${periods}`}
            id="sales-hours"
            variant="columns"
            title={hourlyTitle}
            series={hourlyPattern}
            metric={metric}
            axis={hourlyAxis}
          />
        </Card>
      </div>
      <details className="rounded-xl border border-border bg-surface px-4">
        <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold">
          Table & export
        </summary>
        <div className="space-y-3 pb-4">
          <Button
            size="phone"
            variant="secondary"
            onClick={() =>
              download('sales-trends', [
                [
                  grain === 'hour' ? 'Kolkata hour (counter only)' : 'Period',
                  ...allPeriods.map(
                    (p) =>
                      `${p.label} · ${metric === 'orders' ? 'Counter orders' : `${labels[metric]} (paise)`}`,
                  ),
                ],
                ...rowLabels.map((label, index) => [
                  label,
                  ...allPeriods.map((_, period) => rowValue(period, index) ?? '—'),
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
                  <th scope="col" className="p-2">
                    {grain === 'hour' ? 'Kolkata hour (counter only)' : 'Period'}
                  </th>
                  {allPeriods.map((p) => (
                    <th key={p.label} scope="col" className="whitespace-nowrap p-2">
                      {p.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rowLabels.map((label, index) => (
                  <tr key={label} className="border-t border-border">
                    <th scope="row" className="whitespace-nowrap p-2 font-medium">
                      {label}
                    </th>
                    {allPeriods.map((p, period) => (
                      <td key={p.label} className="whitespace-nowrap p-2 tabular-nums">
                        {metricText(rowValue(period, index), metric)}
                      </td>
                    ))}
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
