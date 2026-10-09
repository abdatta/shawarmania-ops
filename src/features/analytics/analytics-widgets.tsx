import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import { Chip } from '@/components/ui/chip'
import { Money } from '@/components/ui/money'
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
      tone={previous && current > previous ? 'good' : 'neutral'}
    >
      {compactChange(current, previous)}
    </Chip>
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
