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
} from '@/data-access/adapters'
import { SessionContext } from '@/session/context'
import { CounterDeviceContext } from '@/session/counter-context'

import { CancelOrderDialog } from './cancel-order-dialog'
import { captureCardFlight, flyCapturedCardToDestination, useFlip, waitForElement } from './flip'
import { PipelineCard } from './pipeline-card'
import { PaymentDialog } from './payment-dialog'
import { RailScrollChip, useRailClipping } from './rail-scroll-chip'
import { useCounterState } from './use-counter-state'
import { OfflineFillHint } from './offline-fill-hint'

/**
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
export function OpenOrdersHeading({ embedded }: { embedded: boolean }) {
  return (
    <div>
      {embedded ? null : (
        <>
          <h1 id="open-orders-title" className="text-2xl font-black text-content">
            Open orders
          </h1>
          <p className="text-sm text-content-muted">
            The whole outlet&rsquo;s pipeline — from every tablet at this counter.
          </p>
        </>
      )}
    </div>
  )
}

function methodLabelOf(bill: BillingBill): string | null {
  if (bill.status !== 'settled') return null
  const methods = [...new Set(bill.payments.map((payment) => payment.method))]
  if (methods.length === 0) return null
  return methods.map((method) => (method === 'upi' ? 'UPI' : 'Cash')).join(' + ')
}

export function OpenOrdersSurface({
  embedded = false,
  refreshKey = 0,
  savedOrderKey = 0,
  onActivityChanged,
  editingOrderId = null,
  onEditOrder,
}: {
  embedded?: boolean
  refreshKey?: number
  /**
   * Bumped when an order is saved **on this tablet**, and only then: the rail
   * returns to its newest end so the order just taken is the visible one. A
   * neighbouring till's order arriving must not move the list under the biller's
   * thumb.
   */
  savedOrderKey?: number
  onActivityChanged?: () => void
  editingOrderId?: string | null
  onEditOrder?: (order: BillingOrder) => void
} = {}) {
  const { billing } = useAdapters()
  const session = useContext(SessionContext)
  const counterDevice = useContext(CounterDeviceContext)
  const { shift } = useCounterState()
  const [orders, setOrders] = useState<BillingOrder[] | null>(null)
  const [tenders, setTenders] = useState<Map<string, string>>(new Map())
  const [paying, setPaying] = useState<BillingOrder | null>(null)
  const [cancelling, setCancelling] = useState<BillingOrder | null>(null)
  // Errors only. Success is carried by the card's own colours — the counter
  // asked for no inserted info bars.
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const outletId = counterDevice?.device.outletId ?? session?.outletId ?? null

  const load = useCallback(async () => {
    await Promise.resolve()
    if (!outletId || !shift) {
      setTenders(new Map())
      return setOrders([])
    }
    const nextOrders = await billing.listOpenOrders(outletId)
    setOrders(nextOrders)
    // Tender facts ride along so a take-back can name what it returns.
    try {
      const history = await billing.listShiftHistory(shift.id)
      const nextTenders = new Map<string, string>()
      for (const bill of history.bills) {
        const label = methodLabelOf(bill)
        if (label) nextTenders.set(bill.id, label)
      }
      setTenders(nextTenders)
    } catch {
      setTenders(new Map())
    }
  }, [billing, counterDevice?.device.outletId, session?.outletId, shift])

  useEffect(() => {
    void Promise.resolve()
      .then(load)
      .catch(() => setError('Could not load the pipeline.'))
  }, [load, refreshKey])

  const act = async (operation: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      const result = await operation()
      setPaying(null)
      setCancelling(null)
      await load()
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

  function recordPayment(payments: PaymentAllocation[]) {
    if (!paying) return
    // A settlement replaces an order id with a bill id. Capture the whole
    // ticket before the refresh removes it, so the visual identity survives
    // the cross-column handoff instead of leaving a separate amount badge.
    const source = document.querySelector<HTMLElement>(`[data-flip-id="${paying.id}"]`)
    const flight = source ? captureCardFlight(source) : null
    void act(() => billing.payOrder(paying.id, payments)).then((bill) => {
      if (!bill || typeof bill !== 'object' || !('id' in bill)) return
      if (!flight) return
      void waitForElement(`[data-testid="shift-bill-${String(bill.id)}"]`).then((destination) => {
        if (!destination) return
        flyCapturedCardToDestination(flight, destination)
      })
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
  const listed = (orders ?? []).filter(
    (order) => order.id !== editingOrderId && order.status !== 'cancelled',
  )

  // The settlement flight is the only motion left. With no sections to move
  // between, the hook measures no movement when a fact is merely recorded.
  const flipRootRef = useRef<HTMLElement | null>(null)
  useFlip(flipRootRef, [orders])

  const scrollerRef = useRef<HTMLUListElement | null>(null)
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
      belonged to a divider that no longer arrives.
    */
    return (
      <LoadingRegion label="the pipeline" className="space-y-1">
        <OfflineFillHint />
        <Shimmer className="h-[92px]" />
        <Shimmer className="h-[92px]" />
        <Shimmer className="h-[92px]" />
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
            className={`relative min-h-0 flex-1 space-y-1 scroll-smooth motion-reduce:scroll-auto ${
              embedded ? 'overflow-y-auto' : ''
            }`}
          >
            {listed.map((order) => (
              <li
                key={order.id}
                /*
                  How a card hidden below the fold tells the chip it is prepared
                  food still waiting for money, without the chip holding a second
                  copy of the order array that could fall out of step with what
                  is actually rendered.
                */
                data-awaiting-money={
                  order.preparedAt !== null && order.status === 'open' ? 'true' : undefined
                }
              >
                <PipelineCard
                  order={order}
                  currentBillerId={shift?.billerProfileId ?? null}
                  currentDeviceId={counterDevice?.device.deviceId ?? null}
                  busy={busy}
                  {...(onEditOrder ? { onEdit: onEditOrder } : {})}
                  tenderLabel={order.billId ? (tenders.get(order.billId) ?? null) : null}
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
                />
              </li>
            ))}
          </ul>
          <RailScrollChip
            edge="bottom"
            count={clipping.below}
            marked={clipping.moneyWaitingBelow}
            onActivate={() => scrollRailTo('bottom')}
          />
        </div>
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
        {...(cancelling?.localReference !== undefined
          ? { orderReference: cancelling.localReference }
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
