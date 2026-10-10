import { ArrowDownRight, ArrowRight, ArrowUpRight, Minus } from 'lucide-react'
import { Chip } from '@/components/ui/chip'
import { Money } from '@/components/ui/money'
import { periodDirection, type UsualRange } from '@/domain/sales-analytics'
import { compactChange } from './analytics-utils'

export function ChangeChip({ current, previous }: { current: number; previous: number }) {
  // Nothing either side is a plain dash, not a dash beside a dash.
  if (!current && !previous) return <span className="text-xs text-content-muted">—</span>
  return (
    <Chip
      icon={
        !previous || current === previous
          ? Minus
          : current > previous
            ? ArrowUpRight
            : ArrowDownRight
      }
      tone={!previous || current === previous ? 'neutral' : current > previous ? 'good' : 'bad'}
    >
      {compactChange(current, previous)}
    </Chip>
  )
}

/**
 * Where three or four periods are heading: an arrow, and the fitted rate per
 * period with its unit set small (`↗ 9% / mo`). Flat is `→ steady`, the word
 * set like the unit so every chip is about one size; a number would argue with
 * the arrow.
 */
export function TrendChip({ values, unit }: { values: number[]; unit: string }) {
  const trend = periodDirection(values)
  if (trend.direction === 'flat')
    return (
      <Chip icon={ArrowRight}>
        <span className="text-[0.6875rem] font-normal text-content-muted">steady</span>
      </Chip>
    )
  return (
    <Chip
      icon={trend.direction === 'up' ? ArrowUpRight : ArrowDownRight}
      tone={trend.direction === 'up' ? 'good' : 'bad'}
    >
      {Math.round(Math.abs(trend.rate!) * 100)}%
      <span className="ml-0.5 text-[0.6875rem] font-normal text-content-muted">/ {unit}</span>
    </Chip>
  )
}

/** The current period against what the earlier ones make usual: ▲, ≈ or ▼. */
export function UsualChip({ position }: { position: UsualRange['position'] }) {
  return (
    <Chip tone={position === 'above' ? 'good' : position === 'below' ? 'bad' : 'neutral'}>
      {position === 'above' ? '▲' : position === 'below' ? '▼' : '≈'} usual
    </Chip>
  )
}

/**
 * Each compared period's own total as a bar from zero, oldest left and the
 * current period right, in the chart legend's colours. Scaled to this row's
 * best period, so its shape is exact; the units bar compares rows.
 */
export function PeriodBars({ values, label }: { values: number[]; label: string }) {
  const max = Math.max(...values, 0)
  const colours = [
    'var(--primary)',
    'var(--chart-previous)',
    'var(--chart-earlier)',
    'var(--chart-oldest)',
  ]
  return (
    <span
      role="img"
      aria-label={`${label}, oldest first: ${values.join(', ')}`}
      title={values.join(' · ')}
      className="inline-flex h-5 shrink-0 items-end gap-0.5 border-b border-border"
      data-testid="period-bars"
    >
      {values.map((value, index) => (
        <span
          key={index}
          data-value={value}
          className="w-[5px] rounded-t-[1px]"
          style={{
            height: max ? `${(value / max) * 100}%` : 0,
            minHeight: value ? 1 : 0,
            backgroundColor: colours[values.length - 1 - index],
          }}
        />
      ))}
    </span>
  )
}
export function MiniBar({
  value,
  max,
  muted = false,
}: {
  value: number
  max: number
  muted?: boolean
}) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-surface-raised" aria-hidden>
      <div
        className={`h-full rounded-full ${muted ? 'bg-content-muted' : 'bg-primary'}`}
        style={{ width: `${Math.max(0, Math.min(100, (value / Math.max(1, max)) * 100))}%` }}
      />
    </div>
  )
}
export function Bars({
  rows,
  money = false,
}: {
  rows: { label: string; value: number }[]
  money?: boolean
}) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <div key={r.label}>
          <div className="mb-1 flex items-start justify-between gap-3 text-sm">
            <span className="min-w-0 break-words">{r.label}</span>
            <span className="shrink-0 tabular-nums font-semibold">
              {money ? <Money paise={r.value} /> : r.value}
            </span>
          </div>
          <MiniBar value={r.value} max={max} />
        </div>
      ))}
      {!rows.length && <p className="text-sm text-content-muted">No sales to chart.</p>}
    </div>
  )
}
