import type { ReactNode } from 'react'

import type { BillingOrder } from '@/data-access/adapters'

import { MyShiftSurface } from './my-shift-surface'
import { OpenOrdersHeading, OpenOrdersSurface } from './open-orders-surface'

/**
 * Open work above closed work: this tablet's unpaid orders, then the bills its
 * current shift has taken.
 *
 * Extracted from the rail so the composition — heading, open orders, divider,
 * this shift's bills — is stated once, and so the rail's own file is left saying
 * only what is particular to it: the accent-outlined card docked against the
 * composer.
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
      <OpenOrdersHeading embedded />
      {pin}
      <div className="mt-2">
        <OpenOrdersSurface
          embedded
          hideHeading
          refreshKey={refreshKey}
          editingOrderId={editingOrderId}
          {...(onEditOrder ? { onEditOrder } : {})}
          {...(onActivityChanged ? { onActivityChanged } : {})}
        />
      </div>
      <div className="my-4 border-t border-border" role="separator" />
      <MyShiftSurface
        embedded
        refreshKey={refreshKey}
        {...(onActivityChanged ? { onActivityChanged } : {})}
      />
    </>
  )
}
