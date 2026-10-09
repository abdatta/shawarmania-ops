import { Card, CardTitle } from '@/components/ui/card'
import { Chip } from '@/components/ui/chip'
import { Explain } from '@/components/ui/why'
import type { AnalyticsSnapshot } from '@/domain/sales-analytics-types'
import {
  analyticsRevenueDays,
  periodDays,
  salesValue,
  totalDays,
  type SalesMetric,
} from '@/domain/sales-analytics'
import { AnalyticsChart, type ChartSeries } from './analytics-chart'
import { periodTrend } from './analytics-trend'
import { TrendCard } from './analytics-trend-card'

const labels = { revenue: 'Revenue', orders: 'Orders', aov: 'AOV' }

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
  const recorded = analyticsRevenueDays(data, true)
  // Revenue counts delivery gross; Orders and AOV only have counter bills.
  const trend = periodTrend({
    days: metric === 'revenue' ? recorded : data.days,
    from,
    to,
    periods,
    grain: grain === 'hour' ? 'day' : grain,
    value: (b) => salesValue(b.revenue, b.orders, metric),
  })
  const hours = Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, '0')}:00`)
  const hourSeries: ChartSeries[] = trend.periods.map((p, period) => ({
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
  const hourlyPattern = hourlyAverages.map((series) => ({
    ...series,
    points: series.points.slice(firstHour, lastHour + 1),
  }))
  const hourlyTitle =
    metric === 'aov' ? 'Average bill by hour' : `Hourly average ${labels[metric].toLowerCase()}`
  const [selected, previous] = trend.periods.map((p) =>
    salesValue(p.total.revenue, p.total.orders, metric),
  )
  const provisional = data.delivery.filter(
    (d) => d.date >= from && d.date <= to && d.provisional,
  ).length
  return (
    <>
      <TrendCard
        id="sales-trend"
        title={labels[metric]}
        metric={metric}
        value={selected ?? null}
        previous={previous}
        caption={
          grain === 'hour'
            ? 'Counter bills by Kolkata clock hour, totals across the range'
            : metric === 'revenue'
              ? 'Counter + delivery'
              : 'Counter bills only'
        }
        series={grain === 'hour' ? hourSeries : trend.series}
        axis={grain === 'hour' ? hours : trend.axis}
        rowHeader={grain === 'hour' ? 'Hour' : grain === 'day' ? 'Day' : 'Week'}
        newestFirst={grain !== 'hour'}
        exportName="sales-trends"
        exportUnit={metric === 'orders' ? 'counter orders' : `${labels[metric]} (paise)`}
      >
        {metric === 'revenue' && (
          <Explain
            label="Delivery coverage"
            className="mt-2 min-h-11"
            explanation={
              <p>
                Imported Swiggy/Zomato gross revenue before commission. Missing imports are unknown.{' '}
                {provisional} source-day records are provisional. Delivery order counts and order
                times are unavailable, so Orders, AOV and hourly figures use counter bills only.
              </p>
            }
          >
            <Chip tone={provisional ? 'warn' : 'neutral'}>
              {provisional ? `${provisional} provisional imports` : 'Delivery coverage'}
            </Chip>
          </Explain>
        )}
      </TrendCard>
      {!totalDays(data.days.filter((d) => d.date >= from)).orders &&
        !totalDays(recorded.filter((d) => d.date >= from)).revenue && (
          <Card className="py-3">
            <CardTitle>No settled sales in this period</CardTitle>
            <p className="mt-1 text-sm text-content-muted">Try another range.</p>
          </Card>
        )}
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
          axis={hours.slice(firstHour, lastHour + 1)}
        />
      </Card>
    </>
  )
}
