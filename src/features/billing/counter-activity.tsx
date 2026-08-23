import type { ReactNode } from 'react'

import type { BillingOrder } from '@/data-access/adapters'

import { OpenOrdersSurface } from './open-orders-surface'

/**
 * The right rail's whole content: the outlet's pipeline.
 *
 * Money history left this rail — it is the middle column's default content now
 * — so what remains is exactly the slice a future kitchen screen would mirror:
 * Preparing above a labelled divider, Unpaid Prepared Orders below.
 *
 * While the composer holds a saved order, its card still docks out of this
 * rail against the composer's column, exactly as before: the card under edit
 * leaves the ordinary lists and slides out of the rail's own margin so the two
 * become one accent-outlined piece of work rather than two panels that happen
 * to be adjacent. It sits **outside** the scroller for the same reason as
 * always — scrolling the rail must never scroll the order being edited away.
 */
export function CounterActivity({
  refreshKey,
  editingOrderId = null,
  onEditOrder,
  onActivityChanged,
  /** The docked card for an order under edit. Rail only; nothing edits from the tab. */
  pin,
}: {
  refreshKey: number
  editingOrderId?: string | null
  onEditOrder?: (order: BillingOrder) => void
  onActivityChanged?: () => void
  pin?: ReactNode
}) {
  return (
    <>
      {pin}
      <div className={pin ? 'mt-2' : undefined}>
        <OpenOrdersSurface
          embedded
          refreshKey={refreshKey}
          editingOrderId={editingOrderId}
          {...(onEditOrder ? { onEditOrder } : {})}
          {...(onActivityChanged ? { onActivityChanged } : {})}
        />
      </div>
    </>
  )
}
