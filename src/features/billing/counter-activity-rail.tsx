import type { ReactNode } from 'react'

import type { BillingOrder } from '@/data-access/adapters'

import { CounterActivity } from './counter-activity'

/**
 * The outlet's pipeline, in one continuous rail: Preparing over Unpaid Prepared
 * Orders, whole-outlet scope.
 *
 * While the composer holds a saved order, the rail says so without a word of
 * explanation: it takes the same accent outline as the panel, the order under
 * edit leaves the ordinary lists, and its card slides out of the rail's own margin
 * to dock against the composer's column — left corners flattened, left border
 * dropped — so the two become one accent-outlined piece of work rather than two
 * panels that happen to be adjacent.
 *
 * The docked card sits **outside** both band scrollers, in a region of the rail
 * that never scrolls at all: scrolling either band's orders cannot move it.
 * That is also why neither this rail nor its bands' wrapper clips overflow — a
 * card that has to cross the gap cannot live in a box that clips at the gap.
 */
export function CounterActivityRail({
  refreshKey,
  editingOrder,
  onEditOrder,
  onActivityChanged,
  pin,
}: {
  refreshKey: number
  editingOrder: BillingOrder | null
  onEditOrder: (order: BillingOrder) => void
  /** The pipeline already reloads itself; notify the bills column only. */
  onActivityChanged: () => void
  /** The docked card, built by the composer that owns the draft it displays. */
  pin: ReactNode
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
      className="flex min-h-0 flex-col rounded-xl border border-border bg-surface"
    >
      {/*
        Pulled `--dock-overhang` past the rail's left border and given it straight
        back as padding, so the content sits exactly where it always did while the
        docked card keeps its reach across the gap.

        This wrapper no longer scrolls: the two bands inside it scroll their own
        lists (see OpenOrdersSurface), and the docked card above them lives in
        what is now an unmoving region by construction rather than by stickiness.
      */}
      <div
        style={{
          marginLeft: 'calc(var(--dock-overhang) * -1)',
          paddingLeft: 'calc(0.75rem + var(--dock-overhang))',
        }}
        className="flex min-h-0 flex-1 flex-col py-2 pr-3"
      >
        {editing && (
          <div
            style={{ marginLeft: 'calc(var(--dock-reach) * -1)' }}
            className="z-10 my-2 shrink-0 animate-[dock-in_200ms_ease-out] motion-reduce:animate-none"
          >
            {pin}
          </div>
        )}
        <CounterActivity
          refreshKey={refreshKey}
          editingOrderId={editingOrder?.id ?? null}
          onEditOrder={onEditOrder}
          onActivityChanged={onActivityChanged}
        />
      </div>
    </aside>
  )
}
