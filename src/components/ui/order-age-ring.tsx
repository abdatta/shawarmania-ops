import { cn } from '@/lib/cn'
import { formatKitchenWait, KITCHEN_WAIT_DANGER_MINUTES, kitchenWaitTone } from '@/domain'

/** The wait, in a ring that fills towards the danger mark. */
export function OrderAgeRing({
  orderedAt,
  now,
  normalRing = 'stroke-content-muted',
  compact = false,
}: {
  orderedAt: string
  now: Date
  normalRing?: string
  compact?: boolean
}) {
  const tone = kitchenWaitTone(orderedAt, now)
  const minutes = Math.max(0, (now.getTime() - Date.parse(orderedAt)) / 60_000)
  const wait = compact ? `${Math.floor(minutes)} minutes` : formatKitchenWait(orderedAt, now)
  const filled = Math.max(0.02, Math.min(1, minutes / KITCHEN_WAIT_DANGER_MINUTES))
  const radius = 21
  const around = 2 * Math.PI * radius
  return (
    <div
      role="img"
      aria-label={`Order age: ${wait}`}
      title={`Order age: ${wait}`}
      data-testid={compact ? 'order-age' : 'kitchen-wait'}
      className={cn('relative shrink-0', compact ? 'size-9' : 'size-14')}
    >
      <svg aria-hidden viewBox="0 0 56 56" className={compact ? 'size-9' : 'size-14'}>
        <g transform="rotate(-90 28 28)">
          <circle
            cx="28"
            cy="28"
            r={radius}
            fill="none"
            strokeWidth="5"
            className="stroke-surface-raised"
          />
          <circle
            cx="28"
            cy="28"
            r={radius}
            fill="none"
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray={around}
            strokeDashoffset={around * (1 - filled)}
            className={cn(
              tone === 'critical'
                ? 'stroke-danger-critical'
                : tone === 'danger'
                  ? 'stroke-danger'
                  : tone === 'warning'
                    ? 'stroke-warning'
                    : normalRing,
            )}
          />
        </g>
        <text
          x="28"
          y="28"
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={compact ? 16 : 14}
          className={cn(
            'fill-current font-black tabular-nums',
            tone === 'danger' && 'text-danger',
            tone === 'critical' && 'text-danger-critical',
          )}
        >
          {compact ? Math.floor(minutes) : wait.replace(' ', '')}
        </text>
      </svg>
    </div>
  )
}
