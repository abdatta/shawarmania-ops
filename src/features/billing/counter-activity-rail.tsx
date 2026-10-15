import type { ReactNode } from 'react'

import type { BillingOrder, OutletMenu } from '@/data-access/adapters'

import { CounterActivity } from './counter-activity'

/**
 * The outlet's pipeline, in one continuous rail: one list of every unfinished
 * order, newest first, whole-outlet scope.
 *
 * While the composer holds a saved order, the rail says so without a word of
 * explanation: it takes the same accent outline as the panel, the order under
 * edit leaves the ordinary lists, and its card slides out of the rail's own margin
 * to dock against the composer's column — left corners flattened, left border
 * dropped — so the two become one accent-outlined piece of work rather than two
 * panels that happen to be adjacent.
 *
 * The docked card sits **outside** the list's scroller, in a region of the rail
 * that never scrolls at all: scrolling the pipeline cannot move it. That is also
 * why neither this rail nor the list's wrapper clips overflow — a card that has
 * to cross the gap cannot live in a box that clips at the gap.
 */
export function CounterActivityRail({
  twoColumns = false,
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
  twoColumns?: boolean
  refreshKey: number
  /**
   * Bumped by this tablet's own saves, with `instant-saves` on: the rail draws
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
      className={
        twoColumns
          ? 'relative flex min-h-0 flex-col rounded-xl border border-border bg-surface'
          : 'flex min-h-0 flex-col rounded-xl border border-border bg-surface'
      }
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
        Pulled `--dock-overhang` past the rail's left border and given it straight
        back as padding, so the content sits exactly where it always did while the
        docked card keeps its reach across the gap.

        This wrapper no longer scrolls: the list inside it scrolls its own
        orders (see OpenOrdersSurface), and the docked card above it lives in
        what is now an unmoving region by construction rather than by stickiness.
      */}
      <div
        style={{
          marginLeft: twoColumns ? 0 : 'calc(var(--dock-overhang) * -1)',
          paddingLeft: twoColumns ? '0.75rem' : 'calc(0.75rem + var(--dock-overhang))',
        }}
        className="flex min-h-0 flex-1 flex-col py-2 pr-3"
      >
        {editing && (
          <div
            style={{ marginLeft: twoColumns ? 0 : 'calc(var(--dock-reach) * -1)' }}
            className={
              twoColumns
                ? 'absolute right-3 top-2 z-20 w-[calc((100%-2.25rem)/2)]'
                : 'z-10 my-2 shrink-0 animate-[dock-in_200ms_ease-out] motion-reduce:animate-none'
            }
          >
            {pin}
          </div>
        )}
        <CounterActivity
          twoColumns={twoColumns}
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
