import type { ReactNode } from 'react'
import { useSearchParams } from 'react-router'
import { ChartLine, Download, Table2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardTitle } from '@/components/ui/card'
import {
  AnalyticsChart,
  metricText,
  pointStatus,
  SeriesNumber,
  type ChartMetric,
  type ChartSeries,
} from './analytics-chart'
import { download } from './analytics-utils'
import { ChangeChip, TrendChip, UsualChip } from './analytics-widgets'
import { periodUnit, usualRange } from '@/domain/sales-analytics'

const UNIT_WORDS: Record<string, string> = { day: 'a day', wk: 'a week', mo: 'a month' }

/** Where `current` sits against the earlier values, as `▲ 14%`, `≈` or `▼ 13%`. */
function VersusUsual({ current, earlier }: { current: number; earlier: number[] }) {
  const usual = usualRange(current, earlier)
  if (!usual) return null
  const mean = earlier.reduce((sum, v) => sum + v, 0) / earlier.length
  if (usual.position === 'about' || !mean)
    return <span className="text-content-muted">{usual.position === 'about' ? '≈' : '▲'}</span>
  return (
    <span className={usual.position === 'above' ? 'text-success' : 'text-danger'}>
      {usual.position === 'above' ? '▲' : '▼'} {Math.round(Math.abs(current / mean - 1) * 100)}%
    </span>
  )
}

/**
 * One trend, two readings: the chart, or a table holding every figure the chart
 * draws — every bucket of every compared period, exact to the paisa — and its
 * CSV. Against one earlier period it shows the change; against two or three it
 * shows where the periods are heading and whether this one is usual.
 */
export function TrendCard({
  id,
  title,
  metric,
  totals,
  days,
  caption,
  subject,
  series,
  axis,
  rowHeader,
  newestFirst,
  exportName,
  exportUnit,
  children,
}: {
  id: string
  title: string
  metric: ChartMetric
  /** Each compared period's total, current first. */
  totals: (number | null)[]
  /** The length of one period, in days. */
  days: number
  caption: ReactNode
  /** Above the title: what the trend is of, when the page lets you choose. */
  subject?: ReactNode
  series: ChartSeries[]
  axis: string[]
  rowHeader: string
  newestFirst: boolean
  exportName: string
  exportUnit: string
  children?: ReactNode
}) {
  // In the address, so the choice survives a reload and a change of subject.
  const [params, setParams] = useSearchParams()
  const show = params.get('show') === 'table' ? 'table' : 'chart'
  const setShow = (next: 'chart' | 'table') =>
    setParams(
      (previous) => {
        const updated = new URLSearchParams(previous)
        if (next === 'table') updated.set('show', 'table')
        else updated.delete('show')
        return updated
      },
      { replace: true },
    )
  const rows = axis.map((label, index) => ({ label, index }))
  if (newestFirst) rows.reverse()
  const cell = (period: number, index: number) => series[period]?.points[index]?.value ?? null
  const [value = null, previous = null] = totals
  const known = totals.filter((t): t is number => t !== null)
  const trend = totals.length >= 3 && value !== null && known.length >= 3
  const unit = periodUnit(days)
  const usual = trend ? usualRange(value!, known.slice(1)) : null
  const earlierCells = (index: number) =>
    series
      .slice(1)
      .map((_, period) => cell(period + 1, index))
      .filter((v): v is number => v !== null)
  return (
    <Card data-testid={`${id}-card`}>
      {subject}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <CardTitle>{title}</CardTitle>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <p className="text-3xl font-bold tabular-nums" data-testid={`${id}-value`}>
              {metricText(value, metric)}
            </p>
            {trend ? (
              <>
                <TrendChip values={[...known].reverse()} unit={unit} />
                {usual && <UsualChip position={usual.position} />}
              </>
            ) : (
              totals.length === 2 &&
              value !== null &&
              previous !== null && <ChangeChip current={value} previous={previous} />
            )}
          </div>
        </div>
        <div
          className="flex shrink-0 rounded-lg border border-border p-0.5"
          role="group"
          aria-label="Show as"
        >
          {(
            [
              ['chart', 'Chart', ChartLine],
              ['table', 'Table', Table2],
            ] as const
          ).map(([key, label, Icon]) => (
            <Button
              key={key}
              size="phone"
              variant="ghost"
              className={`min-w-11 px-2 ${show === key ? 'bg-surface-raised text-accent-text' : 'text-content-muted'}`}
              aria-label={label}
              aria-pressed={show === key}
              onClick={() => setShow(key)}
            >
              <Icon size={18} aria-hidden />
            </Button>
          ))}
        </div>
      </div>
      {usual && (
        <p className="mt-1 text-sm text-content-muted" data-testid={`${id}-usual`}>
          Usually {metricText(usual.low, metric, true)}–{metricText(usual.high, metric, true)}{' '}
          {UNIT_WORDS[unit] ?? `per ${days} days`}
        </p>
      )}
      <p className="mt-1 text-xs text-content-muted">{caption}</p>
      {show === 'chart' ? (
        <AnalyticsChart
          key={`${metric}:${series.length}:${axis[0]}:${axis.length}`}
          id={id}
          title={title}
          metric={metric}
          series={series}
          axis={axis}
        />
      ) : (
        <div className="mt-3">
          <div
            role="region"
            aria-label={`${title} table`}
            tabIndex={0}
            className="max-h-[22rem] overflow-auto overscroll-contain rounded-lg border border-border"
          >
            <table className="w-full text-left text-xs tabular-nums" data-testid={`${id}-table`}>
              <thead className="sticky top-0 bg-surface">
                <tr className="border-b border-border">
                  <th scope="col" className="p-2 font-semibold">
                    {rowHeader}
                  </th>
                  {series.map((s, period) => (
                    <th key={s.label} scope="col" className="whitespace-nowrap p-2 text-right">
                      <span className="inline-flex items-center gap-1.5 font-semibold">
                        <SeriesNumber period={period} />
                        {s.label}
                      </span>
                    </th>
                  ))}
                  {series.length > 1 && (
                    <th scope="col" className="whitespace-nowrap p-2 text-right font-semibold">
                      {series.length > 2 ? 'vs usual' : 'Change'}
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ label, index }) => (
                  <tr key={label} data-testid="trend-row" className="border-t border-border">
                    <th scope="row" className="whitespace-nowrap p-2 font-medium">
                      {label}
                    </th>
                    {series.map((s, period) => (
                      <td
                        key={s.label}
                        className={`whitespace-nowrap p-2 text-right ${period ? 'text-content-muted' : 'font-bold'}`}
                      >
                        {metricText(cell(period, index), metric, false, true)}
                        {pointStatus(s.points[index])}
                      </td>
                    ))}
                    {series.length > 1 && (
                      <td className="whitespace-nowrap p-2 text-right">
                        {cell(0, index) === null ? null : series.length > 2 ? (
                          <VersusUsual current={cell(0, index)!} earlier={earlierCells(index)} />
                        ) : (
                          cell(1, index) !== null && (
                            <ChangeChip current={cell(0, index)!} previous={cell(1, index)!} />
                          )
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="text-xs text-content-muted">
              {series.length > 1 ? 'Earlier periods aligned by elapsed day' : ' '}
            </p>
            <Button
              size="phone"
              variant="ghost"
              onClick={() =>
                download(exportName, [
                  [rowHeader, ...series.map((s) => `${s.label} · ${exportUnit}`)],
                  ...axis.map((label, index) => [
                    label,
                    ...series.map((_, period) => cell(period, index) ?? '—'),
                  ]),
                ])
              }
            >
              <Download size={16} aria-hidden />
              Export CSV
            </Button>
          </div>
        </div>
      )}
      {children}
    </Card>
  )
}
