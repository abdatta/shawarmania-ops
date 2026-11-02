import { useState, type ReactNode } from 'react'
import { ChevronDown, GitCompareArrows } from 'lucide-react'
import { FormSheet } from '@/components/layout/form-sheet'
import { Button } from '@/components/ui/button'
import { periodDays, shiftDate, validAnalyticsDate } from '@/domain/sales-analytics'
import { rangeLabel } from './analytics-chart'

/** Group by, measure and comparison: the same three controls on Items and Sales. */
export function AnalyticsControls({
  grain,
  grains,
  metric,
  metrics,
  periods,
  from,
  to,
  onChange,
  windowsOf,
  unavailable,
  scope,
}: {
  /** Counter or Delivery (delivery-orders-are-made-not-billed), after Compare. */
  scope?: ReactNode
  /**
   * Measures shown but not offered, and why (delivery-orders-are-made-not-billed:
   * delivery orders carry no money).
   */
  unavailable?: { values: string[]; reason: string } | undefined
  grain: string
  grains: [string, string][]
  metric: string
  metrics: [string, string][]
  periods: number
  from: string
  to: string
  onChange: (values: Record<string, string>) => void
  /** One Revenue's compared windows for a count, when they are not equal ranges. */
  windowsOf?: ((count: number) => { first: string; last: string }[]) | undefined
}) {
  return (
    <div className="flex gap-2">
      <Choice
        label="Group by"
        value={grain}
        options={grains}
        onChange={(value) => onChange({ grain: value })}
      />
      <Choice
        label="Measure"
        value={metric}
        options={metrics}
        onChange={(value) => onChange({ metric: value })}
        {...(unavailable ? { unavailable } : {})}
      />
      <PeriodComparison
        periods={periods}
        from={from}
        to={to}
        onChange={(value) => onChange({ periods: String(value) })}
        windowsOf={windowsOf}
        // Beside the Counter · Delivery pill both read as icons, so the two
        // pickers keep their width [owner, 2026-11-01].
        compact={scope !== undefined}
      />
      {scope}
    </div>
  )
}

function PeriodComparison({
  periods,
  from,
  to,
  onChange,
  windowsOf,
  compact = false,
}: {
  /** The icon and the count, without the word (delivery-orders-are-made-not-billed). */
  compact?: boolean
  periods: number
  from: string
  to: string
  onChange: (value: number) => void
  windowsOf?: ((count: number) => { first: string; last: string }[]) | undefined
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
          {!compact && 'Compare'}
          <span className="font-bold tabular-nums text-accent-text">
            {periods === 1 ? 'Off' : periods}
          </span>
        </span>
      </Button>
      <FormSheet open={open} onClose={() => setOpen(false)} title="Compare periods">
        <p className="mb-3 text-xs text-content-muted">
          {windowsOf
            ? 'Current range + the same dates in earlier months'
            : 'Current range + earlier equal ranges'}
        </p>
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
                  {(windowsOf
                    ? windowsOf(count).map((w) => rangeLabel(w.first, w.last))
                    : Array.from({ length: count }, (_, period) =>
                        rangeLabel(shiftDate(from, -period * span), shiftDate(to, -period * span)),
                      )
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
  unavailable,
}: {
  label: string
  value: string
  options: [string, string][]
  onChange: (value: string) => void
  unavailable?: { values: string[]; reason: string }
}) {
  const [open, setOpen] = useState(false)
  const text = options.find(([key]) => key === value)?.[1]
  return (
    <>
      <Button
        size="phone"
        variant="secondary"
        className="min-w-0 flex-1 justify-between px-2"
        aria-label={`${label}: ${text}`}
        onClick={() => setOpen(true)}
      >
        <span className="min-w-0 text-xs">{text}</span>
        <ChevronDown size={14} aria-hidden />
      </Button>
      <FormSheet open={open} onClose={() => setOpen(false)} title={label}>
        <div className="grid gap-2">
          {options.map(([key, optionText]) =>
            unavailable?.values.includes(key) ? (
              <Button
                key={key}
                variant="secondary"
                disabled
                aria-description={unavailable.reason}
                className="h-auto min-h-11 flex-col gap-0.5 py-2"
              >
                <span>{optionText}</span>
                <span className="text-xs font-normal">{unavailable.reason}</span>
              </Button>
            ) : (
              <Button
                key={key}
                variant={key === value ? 'primary' : 'secondary'}
                aria-pressed={key === value}
                onClick={() => {
                  onChange(key)
                  setOpen(false)
                }}
              >
                {optionText}
              </Button>
            ),
          )}
        </div>
      </FormSheet>
    </>
  )
}
