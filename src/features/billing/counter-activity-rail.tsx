import { useCallback, useState } from 'react'

import type { BillingOrder } from '@/data-access/adapters'

import { MyShiftSurface } from './my-shift-surface'
import { OpenOrdersSurface } from './open-orders-surface'

/** Open work above closed work, in one continuous tablet-side activity rail. */
export function CounterActivityRail({
  refreshKey,
  editingOrderId,
  onEditOrder,
}: {
  refreshKey: number
  editingOrderId: string | null
  onEditOrder: (order: BillingOrder) => void
}) {
  const [localRefresh, setLocalRefresh] = useState(0)
  const refresh = useCallback(() => setLocalRefresh((value) => value + 1), [])
  const combinedRefresh = refreshKey + localRefresh

  return (
    <aside
      aria-label="Orders and bills"
      data-testid="counter-activity-rail"
      className="order-3 hidden min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-surface lg:flex"
    >
      <header className="border-b border-border px-3 py-2">
        <h2 className="text-sm font-black text-content">Orders &amp; bills</h2>
        <p className="text-xs text-content-muted">
          Open work first, then this shift&rsquo;s bills.
        </p>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <OpenOrdersSurface
          embedded
          refreshKey={combinedRefresh}
          editingOrderId={editingOrderId}
          onEditOrder={onEditOrder}
          onActivityChanged={refresh}
        />
        <div className="my-4 border-t border-border" role="separator" />
        <MyShiftSurface embedded refreshKey={combinedRefresh} onActivityChanged={refresh} />
      </div>
    </aside>
  )
}
