import { useState, type PointerEvent } from 'react'
import type { SalesMetric } from '@/domain/sales-analytics'

/** Sales measures, plus dish units for the Items chart. */
export type ChartMetric = SalesMetric | 'units'
export interface ChartPoint {
  label: string
  value: number | null
}
export interface ChartSeries {
  label: string
  points: ChartPoint[]
}
const strokes = [
  'var(--primary)',
  'var(--chart-previous)',
  'var(--chart-earlier)',
  'var(--chart-oldest)',
]
const dashes = [undefined, '6 4', '10 3 2 3', '2 4']
export function SeriesNumber({ period }: { period: number }) {
  return (
    <span
      aria-hidden
      className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-[0.625rem] font-bold"
      style={{ backgroundColor: strokes[period], color: 'var(--surface)' }}
    >
      {period + 1}
    </span>
  )
}
/**
 * Rupees read whole from ₹100 up, so a column never mixes `₹7,365` with
 * `₹30,110.89`; below that, paise always show two digits (`₹10.50`). `exact`
 * keeps the paise at any size, for the table that reconciles to the bills.
 */
export function metricText(
  value: number | null,
  metric: ChartMetric,
  compact = false,
  exact = false,
) {
  if (value === null) return '—'
  if (metric === 'orders' || metric === 'units')
    return new Intl.NumberFormat('en-IN', {
      notation: compact ? 'compact' : 'standard',
      maximumFractionDigits: 1,
    }).format(value)
  const rupees = value / 100
  const paise = !compact && (exact || Math.abs(rupees) < 100) && Math.round(value) % 100 !== 0
  return `₹${new Intl.NumberFormat('en-IN', {
    notation: compact ? 'compact' : 'standard',
    minimumFractionDigits: paise ? 2 : 0,
    maximumFractionDigits: compact ? 1 : paise ? 2 : 0,
  }).format(rupees)}`
}
export function rangeLabel(from: string, to: string) {
  const month = (d: string) =>
    new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' }).format(
      new Date(`${d}T12:00:00Z`),
    )
  if (from === to) return `${Number(from.slice(8))} ${month(from)}`
  if (from.slice(0, 7) === to.slice(0, 7))
    return `${Number(from.slice(8))}–${Number(to.slice(8))} ${month(to)}`
  const year = from.slice(0, 4) !== to.slice(0, 4)
  return `${Number(from.slice(8))} ${month(from)}${year ? ` '${from.slice(2, 4)}` : ''}–${Number(to.slice(8))} ${month(to)}${year ? ` '${to.slice(2, 4)}` : ''}`
}

export function AnalyticsChart({
  id,
  title,
  series,
  metric,
  axis,
  variant = 'line',
}: {
  id: string
  title: string
  series: ChartSeries[]
  metric: ChartMetric
  axis: string[]
  variant?: 'line' | 'columns'
}) {
  const [selected, setSelected] = useState<number | null>(null)
  const length = Math.max(1, axis.length)
  const peak = Math.max(1, ...series.flatMap((s) => s.points.map((p) => p.value ?? 0)))
  // A count's half-way gridline should be a whole number too.
  const max = metric === 'orders' || metric === 'units' ? Math.ceil(peak / 2) * 2 : peak
  const columns = variant === 'columns'
  const slot = 302 / length
  const barGap = 1.25
  const barWidth = Math.max(
    1,
    (slot * 0.78 - barGap * (series.length - 1)) / Math.max(1, series.length),
  )
  const groupWidth = series.length * barWidth + (series.length - 1) * barGap
  // Up to seven short labels (weekdays, single dates) are all drawn; longer
  // axes, and week ranges, keep a few anchors so labels never collide.
  const ticks =
    length <= 7 && axis.every((label) => label.length <= 6)
      ? Array.from({ length }, (_, i) => i)
      : columns
        ? [
            ...new Set([
              0,
              Math.round((length - 1) / 3),
              Math.round((2 * (length - 1)) / 3),
              length - 1,
            ]),
          ]
        : [...new Set([0, length - 1])]
  const x = (index: number) =>
    columns ? 44 + slot * (index + 0.5) : length === 1 ? 195 : 44 + (index / (length - 1)) * 302
  const y = (value: number) => 146 - (value / max) * 122
  const choose = (event: PointerEvent<SVGSVGElement>) => {
    // SVG can letterbox on wider screens; use its rendered coordinate transform.
    const transform = event.currentTarget.getScreenCTM()
    if (!transform) return
    const position = new DOMPoint(event.clientX, event.clientY).matrixTransform(
      transform.inverse(),
    ).x
    setSelected(
      Math.max(
        0,
        Math.min(
          length - 1,
          columns
            ? Math.floor((position - 44) / slot)
            : Math.round(((position - 44) / 302) * (length - 1)),
        ),
      ),
    )
  }
  const index = selected === null ? null : Math.min(selected, length - 1)
  return (
    <div data-testid={id}>
      <svg
        viewBox="0 0 360 190"
        className="mt-3 block aspect-[360/190] max-h-72 w-full touch-pan-y text-content-muted"
        role="group"
        aria-label={`${title} chart; tap or use arrow keys for values`}
        tabIndex={0}
        onPointerDown={choose}
        onPointerMove={(e) => {
          if (e.pointerType === 'mouse') choose(e)
        }}
        onKeyDown={(e) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
          e.preventDefault()
          setSelected(
            e.key === 'Home'
              ? 0
              : e.key === 'End'
                ? length - 1
                : Math.max(
                    0,
                    Math.min(length - 1, (index ?? 0) + (e.key === 'ArrowLeft' ? -1 : 1)),
                  ),
          )
        }}
      >
        <title>{title}. Tap a point or use arrow keys to inspect every period.</title>
        {columns && index !== null && (
          <rect
            x={44 + slot * index}
            y="20"
            width={slot}
            height="126"
            rx="3"
            fill="var(--content)"
            fillOpacity="0.06"
          />
        )}
        {[0, 0.5, 1].map((n) => (
          <g key={n}>
            <line
              x1="44"
              x2="346"
              y1={y(max * n)}
              y2={y(max * n)}
              stroke="currentColor"
              strokeOpacity="0.2"
            />
            <text x="37" y={y(max * n) + 4} textAnchor="end" fill="currentColor" fontSize="11">
              {metricText(max * n, metric, true)}
            </text>
          </g>
        ))}
        {series.map((s, period) => (
          <g key={s.label} data-testid="chart-series">
            {!columns &&
              s.points.map((p, i) => {
                const next = s.points[i + 1]
                return p.value !== null && next?.value !== null && next?.value !== undefined ? (
                  <line
                    key={`line-${i}`}
                    x1={x(i)}
                    y1={y(p.value)}
                    x2={x(i + 1)}
                    y2={y(next.value)}
                    stroke={strokes[period]}
                    strokeWidth={period ? 2 : 3}
                    strokeDasharray={dashes[period]}
                  />
                ) : null
              })}
            {s.points.map((p, i) =>
              p.value !== null ? (
                columns ? (
                  <rect
                    key={i}
                    data-testid={period === 0 ? 'chart-column' : undefined}
                    x={x(i) - groupWidth / 2 + period * (barWidth + barGap)}
                    y={y(p.value)}
                    width={barWidth}
                    height={146 - y(p.value)}
                    rx={Math.min(2, barWidth / 2)}
                    fill={strokes[period]}
                  >
                    <title>
                      {s.label}: {p.label}, {metricText(p.value, metric)}
                    </title>
                  </rect>
                ) : (
                  <circle
                    key={i}
                    data-testid={period === 0 ? 'chart-point' : undefined}
                    cx={x(i)}
                    cy={y(p.value)}
                    r={length < 8 || index === i ? 3.5 : 1.5}
                    fill={strokes[period]}
                  >
                    <title>
                      {s.label}: {p.label}, {metricText(p.value, metric)}
                    </title>
                  </circle>
                )
              ) : null,
            )}
          </g>
        ))}
        {!columns && index !== null && (
          <line
            x1={x(index)}
            x2={x(index)}
            y1="20"
            y2="146"
            stroke="var(--content-muted)"
            strokeDasharray="2 3"
          />
        )}
        {ticks.map((i) => (
          <text
            key={i}
            x={columns || length === 1 ? x(i) : i === 0 ? 44 : i === length - 1 ? 346 : x(i)}
            y="174"
            textAnchor={
              columns || length === 1
                ? 'middle'
                : i === 0
                  ? 'start'
                  : i === length - 1
                    ? 'end'
                    : 'middle'
            }
            fill="currentColor"
            fontSize="11"
          >
            {axis[i]}
          </text>
        ))}
      </svg>
      <div
        className="grid grid-cols-2 gap-x-3 gap-y-1 text-[0.6875rem] text-content-muted"
        aria-label={`${title} periods`}
      >
        {series.map((s, i) => (
          <span
            key={s.label}
            className="flex items-center gap-1.5"
            aria-label={columns ? `${i + 1}: ${s.label}` : undefined}
          >
            {columns ? (
              <SeriesNumber period={i} />
            ) : (
              <svg viewBox="0 0 24 8" className="h-2 w-6 shrink-0" aria-hidden>
                <line
                  x1="0"
                  x2="24"
                  y1="4"
                  y2="4"
                  stroke={strokes[i]}
                  strokeWidth="2"
                  strokeDasharray={dashes[i]}
                />
              </svg>
            )}
            {s.label}
          </span>
        ))}
      </div>
      {index !== null && (
        <div
          role="status"
          aria-live="polite"
          data-testid="chart-details"
          className="mt-3 grid grid-cols-2 gap-2 rounded-lg bg-surface-raised p-2 text-xs"
        >
          {series.map((s, period) => (
            <div key={s.label}>
              <p className="flex items-center gap-1.5 text-content-muted">
                {columns && <SeriesNumber period={period} />}
                {s.points[index]?.label ?? axis[index]}
              </p>
              <p className={`font-bold tabular-nums ${columns ? 'pl-[1.375rem]' : ''}`}>
                {metricText(s.points[index]?.value ?? null, metric)}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
