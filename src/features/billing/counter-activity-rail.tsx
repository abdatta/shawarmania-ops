import { useCallback, useState, type ReactNode } from 'react'

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
 * The docked card sits **outside** this rail's scroller, so the biller can scroll
 * the whole pipeline and it cannot go out of view. That is also why the rail no
 * longer clips its own overflow: a card that has to cross the gap cannot live in
 * a box that clips at the gap.
 */
export function CounterActivityRail({
  refreshKey,
  editingOrder,
  onEditOrder,
  pin,
}: {
  refreshKey: number
  editingOrder: BillingOrder | null
  onEditOrder: (order: BillingOrder) => void
  /** The docked card, built by the composer that owns the draft it displays. */
  pin: ReactNode
}) {
  const [localRefresh, setLocalRefresh] = useState(0)
  const refresh = useCallback(() => setLocalRefresh((value) => value + 1), [])
  const combinedRefresh = refreshKey + localRefresh

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
        scroller's clip now reaches the composer. Without that, a card docking
        against the panel would simply be cut off at this column's own border.

        `rounded-br-xl` because the aside no longer clips, and a scrollbar is what
        would otherwise square off the corner it reaches.
      */}
      <div
        style={{
          marginLeft: 'calc(var(--dock-overhang) * -1)',
          paddingLeft: 'calc(0.75rem + var(--dock-overhang))',
        }}
        className="min-h-0 flex-1 overflow-y-auto rounded-br-xl py-3 pr-3"
      >
        <CounterActivity
          refreshKey={combinedRefresh}
          editingOrderId={editingOrder?.id ?? null}
          onEditOrder={onEditOrder}
          onActivityChanged={refresh}
          pin={
            editing && (
              /*
            Directly under the heading, which is the place the card occupied in
            the list — so it stays where the biller left it and scrolls with the
            rail as they look through the rest of it, pinning at the top edge only
            once scrolling would take it out of view and releasing again on the
            way back. This is a child of the scroller rather than of the list
            because that is what gives it a sticky range covering the whole
            column.

            `--dock-reach` seats it against the composer's column; the `dock-in`
            keyframe starts it back at the list's own inset, so arriving reads as
            that card moving rather than as a new one appearing.

            No padding of its own: the card is opaque and fills this box, so
            nothing shows through while it is pinned.
          */
              <div
                style={{ marginLeft: 'calc(var(--dock-reach) * -1)' }}
                className="sticky top-0 z-10 my-2 animate-[dock-in_200ms_ease-out] motion-reduce:animate-none"
              >
                {pin}
              </div>
            )
          }
        />
      </div>
    </aside>
  )
}
