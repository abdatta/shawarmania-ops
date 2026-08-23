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
import { splitPipeline } from './pipeline'
import { PaymentDialog } from './payment-dialog'
import { useCounterState } from './use-counter-state'

/**
 * The pipeline, whole-outlet, in two colour-coded bands: **Preparing** (ember)
 * over a plain hairline over **Unpaid Prepared Orders** (green). There are no
 * section headings and no action confirmations — the card colours, the divider,
 * and the section-to-section glide say everything; the counter reads state at a
 * glance, not by reading words.
 *
 * The old single "Open orders" list answered neither of the two questions the
 * counter actually asks — is the food made, is it paid — so everything sat in
 * one undifferentiated pile. The sections are pure derivations of
 * `prepared_at` × `status` (see pipeline.ts); a paid-but-unprepared order stays
 * in Preparing wearing its Paid marker because its food is still being made.
 *
 * The scope is the **outlet**, matching what live adapters have always served:
 * another tablet's work is this counter's work too, shown with its creator.
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
  const session = useContext(SessionContext)
  const counterDevice = useContext(CounterDeviceContext)
  const { shift } = useCounterState()
  const [orders, setOrders] = useState<BillingOrder[] | null>(null)
  const [tenders, setTenders] = useState<Map<string, string>>(new Map())
  const [paying, setPaying] = useState<BillingOrder | null>(null)
  const [cancelling, setCancelling] = useState<BillingOrder | null>(null)
  // Errors only. Success is carried by the motion and the card's new band —
  // the counter asked for no inserted info bars.
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
    // Tender facts ride along so an Un-pay can name what it takes back.
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

  const listed = orders?.filter((order) => order.id !== editingOrderId) ?? []
  const { preparing, unpaidPrepared } = splitPipeline(listed)

  // Section-to-section moves glide: the hook measures every surviving card
  // before and after each commit and plays the difference.
  const flipRootRef = useRef<HTMLElement | null>(null)
  useFlip(flipRootRef, [orders])

  if (orders === null) {
    // The rail's own silhouette: compact ticket cards over a hairline — the
    // shape this column fills once the pipeline arrives. Reshaped with the
    // layout in the same change, per the standing placeholder rule.
    return (
      <LoadingRegion label="the pipeline" className="space-y-1">
        <Shimmer className="h-[92px]" />
        <Shimmer className="h-[92px]" />
        <div className="my-1 border-t border-border" />
        <Shimmer className="h-[92px]" />
      </LoadingRegion>
    )
  }

  const renderSection = (
    label: string,
    sectionOrders: BillingOrder[],
    section: 'preparing' | 'unpaid-prepared',
    emptyText: string,
    testid: string,
  ) => (
    <section data-testid={testid} aria-label={label}>
      {sectionOrders.length === 0 ? (
        embedded ? null : (
          <p className="rounded-lg bg-surface-raised p-2 text-xs text-content-muted">{emptyText}</p>
        )
      ) : (
        <ul className="space-y-1">
          {sectionOrders.map((order) => (
            <li key={order.id}>
              <PipelineCard
                order={order}
                section={section}
                currentBillerId={shift?.billerProfileId ?? null}
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
      )}
    </section>
  )

  return (
    <section
      ref={flipRootRef}
      className={embedded ? 'space-y-1.5' : 'space-y-4'}
      aria-labelledby="open-orders-title"
    >
      <OpenOrdersHeading embedded={embedded} />

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-border bg-surface p-2 text-sm font-semibold text-danger"
        >
          {error}
        </p>
      )}

      {preparing.length === 0 && unpaidPrepared.length === 0 ? (
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
        <>
          {renderSection(
            'Preparing',
            preparing,
            'preparing',
            'Nothing waiting to be made.',
            'pipeline-preparing',
          )}
          <div
            className="my-2 flex items-center gap-2"
            role="separator"
            aria-label="Prepared, waiting for money"
          >
            <span className="h-px flex-1 bg-border" />
            <span className="text-xs font-bold tracking-wide text-content-muted uppercase">
              Prepared · awaiting money
            </span>
            <span className="h-px flex-1 bg-border" />
          </div>
          {renderSection(
            'Unpaid Prepared Orders',
            unpaidPrepared,
            'unpaid-prepared',
            'No prepared order is waiting for money.',
            'pipeline-unpaid-prepared',
          )}
        </>
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
