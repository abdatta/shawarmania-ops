import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import { ReceiptText } from 'lucide-react'

import { EmptyState } from '@/components/layout/empty-state'
import { LoadingRegion, Shimmer } from '@/components/ui/loading'
import { useAdapters } from '@/data-access'
import {
  DataActionError,
  type BillingBill,
  type BillingOrder,
  type PaymentAllocation,
  type OutletMenu,
} from '@/data-access/adapters'
import { isAwaitingOrderNumber, kitchenBell, sharedTables, UNSENT_ORDER_REFERENCE } from '@/domain'
import { SessionContext } from '@/session/context'
import { useRefreshQueue } from '@/lib/use-refresh-queue'
import { CounterDeviceContext } from '@/session/counter-context'

import { CancelOrderDialog } from './cancel-order-dialog'
import { OpenOrdersHeading } from './open-orders-surface'
import { useFlip } from './flip'
import { PipelineCard } from './pipeline-card'
import { OrderCheckoutDialog, type CheckoutOrderRevision } from './order-checkout-dialog'
import { RailScrollChip, useRailClipping } from './rail-scroll-chip'
import { useCounterState } from './use-counter-state'
import { useKitchenMarks } from './kitchen-marks-state'
import { useMasonryRail } from './use-masonry-rail'
import { KITCHEN_READY_EXIT_MS, KITCHEN_READY_GAP_MS } from '@/features/kitchen/use-kitchen-ready'
import { useReadyRinger } from './use-ready-ringer'

/**
 * The counter's rail (each-dish-is-ticked-off, design D1, D6, R5, R6). It is
 * `OpenOrdersSurface`, which the standalone Open orders page still draws, laid
 * out in two free-flowing columns, its cards ticking each dish, filling a Ready
 * dish and ringing the handbell when one arrives.
 *
 * **It reads nothing on a timer** (design R5). The first launch re-read this
 * rail every ten seconds, after a one-second loop before that; both are gone.
 * It reads on its own writes, the outlet's billing events and the foreground,
 * as the standalone rail does, one read at a time with one trailing read kept.
 *
 * The standalone rail's account, which still holds:
 *
 * The outlet's unfinished work as **one list**, newest order first.
 *
 * It used to be two colour-coded bands — Preparing over Unpaid Prepared Orders
 * — so a card's band *was* its preparation state. The Kalyani biller reported
 * what that costs: one tap changed the card's position, both button labels, the
 * buttons' order and their colours at once, and the eye had to re-find a card it
 * was already looking at. The bands cost space too, each claiming a share of the
 * panel in proportion to its work, so a rail holding two orders drew two cards
 * and two large empty rectangles.
 *
 * An order answers two independent questions — is the food made, is it paid —
 * and #45 built the data that way on purpose. The card now draws those two
 * switches as two switches (see `state-toggle.tsx`), and a card's position is
 * decided by when the order was taken and by nothing else. Recording either fact
 * changes colours and moves nothing. A ticket leaves the list only when both are
 * recorded, flying into Bills this shift.
 *
 * What the divider used to say — prepared work is waiting for money — is said
 * instead by the marker on the bottom scroll chip, which is the only place that
 * fact can still go unnoticed.
 *
 * The scope is the **outlet**, matching what live adapters have always served:
 * another tablet's work is this counter's work too, shown with its creator and
 * its till.
 */
function methodLabelOf(bill: BillingBill): string | null {
  if (bill.status !== 'settled') return null
  const methods = [...new Set(bill.payments.map((payment) => payment.method))]
  if (methods.length === 0) return null
  return methods.map((method) => (method === 'upi' ? 'UPI' : 'Cash')).join(' + ')
}

/** How long a handed-over delivery order stays on the rail to be undone. */
const HANDOVER_UNDO_MS = 5_000
/** Its fade, then a beat before the cards around it move into its place: the kitchen's own. */
const HANDOVER_EXIT_MS = KITCHEN_READY_EXIT_MS + KITCHEN_READY_GAP_MS
/** The take-back's reason when the handover is undone on the rail itself. */
const HANDOVER_UNDO_REASON = 'Undone on the rail'

export function DishOpenOrdersSurface({
  embedded = false,
  refreshKey = 0,
  ownSaveKey = 0,
  savedOrderKey = 0,
  onActivityChanged,
  onOrdersRead,
  editingOrderId = null,
  onEditOrder,
  onSetOrderCustomer,
  checkoutSettings,
}: {
  embedded?: boolean
  refreshKey?: number
  /**
   * Bumped by a save on this tablet that the rail should show — an order, an
   * edit, a take-back from Bills. Distinct from
   * `refreshKey`, which the outlet's change notices and the foreground bump too
   * (the-counter-shows-what-it-saved, design D3).
   */
  ownSaveKey?: number
  /**
   * Bumped when an order is saved **on this tablet**, and only then: the rail
   * returns to its newest end so the order just taken is the visible one. A
   * neighbouring till's order arriving must not move the list under the biller's
   * thumb.
   */
  savedOrderKey?: number
  onActivityChanged?: () => void
  onOrdersRead?: (orders: BillingOrder[]) => void
  editingOrderId?: string | null
  onEditOrder?: (order: BillingOrder) => void
  onSetOrderCustomer?: (order: BillingOrder) => void
  checkoutSettings?: Pick<OutletMenu, 'service' | 'loyalty'>
} = {}) {
  const { billing } = useAdapters()
  const session = useContext(SessionContext)
  const counterDevice = useContext(CounterDeviceContext)
  const { shift } = useCounterState()
  const [orders, setOrders] = useState<BillingOrder[] | null>(null)
  /*
    Delivery orders just handed over, held on the rail for a few seconds so a
    mistaken tap is undone where it was made, not by finding the order in My
    shift (delivery-orders-are-made-not-billed; owner, 2026-11-01).
  */
  const [lingering, setLingering] = useState<
    ReadonlyMap<string, { order: BillingOrder; leaving: boolean }>
  >(new Map())
  const lingerTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  useEffect(() => {
    const timers = lingerTimers.current
    return () => timers.forEach((timer) => clearTimeout(timer))
  }, [])
  const stopLingering = (orderId: string) => {
    clearTimeout(lingerTimers.current.get(orderId))
    lingerTimers.current.delete(orderId)
    setLingering((held) => {
      const next = new Map(held)
      next.delete(orderId)
      return next
    })
  }
  /** Held, counting down; then fading; then gone, and only then do the others move up. */
  const linger = (order: BillingOrder) => {
    clearTimeout(lingerTimers.current.get(order.id))
    setLingering((held) => new Map(held).set(order.id, { order, leaving: false }))
    lingerTimers.current.set(
      order.id,
      setTimeout(() => {
        setLingering((held) => {
          const entry = held.get(order.id)
          return entry ? new Map(held).set(order.id, { ...entry, leaving: true }) : held
        })
        lingerTimers.current.set(
          order.id,
          setTimeout(() => stopLingering(order.id), HANDOVER_EXIT_MS),
        )
      }, HANDOVER_UNDO_MS),
    )
  }
  const [tenders, setTenders] = useState<Map<string, string>>(new Map())
  const [paying, setPaying] = useState<BillingOrder | null>(null)
  const [cancelling, setCancelling] = useState<BillingOrder | null>(null)
  // Errors only. Success is carried by the card's own colours — the counter
  // asked for no inserted info bars.
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const ticking = useRef(new Set<string>())
  const [tickingOrders, setTickingOrders] = useState(new Set<string>())

  const outletId = counterDevice?.device.outletId ?? session?.outletId ?? null

  /*
    Which kitchens on shift have pressed ACK on which order (#72), for the bell
    on each card. Shared with the counter's header, which says when the kitchen
    is offline; absent off the counter, where no bell is drawn.
  */
  const kitchenMarks = useKitchenMarks()
  const marks = kitchenMarks?.marks ?? null
  const refreshMarks = kitchenMarks?.refresh

  const read = useCallback(
    async (isCurrent: () => boolean) => {
      await Promise.resolve()
      if (!outletId || !shift) {
        setTenders(new Map())
        return setOrders([])
      }
      const nextOrders = await billing.listOpenOrders(outletId)
      if (!isCurrent()) return
      setOrders(nextOrders)
      onOrdersRead?.(nextOrders)
      // An order write reloads the rail; its bells come with it.
      void refreshMarks?.()
      // Tender facts ride along so a take-back can name what it returns.
      try {
        if (!nextOrders.some((order) => order.billId)) return setTenders(new Map())
        const history = await billing.listShiftHistory(shift.id)
        if (!isCurrent()) return
        const nextTenders = new Map<string, string>()
        for (const bill of history.bills) {
          const label = methodLabelOf(bill)
          if (label) nextTenders.set(bill.id, label)
        }
        setTenders(nextTenders)
      } catch {
        if (isCurrent()) setTenders(new Map())
      }
    },
    [billing, outletId, shift, refreshMarks, onOrdersRead],
  )
  const queue = useRefreshQueue(read)
  const load = queue.refresh

  useEffect(() => {
    void Promise.resolve()
      .then(load)
      .catch(() => setError('Could not load the pipeline.'))
  }, [load, refreshKey])

  /*
    A save on this tablet (the-counter-shows-what-it-saved, design D3, D4). The rail draws what the tablet holds — the order just
    taken, the edit just made, the order a take-back reopened — and then asks
    the server, once, as the save always did.

    A read already on its way is dropped first: it took its snapshot before the
    save, and landing after the drawing it would take the save off the rail
    until the next read put it back. Only a save does this. A change notice
    dropping reads as it went could, on a busy outlet with a weak connection,
    keep the server's answer from ever landing.
  */
  useEffect(() => {
    if (ownSaveKey === 0) return
    let current = true
    queue.invalidate()
    void (async () => {
      if (outletId && shift) {
        const held = await billing.peekOpenOrders(outletId)
        if (current && held) {
          setOrders(held)
          onOrdersRead?.(held)
          const history = held.some((order) => order.billId)
            ? await billing.peekShiftHistory(shift.id)
            : null
          if (current && history) {
            const nextTenders = new Map<string, string>()
            for (const bill of history.bills) {
              const label = methodLabelOf(bill)
              if (label) nextTenders.set(bill.id, label)
            }
            setTenders(nextTenders)
          }
        }
      }
      await load()
    })().catch(() => setError('Could not refresh the pipeline.'))
    return () => {
      current = false
    }
    // Keyed on the save alone: the rest are read as they stand when it lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownSaveKey])

  // The handbell and the bells that swing with it, from the reads above (R6).
  const swinging = useReadyRinger(orders, marks)

  /** Each order's ticks still being saved on this tablet, in tap order. */
  const tickQueues = useRef(new Map<string, Promise<void>>())

  const tickLine = (orderId: string, lineId: string, prepared: boolean) => {
    // Every tap is taken. One order's ticks are saved one after another, each
    // projected over the one before, so a quick second tap is neither dropped
    // nor drawn over the first; other tickets stay usable throughout. The
    // order's money actions wait until its ticks are saved.
    if (busy) return
    ticking.current.add(orderId)
    setTickingOrders(new Set(ticking.current))
    setError(null)
    const save = async () => {
      try {
        const updated = await billing.markOrderLinesPrepared(crypto.randomUUID(), orderId, [
          { id: lineId, prepared },
        ])
        queue.invalidate()
        setOrders((held) =>
          (held ?? [])
            .map((order) => (order.id === orderId ? updated : order))
            .filter(
              (order) =>
                order.status === 'open' || (order.status === 'paid' && order.preparedAt === null),
            ),
        )
      } catch (cause) {
        setError(
          cause instanceof DataActionError ? cause.message : 'That action could not be completed.',
        )
      }
    }
    const saved = (tickQueues.current.get(orderId) ?? Promise.resolve()).then(save)
    tickQueues.current.set(orderId, saved)
    void saved.then(() => {
      if (tickQueues.current.get(orderId) !== saved) return
      // The last of a run of taps: one re-read for all of them.
      tickQueues.current.delete(orderId)
      ticking.current.delete(orderId)
      setTickingOrders(new Set(ticking.current))
      onActivityChanged?.()
      void load().catch(() => setError('Could not refresh the pipeline.'))
    })
  }

  const act = async (operation: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      const result = await operation()
      queue.invalidate()
      if (result && typeof result === 'object' && 'preparedAt' in result) {
        const updated = result as BillingOrder
        setOrders((held) =>
          (held ?? [])
            .map((order) => (order.id === updated.id ? updated : order))
            .filter(
              (order) =>
                order.status === 'open' || (order.status === 'paid' && order.preparedAt === null),
            ),
        )
      }
      setPaying(null)
      setCancelling(null)
      void load().catch(() => setError('Could not refresh the pipeline.'))
      onActivityChanged?.()
      return result
    } catch (cause) {
      setError(
        cause instanceof DataActionError ? cause.message : 'That action could not be completed.',
      )
      return undefined
    } finally {
      setBusy(false)
    }
  }

  function recordPayment(payments: PaymentAllocation[], revision: CheckoutOrderRevision | null) {
    if (!paying) return
    void act(async () => {
      let updated = paying
      if (revision) {
        // Each command is durable before the next is accepted. If recording
        // tender fails, keep the revised order so retry pays that same ticket.
        const revised = await billing.reviseOrder(paying.id, revision)
        setPaying(revised)
        updated = revised
      }
      const bill = await billing.payOrder(paying.id, payments)
      queue.invalidate()
      const paid: BillingOrder = {
        ...updated,
        status: 'paid',
        paidAt: bill?.paidAt ?? new Date().toISOString(),
        billId: bill?.id ?? null,
      }
      setOrders((held) =>
        (held ?? [])
          .map((order) => (order.id === paid.id ? paid : order))
          .filter(
            (order) =>
              order.status === 'open' || (order.status === 'paid' && order.preparedAt === null),
          ),
      )
      return bill
    })
  }

  /*
    Every order the adapter returned that is not cancelled, in the order it
    returned them — `ordered_at` descending. Nothing is grouped, sorted or
    partitioned here: a card's place is when its order was taken, and nothing
    else.

    Newest-first was reconsidered and kept, on the owner's reasoning: a
    correction happens in the first seconds after saving, so the order just
    taken has to be under the biller's thumb.
  */
  // From every order read, not just those listed, so a card knows its table
  // is shared even when the other order is filtered out of view.
  const shared = sharedTables(orders ?? [])
  const listed = [
    ...(orders ?? []).filter((order) => !lingering.has(order.id)),
    ...[...lingering.values()].map((entry) => entry.order),
  ]
    .filter((order) => order.status !== 'cancelled')
    /*
      Sorted here rather than taken on trust from the adapter. Newest-first is
      this surface's promise, and the two adapters did not agree about it: the
      live one orders `ordered_at` descending, the mock returned it ascending,
      so demo mode drew the rail upside down and "saving returns you to the top"
      put the biller on the oldest ticket. A requirement the screen makes is a
      requirement the screen has to keep.
    */
    .sort((left, right) => {
      const byTime = Date.parse(right.orderedAt) - Date.parse(left.orderedAt)
      return byTime !== 0 ? byTime : right.id.localeCompare(left.id)
    })

  // With no sections to move between, the hook measures no movement when a
  // fact is merely recorded; a card that leaves fades.
  const flipRootRef = useRef<HTMLElement | null>(null)
  const scrollerRef = useRef<HTMLUListElement | null>(null)
  /*
    The rail's layout and its glide follow what is listed, not only what was
    read: a handed-over card leaves from the hold, not from a read, and the
    cards behind it should close up as the kitchen's do (owner, 2026-11-01).
  */
  const listedKey = listed.map((order) => order.id).join(',')
  useMasonryRail(scrollerRef, true, orders, listedKey)
  // Its fade starting is a moment to measure too: the rail's picture of the
  // card must already say it faded, or the card is drawn again to fade twice.
  const leavingKey = [...lingering]
    .filter(([, entry]) => entry.leaving)
    .map(([id]) => id)
    .join(',')
  useFlip(flipRootRef, [orders, listedKey, leavingKey], true)
  const clipping = useRailClipping(scrollerRef, [listed.length, orders])
  const scrollRailTo = (edge: 'top' | 'bottom') => {
    const scroller = scrollerRef.current
    if (!scroller) return
    // The whole way, as a chat app jumps: a partial scroll would leave the
    // biller re-reading the chip to find out whether anything happened. The
    // smoothness is the scroller's own CSS, which reduced motion turns off.
    scroller.scrollTop = edge === 'top' ? 0 : scroller.scrollHeight
  }

  /*
    Keyed on the save alone, deliberately. Keeping `orders` in here as well —
    so the scroll could wait for the new card to render — made every ordinary
    reload yank the rail back to the top, including a reload caused by another
    till's order arriving. It does not need to wait: the list is newest-first,
    so the top is where the new card lands, and a scroller already at zero is
    already showing it.
  */
  useEffect(() => {
    if (savedOrderKey === 0) return
    const scroller = scrollerRef.current
    if (scroller) scroller.scrollTop = 0
  }, [savedOrderKey])

  if (orders === null) {
    /*
      The rail's own silhouette, reshaped with the list it stands in for: plain
      cards over one scroller with no hairline between them, because the hairline
      belonged to a divider that no longer arrives. 98px is a one-item card
      since the customer button (36px) set the header's height.
    */
    return (
      <LoadingRegion label="the pipeline" className="flex gap-2">
        {[0, 1].map((column) => (
          <div key={column} className="flex-1 space-y-2">
            {[0, 1, 2].map((row) => (
              <Shimmer key={row} className={column === row ? 'h-32' : 'h-24'} />
            ))}
          </div>
        ))}
      </LoadingRegion>
    )
  }

  return (
    <section
      ref={flipRootRef}
      className={embedded ? 'flex min-h-0 flex-1 flex-col gap-1.5' : 'space-y-4'}
      aria-labelledby="open-orders-title"
    >
      <OpenOrdersHeading embedded={embedded} />

      {error && (
        <p
          role="alert"
          className="shrink-0 rounded-lg border border-border bg-surface p-2 text-sm font-semibold text-danger"
        >
          {error}
        </p>
      )}

      {listed.length === 0 ? (
        embedded ? (
          <p className="rounded-lg bg-surface-raised p-3 text-sm text-content-muted">
            No orders in the pipeline right now.
          </p>
        ) : (
          <EmptyState
            icon={ReceiptText}
            title="No orders in the pipeline right now. Save one from the counter menu."
          />
        )
      ) : (
        <div className={embedded ? 'relative flex min-h-0 flex-1 flex-col' : 'relative'}>
          <RailScrollChip
            edge="top"
            count={clipping.above}
            readyOrder={clipping.readyAbove}
            onActivate={() => scrollRailTo('top')}
          />
          <ul
            ref={scrollerRef}
            data-testid="pipeline-list"
            aria-label="The pipeline"
            /*
              One scroller for the whole rail. `relative` so each card's
              `offsetTop` is measured against this list rather than against
              whatever happens to be positioned above it.
            */
            className={`relative min-h-0 flex-1 pipeline-masonry scroll-smooth motion-reduce:scroll-auto ${
              embedded ? 'no-scrollbar overflow-y-auto' : ''
            }`}
          >
            {listed.map((order) => (
              <li
                key={order.id}
                className={
                  order.id === editingOrderId
                    ? 'invisible'
                    : lingering.get(order.id)?.leaving
                      ? 'kitchen-ready-exit'
                      : undefined
                }
                // The scroll chip names a Ready order out of sight (D9).
                data-ready-order={
                  order.lines.some(
                    (line) =>
                      (marks?.readyQuantities?.[order.id]?.[line.orderLineId ?? ''] ??
                        line.readyQuantity ??
                        0) > (line.preparedQuantity ?? 0),
                  )
                    ? order.orderNumber
                    : undefined
                }
                /*
                  How a card hidden below the fold tells the chip it is prepared
                  food still waiting for money, without the chip holding a second
                  copy of the order array that could fall out of step with what
                  is actually rendered.
                */
                data-awaiting-money={
                  // A delivery order owes the counter no money (delivery-orders-are-made-not-billed).
                  order.preparedAt !== null && order.status === 'open' && !order.delivery
                    ? 'true'
                    : undefined
                }
              >
                <PipelineCard
                  order={order}
                  fadedOut={lingering.get(order.id)?.leaving ?? false}
                  dishTicks
                  bellsRinging={swinging.has(order.id)}
                  readyQuantities={marks?.readyQuantities?.[order.id] ?? {}}
                  onTickLine={(lineId: string, prepared: boolean) =>
                    void tickLine(order.id, lineId, prepared)
                  }
                  currentBillerId={shift?.billerProfileId ?? null}
                  currentDeviceId={counterDevice?.device.deviceId ?? null}
                  busy={busy || tickingOrders.has(order.id)}
                  tickable={!busy}
                  {...(onEditOrder ? { onEdit: onEditOrder } : {})}
                  {...(onSetOrderCustomer ? { onSetCustomer: onSetOrderCustomer } : {})}
                  tenderLabel={order.billId ? (tenders.get(order.billId) ?? null) : null}
                  sharedTable={shared.get(order.id) ?? null}
                  kitchen={marks ? kitchenBell(marks.orders[order.id] ?? [], marks.kitchens) : null}
                  kitchenAnswers={marks?.orders[order.id] ?? []}
                  kitchenStates={marks?.dishStates?.[order.id] ?? []}
                  kitchenLabels={marks?.kitchens.map((kitchen) => kitchen.label) ?? []}
                  onMarkPrepared={(target) =>
                    void act(() => billing.markOrderPrepared(target.id, true))
                  }
                  onUnprepare={(target) =>
                    void act(() => billing.markOrderPrepared(target.id, false))
                  }
                  onMarkPaid={(target) => {
                    setError(null)
                    setPaying(target)
                  }}
                  onCancel={(target) => {
                    setError(null)
                    setCancelling(target)
                  }}
                  onUnpay={(target, reason) =>
                    void act(() => billing.unpayOrder(target.id, target.billId!, reason))
                  }
                  onCancelAfterPaid={(target, reason) =>
                    void act(() => billing.cancelPaidOrder(target.id, reason))
                  }
                  {...(order.delivery
                    ? {
                        // Held on the rail before the write, so the card is never
                        // drawn away and back between the two.
                        onHandOver: (target: BillingOrder) => {
                          linger({
                            ...target,
                            status: 'handed_over',
                            handedOverAt: new Date().toISOString(),
                          })
                          void act(() => billing.handOverOrder(target.id)).then((result) => {
                            if (!result) stopLingering(target.id)
                          })
                        },
                        onUndoHandOver: (target: BillingOrder) => {
                          if (lingering.get(target.id)?.leaving) return
                          void act(() =>
                            billing.takeBackHandover(target.id, HANDOVER_UNDO_REASON),
                          ).then((result) => {
                            if (result)
                              setOrders((held) => [
                                ...(held ?? []).filter((candidate) => candidate.id !== target.id),
                                result as BillingOrder,
                              ])
                            stopLingering(target.id)
                          })
                        },
                      }
                    : {})}
                />
              </li>
            ))}
          </ul>
          <RailScrollChip
            edge="bottom"
            count={clipping.below}
            readyOrder={clipping.readyBelow}
            marked={clipping.moneyWaitingBelow}
            onActivate={() => scrollRailTo('bottom')}
          />
        </div>
      )}

      {paying && (
        <OrderCheckoutDialog
          key={paying.id}
          order={paying}
          {...(checkoutSettings ? { initialSettings: checkoutSettings } : {})}
          mode={session?.mode ?? 'real'}
          busy={busy}
          error={error}
          onClose={() => setPaying(null)}
          onConfirm={recordPayment}
        />
      )}
      <CancelOrderDialog
        open={cancelling !== null}
        orderNumber={cancelling?.orderNumber ?? 0}
        {...(cancelling && isAwaitingOrderNumber(cancelling.orderNumber)
          ? { orderReference: UNSENT_ORDER_REFERENCE }
          : {})}
        busy={busy}
        onClose={() => setCancelling(null)}
        onConfirm={(reason) => {
          if (!cancelling) return
          void act(() => billing.cancelOrder(cancelling.id, reason))
        }}
      />
    </section>
  )
}
