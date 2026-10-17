import type { ReactNode } from 'react'

import type { BillingOrder, OutletMenu } from '@/data-access/adapters'

import { CounterActivity } from './counter-activity'

/**
 * The outlet's pipeline, in one continuous rail: one list of every unfinished
 * order, newest first, whole-outlet scope.
 *
 * While the composer holds a saved order, the rail pins it over its right
 * column, beside the composer laid over its left (each-dish-is-ticked-off,
 * design R7). The pinned card sits **outside** the list's scroller, so
 * scrolling the pipeline cannot move it.
 */
export function CounterActivityRail({
  refreshKey,
  ownSaveKey = 0,
  savedOrderKey = 0,
  editingOrder,
  onEditOrder,
  onSetOrderCustomer,
  onActivityChanged,
  onOrdersRead,
  pin,
  asOf,
  checkoutSettings,
}: {
  refreshKey: number
  /**
   * Bumped by this tablet's own saves: the rail draws
   * what the tablet holds, then asks the server (the-counter-shows-what-it-saved).
   */
  ownSaveKey?: number
  /** Bumped only when an order is saved on this tablet. */
  savedOrderKey?: number
  editingOrder: BillingOrder | null
  onEditOrder: (order: BillingOrder) => void
  /** Edit, opened straight onto the customer dialog. */
  onSetOrderCustomer: (order: BillingOrder) => void
  /** The pipeline already reloads itself; notify the bills column only. */
  onActivityChanged: () => void
  onOrdersRead?: (orders: BillingOrder[]) => void
  /** The docked card, built by the composer that owns the draft it displays. */
  pin: ReactNode
  asOf?: string
  checkoutSettings?: Pick<OutletMenu, 'service' | 'loyalty'>
}) {
  const editing = editingOrder !== null

  return (
    <aside
      id="counter-activity-rail"
      aria-label="The pipeline"
      data-testid="counter-activity-rail"
      /*
        Deliberately not accent-outlined during an edit. The accent marks what is
        being edited — the composer and the card docked to it. Outlining the rail
        as well would sweep this shift's bills and every other open order into the
        same highlight, which says the opposite of what the highlight is for.
      */
      className="relative flex min-h-0 flex-col rounded-xl border border-border bg-surface"
    >
      {asOf && (
        <p
          className="px-3 pt-2 text-xs font-semibold text-content-muted"
          data-testid="pipeline-as-of"
        >
          Outlet pipeline as of {new Date(asOf).toLocaleString()}
        </p>
      )}
      {/*
        This wrapper does not scroll: the list inside it scrolls its own orders
        (see DishOpenOrdersSurface), and the pinned card lives above it in a
        region that never moves.
      */}
      <div className="flex min-h-0 flex-1 flex-col px-3 py-2">
        {editing && (
          <div className="absolute right-3 top-2 z-20 w-[calc((100%-2.25rem)/2)]">{pin}</div>
        )}
        <CounterActivity
          refreshKey={refreshKey}
          ownSaveKey={ownSaveKey}
          savedOrderKey={savedOrderKey}
          editingOrderId={editingOrder?.id ?? null}
          onEditOrder={onEditOrder}
          onSetOrderCustomer={onSetOrderCustomer}
          onActivityChanged={onActivityChanged}
          {...(onOrdersRead ? { onOrdersRead } : {})}
          {...(checkoutSettings ? { checkoutSettings } : {})}
        />
      </div>
    </aside>
  )
}
