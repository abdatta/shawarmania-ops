import type { ReactNode } from 'react'

import type { BillLineDraft, BillingOrder } from '@/data-access/adapters'

import { OpenOrderCardBody } from './open-order-card-body'

/**
 * The order under edit, as one card docked against the current-bill column.
 *
 * It is the same card the Open orders list draws — same body, same order — after
 * it has moved: nothing about it is redrawn or re-styled on arrival except the
 * accent border it shares with the two columns it now spans. Its left edge is
 * flat and borderless because that edge is the composer.
 *
 * The body reads from the **live** draft, not from the saved order. Two copies of
 * an order sitting a few centimetres apart, one of them stale, is the kind of
 * thing a biller only notices after taking the wrong money — so the card shows
 * what the composer currently holds and the only immutable facts on it are the
 * order's reference and when it was taken.
 *
 * Its item list is off: the composer next to it is showing those same items and
 * is where they are changed. Dropping the list is also what keeps this card close
 * to the height of the list card it replaces, since the composer footer arriving
 * below costs about what the items cost.
 *
 * That footer lives here for the duration of the edit, which is why this card
 * carries the customer fields and the terminal actions: the order being changed
 * and the controls that finish the change belong together. The footer omits its
 * own total, because the total is already at the top of this card.
 */
export function EditingOrderPin({
  order,
  lines,
  customerName,
  footer,
}: {
  order: BillingOrder
  lines: BillLineDraft[]
  customerName: string
  footer: ReactNode
}) {
  return (
    <article
      data-testid="editing-order-pin"
      className="rounded-l-none rounded-r-xl border-2 border-l-0 border-primary bg-surface-raised p-3"
    >
      <OpenOrderCardBody
        orderNumber={order.orderNumber}
        orderedAt={order.orderedAt}
        customerName={customerName.trim() === '' ? null : customerName}
        lines={lines}
        showLines={false}
      />
      <div className="mt-2 border-t border-border pt-2">{footer}</div>
    </article>
  )
}
