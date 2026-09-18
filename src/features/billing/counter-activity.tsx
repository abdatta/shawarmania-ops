import type { BillingOrder } from '@/data-access/adapters'

import { OpenOrdersSurface } from './open-orders-surface'

/**
 * The right rail's whole content: the outlet's pipeline.
 *
 * Money history left this rail — it is the middle column's default content now
 * — so what remains is exactly the slice a kitchen display would mirror one
 * day: every unfinished order in one list, newest first.
 *
 * While the composer holds a saved order, its card still docks out of this rail
 * against the composer's column, exactly as before: the card under edit leaves
 * the list and slides out of the rail's own margin so the two become one
 * accent-outlined piece of work rather than two panels that happen to be
 * adjacent. It sits **outside** the list's scroller for the same reason as
 * always — scrolling the pipeline must never scroll the order being edited
 * away; here that is true by construction, because nothing above it moves.
 */
export function CounterActivity({
  refreshKey,
  savedOrderKey = 0,
  editingOrderId = null,
  onEditOrder,
  onActivityChanged,
}: {
  refreshKey: number
  /** Bumped only when an order is saved on this tablet. */
  savedOrderKey?: number
  editingOrderId?: string | null
  onEditOrder?: (order: BillingOrder) => void
  onActivityChanged?: () => void
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <OpenOrdersSurface
        embedded
        refreshKey={refreshKey}
        savedOrderKey={savedOrderKey}
        editingOrderId={editingOrderId}
        {...(onEditOrder ? { onEditOrder } : {})}
        {...(onActivityChanged ? { onActivityChanged } : {})}
      />
    </div>
  )
}
