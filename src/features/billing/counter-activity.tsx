import type { BillingOrder, OutletMenu } from '@/data-access/adapters'

import { DishOpenOrdersSurface } from './dish-open-orders-surface'

/**
 * The right rail's whole content: the outlet's pipeline.
 *
 * Money history left this rail for the records row below it, so what remains
 * is every unfinished order, newest first, in two columns
 * (each-dish-is-ticked-off).
 *
 * While the composer holds a saved order, the rail pins that order over its
 * right column, **outside** the list's scroller: scrolling the pipeline must
 * never scroll the order being edited away.
 */
export function CounterActivity({
  refreshKey,
  ownSaveKey = 0,
  savedOrderKey = 0,
  editingOrderId = null,
  onEditOrder,
  onSetOrderCustomer,
  onActivityChanged,
  onOrdersRead,
  checkoutSettings,
}: {
  refreshKey: number
  /** This tablet's own saves (the-counter-shows-what-it-saved). */
  ownSaveKey?: number
  /** Bumped only when an order is saved on this tablet. */
  savedOrderKey?: number
  editingOrderId?: string | null
  onEditOrder?: (order: BillingOrder) => void
  onSetOrderCustomer?: (order: BillingOrder) => void
  onActivityChanged?: () => void
  /** The rail hands its orders up, so the label warning reads them, not the server. */
  onOrdersRead?: (orders: BillingOrder[]) => void
  checkoutSettings?: Pick<OutletMenu, 'service' | 'loyalty'>
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <DishOpenOrdersSurface
        embedded
        refreshKey={refreshKey}
        ownSaveKey={ownSaveKey}
        savedOrderKey={savedOrderKey}
        editingOrderId={editingOrderId}
        {...(onEditOrder ? { onEditOrder } : {})}
        {...(onSetOrderCustomer ? { onSetOrderCustomer } : {})}
        {...(onActivityChanged ? { onActivityChanged } : {})}
        {...(onOrdersRead ? { onOrdersRead } : {})}
        {...(checkoutSettings ? { checkoutSettings } : {})}
      />
    </div>
  )
}
