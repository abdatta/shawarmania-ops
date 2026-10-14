import { useState } from 'react'
import { OrderAgeRing } from '@/components/ui/order-age-ring'
import { ArrowRight, Check, ChevronDown, ChevronUp, Pencil, X, type LucideIcon } from 'lucide-react'

import { cn } from '@/lib/cn'
import type { KitchenOrder } from '@/data-access/adapters'
import {
  diffDishKitchenLines,
  formatKitchenWait,
  serviceTypeLabel,
  tableLabel,
  type KitchenCardState,
} from '@/domain'

import { RINGS_PER_ALERT, type RingState } from './ringer'
import { type ReadyPhase } from './use-kitchen-ready'

/**
 * One ticket on the dish ticks' board (each-dish-is-ticked-off, design D7, D9;
 * `dish-ticks`). Today's card is `KitchenCard`; this one adds a dish's note
 * under it, a later ticket's *#N · n*, the compact age ring, and — when the
 * board passes `onReady`, which it does only with `kitchen-ready` on — Done
 * beside the timer and the collapsed gray receipt it leaves.
 *
 * What follows is the first card's account, and still holds:
 *
 * One order, as a cook reads it from across a kitchen (#70, design D10).
 *
 * A ticket torn off the counter's pad: the number in the display face, coloured
 * by the card's state, a ring round the wait that fills towards twenty minutes,
 * then the dishes, quantity first in a tile. No price, no customer, no payment:
 * the board carries none.
 *
 * An alerting card wears its state three ways, never by colour alone: the
 * number's colour, a ribbon naming it, and an ACK in that same fill with its own
 * icon. **An edit is the bright amber**, which on light is far enough from the
 * ember that it cannot read as a new order (the deep amber could not, judged on
 * screen 2026-10-08). Inside an edit, whatever the cook must act on is the same
 * amber tile — an added dish, and a changed quantity with "1 → 2" beside it —
 * and a removed dish is struck through. A cancellation is stamped faintly over
 * its dishes, so they can still be read.
 *
 * While the order is still ringing its ACK wiggles, and three dots on it count
 * the rings down; once they are spent it waits, still, for the ACK.
 */

type Alert = Exclude<KitchenCardState, 'quiet'>

const LOOK: Record<
  Alert,
  { word: string; ack: string; icon: LucideIcon; fill: string; number: string; ring: string }
> = {
  new: {
    word: 'New',
    ack: 'ACK',
    icon: Check,
    fill: 'bg-primary text-on-primary',
    number: 'text-primary',
    ring: 'stroke-primary',
  },
  edited: {
    word: 'Edited',
    ack: 'ACK edit',
    icon: Pencil,
    fill: 'bg-kitchen-edit text-on-kitchen-edit',
    number: 'text-kitchen-edit-text',
    ring: 'stroke-kitchen-edit',
  },
  cancelled: {
    word: 'Cancelled',
    ack: 'ACK cancel',
    icon: X,
    fill: 'bg-kitchen-cancel text-on-kitchen-cancel',
    number: 'text-danger',
    ring: 'stroke-kitchen-cancel',
  },
}

const AMBER_TILE = 'bg-kitchen-edit text-on-kitchen-edit'
const AMBER_BADGE =
  'ml-auto inline-flex shrink-0 items-center gap-1 rounded-md bg-kitchen-edit/15 px-2 py-0.5 font-black tracking-wide text-kitchen-edit-text'

function serviceTag(order: KitchenOrder): string | null {
  if (order.tableNumber !== null) return tableLabel(order.tableNumber).toUpperCase()
  if (order.serviceType) return serviceTypeLabel(order.serviceType).toUpperCase()
  return null
}

export function DishKitchenCard({
  order,
  state,
  shake,
  rings,
  now,
  disabled,
  onReady,
  readyPhase,
  onAcknowledge,
}: {
  order: KitchenOrder
  state: KitchenCardState
  /**
   * Counts the times this card started alerting. The board keys the card by it,
   * so a new alert remounts it and the shake replays from the start.
   */
  shake: number
  rings: RingState
  now: Date
  disabled: boolean
  onReady?: () => void
  readyPhase?: ReadyPhase
  onAcknowledge: () => void
}) {
  const done = Boolean(order.readyId)
  const saving = readyPhase === 'saving'
  const departing = readyPhase === 'leaving' || readyPhase === 'gap'
  const [expanded, setExpanded] = useState(false)
  const collapsed = done && !expanded
  const dimmed = done || Boolean(readyPhase)
  const checked = done || saving
  const alerting = !done && state !== 'quiet'
  const look = alerting ? LOOK[state] : null
  const tag = serviceTag(order)
  const ringing = rings.left > 0 || rings.sounding
  const dotsLit = Math.min(RINGS_PER_ALERT, rings.left + (rings.sounding ? 1 : 0))
  const rows =
    state === 'edited' && order.latestAck
      ? diffDishKitchenLines(order.lines, order.latestAck.lines)
      : state === 'cancelled' && order.lines.length === 0 && order.latestAck
        ? diffDishKitchenLines([], order.latestAck.lines)
        : diffDishKitchenLines(order.lines, order.lines)

  return (
    <div
      className={cn(
        'relative drop-shadow-md',
        !readyPhase && alerting && shake > 0 && 'kitchen-shake',
        readyPhase === 'leaving' && 'kitchen-ready-exit',
        readyPhase === 'gap' && 'invisible pointer-events-none',
      )}
      aria-hidden={readyPhase === 'gap' || undefined}
      // The board keeps each card in its column; a Done receipt and the ticket
      // it reopens into belong to one order, and one takes the other's place.
      data-masonry-key={order.id}
      data-masonry-group={order.sourceOrderId ?? order.id}
    >
      <article
        data-testid={
          done
            ? `kitchen-done-${order.orderNumber}-${order.ticketNumber ?? 1}`
            : `kitchen-card-${order.orderNumber}`
        }
        data-order-id={order.id}
        data-state={state}
        data-ready-phase={readyPhase}
        data-done={done || undefined}
        data-collapsed={collapsed || undefined}
        aria-label={`Order ${order.orderNumber}${done ? ', done' : alerting ? `, ${state}` : ''}`}
        onClick={done && !departing ? () => setExpanded((value) => !value) : undefined}
        className={cn(
          'kitchen-ticket flex flex-col overflow-hidden rounded-t-sm rounded-b-2xl transition-colors duration-150',
          done && 'cursor-pointer',
          dimmed ? 'bg-surface-raised text-content-muted' : 'bg-surface text-content',
        )}
      >
        <header
          className={cn('flex items-start justify-between gap-2 px-4 pt-6', collapsed && 'pb-4')}
        >
          <span className={cn('font-display text-5xl leading-none', !dimmed && look?.number)}>
            #{order.orderNumber}
            {(order.ticketNumber ?? 1) > 1 && (
              <span className="text-3xl"> · {order.ticketNumber}</span>
            )}
          </span>
          {onReady && state !== 'cancelled' ? (
            <div className="flex shrink-0 items-center gap-1">
              {done ? (
                <button
                  type="button"
                  aria-label={`${expanded ? 'Collapse' : 'Expand'} done order ${order.orderNumber}`}
                  aria-expanded={expanded}
                  disabled={departing}
                  onClick={(event) => {
                    event.stopPropagation()
                    setExpanded(!expanded)
                  }}
                  className="grid size-14 cursor-pointer place-items-center rounded-full hover:bg-surface focus-visible:focus-ring"
                >
                  {expanded ? (
                    <ChevronUp aria-hidden size={24} />
                  ) : (
                    <ChevronDown aria-hidden size={24} />
                  )}
                </button>
              ) : (
                <OrderAgeRing
                  orderedAt={order.orderedAt}
                  now={now}
                  normalRing={look?.ring ?? 'stroke-content-muted'}
                />
              )}
              <button
                type="button"
                disabled={disabled || saving || readyPhase === 'leaving' || readyPhase === 'gap'}
                onClick={(event) => {
                  event.stopPropagation()
                  onReady()
                }}
                aria-label={`Ready order ${order.orderNumber}`}
                aria-pressed={checked}
                title={done ? 'Undo Done' : 'Mark done'}
                className="relative grid size-14 shrink-0 cursor-pointer place-items-center rounded-full transition-[transform,box-shadow] hover:shadow-sm active:scale-95 focus-visible:focus-ring disabled:opacity-50"
              >
                <svg aria-hidden viewBox="0 0 56 56" className="size-14 -rotate-90">
                  <circle
                    cx="28"
                    cy="28"
                    r={21}
                    strokeWidth={5}
                    className={cn(
                      'transition-[fill,stroke] duration-150',
                      checked
                        ? 'stroke-success fill-success'
                        : 'stroke-content-muted fill-surface-raised',
                    )}
                  />
                </svg>
                <span
                  aria-hidden
                  className={cn(
                    'pointer-events-none absolute inset-0 grid place-items-center',
                    checked ? 'text-on-success' : 'text-content-muted',
                  )}
                >
                  <Check size={24} strokeWidth={3} />
                </span>
              </button>
            </div>
          ) : (
            <OrderAgeRing
              orderedAt={order.orderedAt}
              now={now}
              normalRing={look?.ring ?? 'stroke-content-muted'}
            />
          )}
        </header>

        {!collapsed && (
          <>
            <div
              className={cn(
                'flex min-h-8 items-center gap-2 pl-4 pt-1',
                dimmed && 'text-content-muted',
              )}
            >
              {tag && (
                <span className="rounded-md border-[1.5px] border-border px-2 py-0.5 text-sm font-extrabold tracking-wide">
                  {tag}
                </span>
              )}
              {look && (
                <span
                  className={cn(
                    'ml-auto py-1 pl-5 pr-3 text-sm font-black uppercase tracking-widest',
                    '[clip-path:polygon(10px_0,100%_0,100%_100%,10px_100%,0_50%)]',
                    look.fill,
                  )}
                >
                  {look.word}
                </span>
              )}
            </div>

            <hr className="mx-3 mt-3 border-0 border-t-2 border-dashed border-border" />

            <div className={cn('relative flex flex-1 flex-col', dimmed && 'text-content-muted')}>
              <div className="px-4 pt-3">
                <ul className="grid gap-2.5">
                  {rows.map((row) => {
                    const amber = row.change === 'added' || row.change === 'changed'
                    return (
                      <li
                        key={row.key}
                        data-change={row.change}
                        className={cn(
                          'flex items-center gap-3 text-xl font-semibold leading-snug',
                          row.change === 'removed' && 'text-content-muted line-through',
                          state === 'cancelled' && 'line-through decoration-danger',
                        )}
                      >
                        <span
                          className={cn(
                            'grid h-11 min-w-11 shrink-0 place-items-center rounded-xl px-1 text-2xl font-black tabular-nums',
                            amber
                              ? AMBER_TILE
                              : row.change === 'removed'
                                ? 'border-2 border-dashed border-border text-content-muted'
                                : 'bg-surface-raised',
                          )}
                        >
                          {row.change === 'removed' ? row.previousQuantity : row.quantity}
                        </span>
                        <span className="min-w-0 flex-1">
                          {row.itemName}
                          {row.note && (
                            <span
                              className={cn(
                                'block text-base font-bold',
                                dimmed ? 'text-content-muted' : 'text-accent-text',
                              )}
                            >
                              {row.note}
                            </span>
                          )}
                        </span>
                        {row.change === 'added' && (
                          <span className={cn(AMBER_BADGE, 'text-xs')}>ADDED</span>
                        )}
                        {row.change === 'changed' && (
                          <span
                            className={cn(AMBER_BADGE, 'text-base')}
                            aria-label={`was ${row.previousQuantity}, now ${row.quantity}`}
                          >
                            {row.previousQuantity}
                            <ArrowRight aria-hidden size={15} strokeWidth={3} />
                            {row.quantity}
                          </span>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </div>

              {order.otherItemCount > 0 && (
                <p className="px-4 pt-2 text-sm text-content-muted">
                  +{order.otherItemCount} {order.otherItemCount === 1 ? 'item' : 'items'} for
                  another kitchen
                </p>
              )}

              {/* Stamped where a hand would stamp a paper ticket: the middle of
              everything between the tear line and the ACK. The card is as tall
              as its row, so on a short ticket it lands on the dishes and on a
              tall one in the space beneath them. */}
              {state === 'cancelled' && (
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 grid place-items-center"
                >
                  <span className="-rotate-[8deg] rounded-xl border-4 border-kitchen-cancel/35 px-3 font-display text-3xl tracking-widest text-kitchen-cancel/35">
                    CANCELLED
                  </span>
                </div>
              )}
            </div>

            <footer className={cn('px-4 pb-4 pt-4', dimmed && 'grayscale')}>
              {look ? (
                <button
                  type="button"
                  onClick={onAcknowledge}
                  disabled={disabled || Boolean(readyPhase)}
                  data-ringing={ringing || undefined}
                  // Several cards say ACK at once; a screen reader hears which order.
                  aria-label={`${look.ack} order ${order.orderNumber}`}
                  className={cn(
                    'flex min-h-15 w-full items-center gap-2.5 rounded-2xl px-5 text-xl font-black disabled:opacity-50',
                    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content',
                    look.fill,
                    ringing && !disabled && !readyPhase && 'kitchen-ringing',
                  )}
                >
                  <look.icon aria-hidden size={22} strokeWidth={3} />
                  {look.ack}
                  <span aria-hidden data-testid="kitchen-rings" className="ml-auto flex gap-1.5">
                    {Array.from({ length: RINGS_PER_ALERT }, (_, index) => (
                      <i
                        key={index}
                        className={cn(
                          'size-2.5 rounded-full bg-current',
                          index >= dotsLit && 'opacity-30',
                        )}
                      />
                    ))}
                  </span>
                </button>
              ) : (
                !done &&
                order.latestAck && (
                  <p className="flex items-center gap-2 text-sm font-bold text-content-muted">
                    <Check aria-hidden size={16} strokeWidth={3} />
                    Acked {formatKitchenWait(order.latestAck.ackedAt, now)} ago
                  </p>
                )
              )}
            </footer>
          </>
        )}
      </article>
    </div>
  )
}
