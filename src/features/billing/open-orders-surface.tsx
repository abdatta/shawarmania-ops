import { Check, Minus, Pencil, Plus, ReceiptText, UserRound, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { EmptyState } from '@/components/layout/empty-state'
import { Button } from '@/components/ui/button'
import { LoadingRegion, Shimmer } from '@/components/ui/loading'
import { Money } from '@/components/ui/money'
import { useAdapters } from '@/data-access'
import { DataActionError, type BillingOrder, type PaymentAllocation } from '@/data-access/adapters'
import { formatRecentAge } from '@/domain'
import { useSession } from '@/session/context'

import { CancelOrderDialog } from './cancel-order-dialog'
import { PaymentDialog } from './payment-dialog'
import { useCounterState } from './use-counter-state'

export function OpenOrdersSurface({
  embedded = false,
  refreshKey = 0,
  onActivityChanged,
  editingOrderId = null,
  onEditOrder,
}: {
  embedded?: boolean
  refreshKey?: number
  onActivityChanged?: () => void
  editingOrderId?: string | null
  onEditOrder?: (order: BillingOrder) => void
} = {}) {
  const { billing } = useAdapters()
  const session = useSession()
  const { shift } = useCounterState()
  const [orders, setOrders] = useState<BillingOrder[] | null>(null)
  const [editing, setEditing] = useState<BillingOrder | null>(null)
  const [paying, setPaying] = useState<BillingOrder | null>(null)
  const [cancelling, setCancelling] = useState<BillingOrder | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    await Promise.resolve()
    if (!session.outletId || !shift) return setOrders([])
    setOrders(await billing.listOpenOrders(session.outletId))
  }, [billing, session.outletId, shift])

  useEffect(() => {
    void Promise.resolve()
      .then(load)
      .catch(() => setMessage('Could not load open orders.'))
  }, [load, refreshKey])

  const act = async (operation: () => Promise<unknown>, success: string) => {
    setBusy(true)
    setMessage(null)
    try {
      await operation()
      setEditing(null)
      setPaying(null)
      setCancelling(null)
      setMessage(success)
      await load()
      onActivityChanged?.()
    } catch (cause) {
      setMessage(
        cause instanceof DataActionError ? cause.message : 'That action could not be completed.',
      )
    } finally {
      setBusy(false)
    }
  }

  function recordPayment(payments: PaymentAllocation[]) {
    if (!paying) return
    void act(
      () => billing.payOrder(paying.id, payments),
      `Order ${paying.orderNumber} recorded as paid. Bill number assigned.`,
    )
  }

  if (orders === null) {
    return (
      <LoadingRegion label="open orders" className="space-y-2">
        <Shimmer className="h-5 w-28" />
        {[1, 2].map((key) => (
          <Shimmer key={key} className="h-36" />
        ))}
      </LoadingRegion>
    )
  }

  return (
    <section className={embedded ? 'space-y-2' : 'space-y-4'} aria-labelledby="open-orders-title">
      <div>
        {embedded ? (
          <h3 id="open-orders-title" className="text-sm font-black text-content">
            Open orders
          </h3>
        ) : (
          <h1 id="open-orders-title" className="text-2xl font-black text-content">
            Open orders
          </h1>
        )}
        <p className={embedded ? 'text-xs text-content-muted' : 'text-sm text-content-muted'}>
          This tablet&rsquo;s unpaid orders.
        </p>
      </div>

      {message && (
        <p
          role="status"
          className="rounded-lg border border-border bg-surface p-2 text-sm font-semibold text-content"
        >
          {message}
        </p>
      )}

      {orders.length === 0 ? (
        embedded ? (
          <p className="rounded-lg bg-surface-raised p-3 text-sm text-content-muted">
            No open orders on this tablet.
          </p>
        ) : (
          <EmptyState icon={ReceiptText} title="No open orders on this tablet." />
        )
      ) : (
        <ul className={embedded ? 'space-y-2' : 'grid gap-3 lg:grid-cols-2'}>
          {orders.map((order) => {
            const active = editing?.id === order.id ? editing : order
            const showCreator = order.creatorId !== shift?.billerProfileId
            const editingInComposer = editingOrderId === order.id
            const activeTotalPaise = active.lines.reduce(
              (sum, line) => sum + line.unitPricePaise * line.quantity,
              0,
            )
            return (
              <li
                key={order.id}
                data-testid={`open-order-${order.orderNumber}`}
                className="rounded-xl border border-border bg-surface-raised p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    {active.customerName && (
                      <p className="flex items-start gap-1.5 text-base font-black leading-5 text-content">
                        <UserRound
                          aria-hidden
                          className="mt-0.5 shrink-0 text-accent-text"
                          size={17}
                        />
                        <span>{active.customerName}</span>
                      </p>
                    )}
                    <div
                      className={
                        active.customerName
                          ? 'mt-1 flex flex-wrap items-center gap-1.5'
                          : 'flex flex-wrap items-center gap-1.5'
                      }
                    >
                      <span className="rounded-md border border-border bg-surface px-1.5 py-0.5 text-xs font-bold text-content-muted">
                        Order #{order.orderNumber}
                      </span>
                      <span className="text-xs text-content-muted">
                        {formatRecentAge(order.orderedAt)}
                        {showCreator && <> · {order.creatorName}</>}
                      </span>
                    </div>
                  </div>
                  <Money
                    paise={activeTotalPaise}
                    display
                    className="shrink-0 font-black text-content"
                  />
                </div>

                <ul
                  className="mt-3 space-y-1.5"
                  aria-label={`Items for order ${order.orderNumber}`}
                >
                  {active.lines.map((line) => (
                    <li
                      key={line.menuItemId}
                      className="flex items-start gap-2 text-sm text-content"
                    >
                      <span className="min-w-7 rounded-md bg-primary px-1.5 py-0.5 text-center font-black leading-5 text-on-primary">
                        {line.quantity}×
                      </span>
                      <span className="min-w-0 flex-1 pt-0.5 font-bold leading-5">
                        {line.itemName}
                      </span>
                      <Money
                        paise={line.unitPricePaise * line.quantity}
                        className="shrink-0 pt-0.5 text-sm font-bold"
                      />
                    </li>
                  ))}
                </ul>

                {editing?.id === order.id && (
                  <div className="mt-2 border-t border-border pt-2">
                    <ul className="divide-y divide-border">
                      {active.lines.map((line) => (
                        <li key={line.menuItemId} className="flex min-h-11 items-center gap-2 py-1">
                          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-content">
                            {line.itemName}
                          </span>
                          <Button
                            variant="secondary"
                            size="phone"
                            className="w-10 px-0"
                            aria-label={`One fewer ${line.itemName}`}
                            onClick={() =>
                              setEditing({
                                ...active,
                                lines: active.lines.flatMap((candidate) =>
                                  candidate.menuItemId !== line.menuItemId
                                    ? [candidate]
                                    : candidate.quantity > 1
                                      ? [{ ...candidate, quantity: candidate.quantity - 1 }]
                                      : [],
                                ),
                              })
                            }
                          >
                            <Minus aria-hidden size={16} />
                          </Button>
                          <span className="w-5 text-center font-bold">{line.quantity}</span>
                          <Button
                            variant="secondary"
                            size="phone"
                            className="w-10 px-0"
                            aria-label={`One more ${line.itemName}`}
                            onClick={() =>
                              setEditing({
                                ...active,
                                lines: active.lines.map((candidate) =>
                                  candidate.menuItemId === line.menuItemId
                                    ? { ...candidate, quantity: candidate.quantity + 1 }
                                    : candidate,
                                ),
                              })
                            }
                          >
                            <Plus aria-hidden size={16} />
                          </Button>
                        </li>
                      ))}
                    </ul>
                    <div className="mt-2 flex justify-end gap-2">
                      <Button variant="secondary" size="phone" onClick={() => setEditing(null)}>
                        Close
                      </Button>
                      <Button
                        size="phone"
                        disabled={busy || active.lines.length === 0}
                        onClick={() =>
                          void act(
                            () =>
                              billing.reviseOrder(order.id, {
                                lines: active.lines,
                                customerName: active.customerName,
                                customerPhone: active.customerPhone,
                              }),
                            `Order ${order.orderNumber} updated.`,
                          )
                        }
                      >
                        <Check aria-hidden size={17} />
                        Done
                      </Button>
                    </div>
                  </div>
                )}

                <div className="mt-3 grid grid-cols-[minmax(0,1fr)_2.75rem_2.75rem] gap-2">
                  <Button
                    size="phone"
                    disabled={busy || editingInComposer}
                    onClick={() => setPaying(order)}
                  >
                    Mark Paid
                  </Button>
                  <Button
                    variant="secondary"
                    size="phone"
                    className="px-0"
                    aria-label={`Edit order ${order.orderNumber}`}
                    disabled={editingOrderId !== null}
                    onClick={() =>
                      onEditOrder ? onEditOrder(order) : setEditing(structuredClone(order))
                    }
                  >
                    <Pencil aria-hidden size={17} />
                  </Button>
                  <Button
                    variant="danger"
                    size="phone"
                    className="px-0"
                    aria-label={`Cancel order ${order.orderNumber}`}
                    disabled={editingInComposer}
                    onClick={() => setCancelling(order)}
                  >
                    <X aria-hidden size={18} />
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <PaymentDialog
        open={paying !== null}
        totalPaise={paying?.totalPaise ?? 0}
        busy={busy}
        onClose={() => setPaying(null)}
        onConfirm={recordPayment}
      />
      <CancelOrderDialog
        open={cancelling !== null}
        orderNumber={cancelling?.orderNumber ?? 0}
        busy={busy}
        onClose={() => setCancelling(null)}
        onConfirm={(reason) => {
          if (!cancelling) return
          void act(
            () => billing.cancelOrder(cancelling.id, reason),
            `Order ${cancelling.orderNumber} cancelled.`,
          )
        }}
      />
    </section>
  )
}
