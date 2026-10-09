import type { ReactNode } from 'react'
import { useSearchParams } from 'react-router'
import { ChartLine, Download, Table2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardTitle } from '@/components/ui/card'
import {
  AnalyticsChart,
  metricText,
  SeriesNumber,
  type ChartMetric,
  type ChartSeries,
} from './analytics-chart'
import { download } from './analytics-utils'
import { ChangeChip } from './analytics-widgets'

/**
 * One trend, two readings: the chart, or a table holding every figure the chart
 * draws — every bucket of every compared period, exact to the paisa — with the
 * change against the previous period and its CSV.
 */
export function TrendCard({
  id,
  title,
  metric,
  value,
  previous,
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
  value: number | null
  previous: number | null | undefined
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
            {previous !== undefined && value !== null && previous !== null && (
              <ChangeChip current={value} previous={previous} />
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
                    <th scope="col" className="p-2 text-right font-semibold">
                      Change
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
                      </td>
                    ))}
                    {series.length > 1 && (
                      <td className="p-2 text-right">
                        {cell(0, index) !== null && cell(1, index) !== null && (
                          <ChangeChip current={cell(0, index)!} previous={cell(1, index)!} />
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
