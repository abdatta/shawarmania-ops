import { Check, Minus, Pencil, Plus, ReceiptText, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { EmptyState } from '@/components/layout/empty-state'
import { Button } from '@/components/ui/button'
import { LoadingRegion, Shimmer } from '@/components/ui/loading'
import { useAdapters } from '@/data-access'
import { DataActionError, type BillingOrder, type PaymentAllocation } from '@/data-access/adapters'
import { useSession } from '@/session/context'

import { CancelOrderDialog } from './cancel-order-dialog'
import { OpenOrderCardBody } from './open-order-card-body'
import { PaymentDialog } from './payment-dialog'
import { useCounterState } from './use-counter-state'

/**
 * The list's own title, separable from it.
 *
 * The combined tablet rail renders this itself so that the card for an order
 * under edit can sit directly beneath it — in the place that order occupied in
 * the list — while still being a child of the rail's scroller. That parentage is
 * what gives the card a sticky range covering the whole column; parented inside
 * the list it would come unstuck as soon as the short list scrolled past.
 */
export function OpenOrdersHeading({ embedded }: { embedded: boolean }) {
  return (
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
  )
}

export function OpenOrdersSurface({
  embedded = false,
  hideHeading = false,
  refreshKey = 0,
  onActivityChanged,
  editingOrderId = null,
  onEditOrder,
}: {
  embedded?: boolean
  /** The combined rail renders `OpenOrdersHeading` itself. */
  hideHeading?: boolean
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

  const listed = orders?.filter((order) => order.id !== editingOrderId) ?? []

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
      {!hideHeading && <OpenOrdersHeading embedded={embedded} />}

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
        /*
          An order held in the composer is not listed here — the rail renders its
          card directly above this list, in the place it occupied, so it is never
          a second card competing with the one being edited. The list can
          therefore be empty while orders exist, which is why the empty state
          above keys off `orders` and not what survives this filter, and why
          nothing needs to be said about the missing row.
        */
        <ul className={embedded ? 'space-y-2' : 'grid gap-3 lg:grid-cols-2'}>
          {listed.map((order) => {
            const active = editing?.id === order.id ? editing : order
            const showCreator = order.creatorId !== shift?.billerProfileId
            return (
              <li
                key={order.id}
                data-testid={`open-order-${order.orderNumber}`}
                className="rounded-xl border border-border bg-surface-raised p-3"
              >
                <OpenOrderCardBody
                  orderNumber={order.orderNumber}
                  orderedAt={order.orderedAt}
                  customerName={active.customerName}
                  lines={active.lines}
                  {...(showCreator ? { creatorName: order.creatorName } : {})}
                />

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
                  <Button size="phone" disabled={busy} onClick={() => setPaying(order)}>
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
