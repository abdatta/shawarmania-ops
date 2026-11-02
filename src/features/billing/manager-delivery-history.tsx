import { Bike, ChefHat, ChevronDown } from 'lucide-react'
import { useEffect, useState } from 'react'

import { EmptyState } from '@/components/layout/empty-state'
import { LoadingRegion, Shimmer } from '@/components/ui/loading'
import { useAdapters } from '@/data-access'
import type { DeliveryDayStats, DeliveryHistoryOrder } from '@/data-access/adapters'
import { formatDayTime } from '@/domain'
import { cn } from '@/lib/cn'

import { formatStatDuration } from './manager-day-stats'

/**
 * Billing history → Delivery (delivery-orders-are-made-not-billed, D7): the
 * day's handed-over and cancelled delivery orders, each with its label, dishes,
 * who rang it, who handed it over or cancelled it, and any take-back. No money.
 */
export function ManagerDeliveryHistory({
  outletId,
  businessDate,
}: {
  outletId: string
  businessDate: string
}) {
  const { billing } = useAdapters()
  const key = `${outletId}:${businessDate}`
  const [read, setRead] = useState<{
    key: string
    orders: DeliveryHistoryOrder[] | 'failed'
  } | null>(null)

  useEffect(() => {
    let active = true
    void billing.listDeliveryHistory(outletId, businessDate).then(
      (orders) => active && setRead({ key, orders }),
      () => active && setRead({ key, orders: 'failed' }),
    )
    return () => {
      active = false
    }
  }, [billing, outletId, businessDate, key])

  const orders = read?.key === key ? read.orders : null
  if (orders === null) return <ManagerDeliveryHistoryShimmer />
  if (orders === 'failed')
    return (
      <p
        role="status"
        className="rounded-lg border border-border bg-surface p-3 text-sm font-semibold text-content"
      >
        Could not load the delivery orders. Try again in a moment.
      </p>
    )
  if (orders.length === 0) return <EmptyState icon={Bike} title="No delivery orders on this day." />
  return (
    <ul className="space-y-2" data-testid="manager-delivery-list">
      {orders.map((order) => (
        <DeliveryHistoryRow key={order.orderId} order={order} />
      ))}
    </ul>
  )
}

function DeliveryHistoryRow({ order }: { order: DeliveryHistoryOrder }) {
  const [open, setOpen] = useState(false)
  const handedOver = order.status === 'handed_over'
  return (
    <li
      data-testid={`manager-delivery-${order.orderNumber}`}
      className="overflow-hidden rounded-xl border border-border bg-surface"
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-20 w-full items-center gap-3 p-3 text-left focus-visible:focus-ring"
      >
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-black text-content">Order {order.orderNumber}</span>
            <span
              className={cn(
                'rounded-full border px-2 py-0.5 text-xs font-bold',
                // Handed over is delivery's own blue; cancelled is red, as a bill's.
                handedOver
                  ? 'delivery-theme border-primary text-primary'
                  : 'border-danger text-danger',
              )}
            >
              {handedOver ? 'Handed over' : 'Cancelled'}
            </span>
            {order.label && (
              <span className="truncate text-sm font-semibold text-content-muted">
                {order.label}
              </span>
            )}
          </span>
          <span className="mt-1 block text-sm text-content-muted">
            {handedOver
              ? `${formatDayTime(order.handedOverAt!)} · by ${order.handedOverByName ?? 'unknown'}`
              : `${formatDayTime(order.cancelledAt!)} · by ${order.cancelledByName ?? 'unknown'}`}
          </span>
        </span>
        <ChevronDown
          aria-hidden
          size={18}
          className={cn('shrink-0 text-content-muted transition-transform', open && 'rotate-180')}
        />
      </button>
      {open && (
        <div className="space-y-2 border-t border-border bg-surface-raised p-3 text-sm">
          <ul className="divide-y divide-border">
            {order.lines.map((line) => (
              <li key={line.id} className="flex items-baseline gap-2 py-1.5">
                <span className="w-6 shrink-0 text-right font-black tabular-nums">
                  {line.quantity}
                </span>
                <span className="min-w-0 flex-1 font-semibold text-content">
                  {line.itemName}
                  {line.note && (
                    <span className="block text-xs font-semibold text-accent-text">
                      {line.note}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t border-border pt-2 text-xs">
            <dt className="text-content-muted">Ordered</dt>
            <dd className="text-right font-semibold text-content">
              {formatDayTime(order.orderedAt)} · by {order.createdByName ?? 'unknown'}
            </dd>
            {!handedOver && order.cancelReason && (
              <>
                <dt className="text-content-muted">Reason</dt>
                <dd className="text-right font-semibold text-content">{order.cancelReason}</dd>
              </>
            )}
            {order.takeBacks.map((takeBack) => (
              <TakeBackFacts key={takeBack.takenBackAt} takeBack={takeBack} />
            ))}
          </dl>
        </div>
      )}
    </li>
  )
}

function TakeBackFacts({ takeBack }: { takeBack: DeliveryHistoryOrder['takeBacks'][number] }) {
  return (
    <>
      <dt className="text-content-muted">Taken back</dt>
      <dd className="text-right font-semibold text-content">
        {formatDayTime(takeBack.takenBackAt)} · by {takeBack.takenBackByName ?? 'unknown'} ·{' '}
        {takeBack.reason}
      </dd>
    </>
  )
}

export function ManagerDeliveryHistoryShimmer() {
  return (
    <LoadingRegion label="delivery orders" className="space-y-2">
      <Shimmer className="h-20 w-full rounded-xl" />
      <Shimmer className="h-20 w-full rounded-xl" />
      <Shimmer className="h-20 w-full rounded-xl" />
    </LoadingRegion>
  )
}

const count = (value: number) => value.toLocaleString('en-IN')

/**
 * Stats → Delivery (delivery-orders-are-made-not-billed, D6): the delivery
 * orders' day in two groups, the counter's and the kitchen's, and no money.
 */
export function ManagerDeliveryStats({ stats }: { stats: DeliveryDayStats }) {
  const groups = [
    {
      title: 'Delivery',
      icon: Bike,
      figures: [
        ['Placed', count(stats.placed), 'delivery-stat-placed'],
        ['Updated', count(stats.updated), 'delivery-stat-updated'],
        ['Cancelled', count(stats.cancelled), 'delivery-stat-cancelled'],
        ['Handed over', count(stats.handedOver), 'delivery-stat-handed-over'],
      ],
    },
    {
      title: 'Kitchen',
      icon: ChefHat,
      figures: [
        ['Seen', count(stats.seen), 'delivery-stat-seen'],
        ['Ready', count(stats.ready), 'delivery-stat-ready'],
        ['Avg to ready', formatStatDuration(stats.toReadySeconds), 'delivery-stat-to-ready'],
        ['Avg handover', formatStatDuration(stats.handoverSeconds), 'delivery-stat-handover'],
      ],
    },
  ] as const
  return (
    <div className="space-y-3" data-testid="delivery-day-stats">
      {groups.map(({ title, icon: Icon, figures }) => (
        <section
          key={title}
          aria-label={title}
          className="overflow-hidden rounded-xl border border-border bg-surface"
        >
          <h3 className="flex items-center gap-2 border-b border-border px-4 py-2.5 text-sm font-bold text-content">
            <Icon aria-hidden size={18} className="text-accent-text" />
            {title}
          </h3>
          <dl className="grid grid-cols-2">
            {figures.map(([label, value, testId], index) => (
              <div
                key={label}
                className={`flex flex-col-reverse px-4 py-3 ${index % 2 === 0 ? 'border-r border-border' : ''} ${index < 2 ? 'border-b border-border' : ''}`}
              >
                <dt className="text-sm text-content-muted">{label}</dt>
                <dd data-testid={testId} className="text-xl font-black leading-7 text-content">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  )
}
