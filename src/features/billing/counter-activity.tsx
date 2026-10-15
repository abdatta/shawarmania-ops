import type { BillingOrder, OutletMenu } from '@/data-access/adapters'

import { DishOpenOrdersSurface } from './dish-open-orders-surface'
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
 *
 * With the dish ticks on (`twoColumns`, each-dish-is-ticked-off) the rail is
 * their own, in two columns; off, it is today's.
 */
export function CounterActivity({
  twoColumns = false,
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
  twoColumns?: boolean
  refreshKey: number
  /** This tablet's own saves, for the dish ticks' rail (`instant-saves`). */
  ownSaveKey?: number
  /** Bumped only when an order is saved on this tablet. */
  savedOrderKey?: number
  editingOrderId?: string | null
  onEditOrder?: (order: BillingOrder) => void
  onSetOrderCustomer?: (order: BillingOrder) => void
  onActivityChanged?: () => void
  /** The dish ticks' rail hands its orders up, so the label warning reads them, not the server. */
  onOrdersRead?: (orders: BillingOrder[]) => void
  checkoutSettings?: Pick<OutletMenu, 'service' | 'loyalty'>
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {twoColumns ? (
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
      ) : (
        <OpenOrdersSurface
          embedded
          refreshKey={refreshKey}
          savedOrderKey={savedOrderKey}
          editingOrderId={editingOrderId}
          {...(onEditOrder ? { onEditOrder } : {})}
          {...(onSetOrderCustomer ? { onSetOrderCustomer } : {})}
          {...(onActivityChanged ? { onActivityChanged } : {})}
          {...(checkoutSettings ? { checkoutSettings } : {})}
        />
      )}
    </div>
  )
}
