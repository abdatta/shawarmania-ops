import { BellOff } from 'lucide-react'

import { formatTime } from '@/domain'
import { SyncIndicator } from '@/features/billing/counter-status'
import { kitchenOffline, useKitchenMarks } from '@/features/billing/kitchen-marks-state'
import { cn } from '@/lib/cn'

/**
 * The tablet's state in one segmented pill (#72): *Kitchen offline* while the
 * outlet has a kitchen tablet and none of them is on shift, whether its work has
 * synced, and when this shift opened. It replaced a full sentence about how a
 * shift ends, which took most of the header's width on a tablet [owner,
 * 2026-10-09]; that explanation now sits on the Hand over screen.
 */
export function CounterStatus({ openedAt }: { openedAt: string }) {
  const offline = kitchenOffline(useKitchenMarks()?.marks ?? null)
  return (
    <div
      data-testid="counter-status"
      className="inline-flex h-9 items-stretch divide-x divide-border overflow-hidden rounded-full border border-border bg-surface"
    >
      {offline && (
        <span
          role="status"
          data-testid="kitchen-offline"
          className={cn(
            'flex items-center gap-1.5 whitespace-nowrap px-3 text-sm font-extrabold text-primary',
            'bg-primary/10',
          )}
        >
          <BellOff aria-hidden size={15} strokeWidth={2.25} />
          Kitchen offline
        </span>
      )}
      <span className="flex items-center px-3">
        <SyncIndicator />
      </span>
      <span className="flex items-center whitespace-nowrap px-3 text-xs text-content-muted">
        since {formatTime(openedAt)}
      </span>
    </div>
  )
}
