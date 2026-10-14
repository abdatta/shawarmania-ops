import { Bell, Check, CheckCheck, SquareCheck, type LucideIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Chip, type ChipTone } from '@/components/ui/chip'
import { MemberMark } from '@/components/ui/member-mark'
import { Money } from '@/components/ui/money'
import type { BillingOrder, KitchenMarks } from '@/data-access/adapters'
import { useChangeGate } from '@/change-gates/context'
import {
  dishAge,
  formatDayTime,
  serviceTypeLabel,
  tableLabel,
  type KitchenDishState,
} from '@/domain'
import { formatIndianPhone } from '../../../shared/phone'

/**
 * An open order on the owner's Orders tab, with the dish ticks on
 * (each-dish-is-ticked-off, design R11; `dish-ticks`).
 *
 * The owner reads this away from the outlet, so it says what the counter's
 * card shows, in words where the counter has room only for icons: paid or not,
 * each kitchen's answer, and each dish in one of four states — placed,
 * acknowledged, Done or handed over (owner, 2026-10-14) — in the counter's own
 * marks: ✓, ✓✓, the bell, a ticked box. Compact,
 * because there is more on it than there was: one header, one line of chips,
 * one row per dish, one line for the customer. Read when the tab opens, like
 * the rest of the page, never live.
 */
export function DishOpenOrderSummary({
  order,
  marks,
  now,
  onCancel,
}: {
  order: BillingOrder
  /** The outlet's kitchens as the counter reads them; null if that read failed. */
  marks: KitchenMarks | null
  /** When the page was read: the age is as of then. */
  now: Date
  /** Opens the page's cancellation; absent while it is open. */
  onCancel?: () => void
}) {
  const readyOn = useChangeGate('kitchen-ready')
  const readyQuantities = marks?.readyQuantities?.[order.id] ?? {}
  const acked = new Set(marks?.ackedLines?.[order.id] ?? [])
  const kitchens = (marks?.kitchens ?? [])
    .map((kitchen, index) => ({ kitchen, state: marks?.dishStates?.[order.id]?.[index] ?? null }))
    .filter((slot): slot is { kitchen: { id: string; label: string }; state: KitchenDishState } =>
      Boolean(slot.state),
    )
  const place =
    order.tableNumber !== null && order.tableNumber !== undefined
      ? tableLabel(order.tableNumber)
      : order.serviceType
        ? serviceTypeLabel(order.serviceType)
        : null
  const dishes = order.lines.filter((line) => line.kind !== 'packaging')
  const bags = order.lines.filter((line) => line.kind === 'packaging')

  return (
    <div className="space-y-2" data-testid={`manager-dish-order-${order.orderNumber}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex min-w-0 items-baseline gap-2">
            <span className="shrink-0 text-xl font-black text-content">
              Order {order.orderNumber}
            </span>
            {order.label && (
              <span className="truncate text-sm font-black text-content">{order.label}</span>
            )}
          </p>
          <p className="mt-0.5 text-xs text-content-muted">
            {formatDayTime(order.orderedAt)} · {dishAge(order.orderedAt, now)} · by{' '}
            {order.creatorName}
            {place && ` · ${place}`}
          </p>
        </div>
        <Money paise={order.totalPaise} display className="shrink-0" />
      </div>

      <div className="flex flex-wrap gap-1.5" aria-label="Status">
        {order.status === 'paid' ? (
          <Chip tone="good" icon={Check} data-testid={`manager-order-paid-${order.orderNumber}`}>
            Paid
          </Chip>
        ) : (
          <Chip data-testid={`manager-order-paid-${order.orderNumber}`}>Not paid</Chip>
        )}
        {kitchens.map(({ kitchen, state }) => {
          const shown = KITCHEN[state === 'ready' && !readyOn ? 'acknowledged' : state]
          return (
            <Chip
              key={kitchen.id}
              tone={shown.tone}
              icon={shown.icon}
              data-testid={`manager-order-kitchen-${order.orderNumber}`}
            >
              {kitchen.label} · {shown.word}
            </Chip>
          )
        })}
      </div>

      <ul className="divide-y divide-border rounded-xl border border-border px-3">
        {dishes.map((line, index) => {
          const prepared = line.preparedQuantity ?? 0
          const ready = readyQuantities[line.orderLineId ?? ''] ?? line.readyQuantity ?? 0
          const dish: DishShown =
            prepared >= line.quantity
              ? DISH.handed
              : readyOn && ready > prepared
                ? DISH.done
                : acked.has(line.orderLineId ?? '')
                  ? DISH.acknowledged
                  : DISH.placed
          return (
            <li
              key={line.orderLineId ?? `${line.menuItemId}-${index}`}
              data-dish-state={dish.state}
              className="grid grid-cols-[auto_1fr_auto] items-start gap-x-2 py-1.5"
            >
              <span title={dish.title} className="mt-0.5">
                <dish.icon aria-hidden size={15} strokeWidth={2.5} className={dish.className} />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold leading-snug text-content">
                  {line.quantity} × {line.itemName}
                  <span className="sr-only">, {dish.word}</span>
                  {prepared > 0 && prepared < line.quantity && (
                    <span className="ml-1.5 text-xs font-normal text-content-muted">
                      {prepared} handed over
                    </span>
                  )}
                </p>
                {line.note && (
                  <p className="text-xs font-semibold leading-snug text-accent-text">{line.note}</p>
                )}
              </div>
              <Money
                paise={line.unitPricePaise * line.quantity}
                className="text-sm font-bold text-content"
              />
            </li>
          )
        })}
        {bags.map((line, index) => (
          <li
            key={`bag-${index}`}
            className="grid grid-cols-[auto_1fr_auto] items-start gap-x-2 py-1.5"
          >
            <span aria-hidden className="w-[15px]" />
            <p className="text-sm text-content-muted">
              {line.quantity} × {line.itemName}
            </p>
            <Money
              paise={line.unitPricePaise * line.quantity}
              className="text-sm font-bold text-content"
            />
          </li>
        ))}
      </ul>

      <div className="flex items-center gap-2">
        <p className="flex min-w-0 flex-1 items-center gap-1.5 text-sm text-content">
          {order.customerName || order.customerPhone ? (
            <>
              <span className="truncate font-semibold">
                {[
                  order.customerName,
                  order.customerPhone && `+91 ${formatIndianPhone(order.customerPhone)}`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
              {order.customerTier === 'gold' && <MemberMark />}
            </>
          ) : (
            <span className="text-content-muted">No customer details yet</span>
          )}
        </p>
        {onCancel && (
          <Button
            variant="secondary"
            size="phone"
            className="shrink-0 text-danger"
            aria-label={`Cancel order ${order.orderNumber}`}
            onClick={onCancel}
          >
            Cancel order
          </Button>
        )}
      </div>
    </div>
  )
}

interface DishShown {
  state: 'placed' | 'acknowledged' | 'done' | 'handed_over'
  word: string
  /** Said on hover, for the owner who has not learned the marks. */
  title: string
  icon: LucideIcon
  className: string
}

/** A dish's four states, in the counter's marks for them. */
const DISH: Record<'placed' | 'acknowledged' | 'done' | 'handed', DishShown> = {
  placed: {
    state: 'placed',
    word: 'placed, not acknowledged yet',
    title: 'Placed: sent to the kitchen, not acknowledged yet',
    icon: Check,
    className: 'text-content-muted',
  },
  acknowledged: {
    state: 'acknowledged',
    word: 'acknowledged by the kitchen',
    title: 'Acknowledged: the kitchen is making it',
    icon: CheckCheck,
    className: 'text-primary',
  },
  done: {
    state: 'done',
    word: 'done, ready to hand over',
    title: 'Done: ready to hand over',
    icon: Bell,
    className: 'text-primary',
  },
  handed: {
    state: 'handed_over',
    word: 'handed over',
    title: 'Handed over',
    icon: SquareCheck,
    className: 'text-primary',
  },
}

/** Each kitchen's answer, in the words the counter's icons stand for. */
const KITCHEN: Record<KitchenDishState, { word: string; tone: ChipTone; icon: LucideIcon }> = {
  sent: { word: 'sent', tone: 'neutral', icon: Check },
  acknowledged: { word: 'seen', tone: 'good', icon: CheckCheck },
  ready: { word: 'ready', tone: 'warn', icon: Bell },
  handed_over: { word: 'served', tone: 'neutral', icon: CheckCheck },
}
