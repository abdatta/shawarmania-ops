import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import { Flame, ReceiptText } from 'lucide-react'

import { EmptyState } from '@/components/layout/empty-state'
import { LoadingRegion, Shimmer } from '@/components/ui/loading'
import { useAdapters } from '@/data-access'
import {
  DataActionError,
  type BillingBill,
  type BillingOrder,
  type PaymentAllocation,
} from '@/data-access/adapters'
import { formatPaise } from '@/domain'
import { SessionContext } from '@/session/context'
import { CounterDeviceContext } from '@/session/counter-context'

import { CancelOrderDialog } from './cancel-order-dialog'
import { flyGhost, useFlip, waitForElement } from './flip'
import { PipelineCard } from './pipeline-card'
import { splitPipeline } from './pipeline'
import { PaymentDialog } from './payment-dialog'
import { useCounterState } from './use-counter-state'

/**
 * The pipeline, whole-outlet: **Preparing** over a labelled divider over
 * **Unpaid Prepared Orders**.
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
            Unpaid Prepared Orders
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
  hideHeading = false,
  refreshKey = 0,
  onActivityChanged,
  editingOrderId = null,
  onEditOrder,
}: {
  embedded?: boolean
  /** The combined rail renders the section headings itself. */
  hideHeading?: boolean
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
  const [message, setMessage] = useState<string | null>(null)
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
      .catch(() => setMessage('Could not load the pipeline.'))
  }, [load, refreshKey])

  const act = async (operation: () => Promise<unknown>, success: string) => {
    setBusy(true)
    setMessage(null)
    try {
      const result = await operation()
      setPaying(null)
      setCancelling(null)
      setMessage(success)
      await load()
      onActivityChanged?.()
      return result
    } catch (cause) {
      setMessage(
        cause instanceof DataActionError ? cause.message : 'That action could not be completed.',
      )
      return undefined
    } finally {
      setBusy(false)
    }
  }

  function recordPayment(payments: PaymentAllocation[]) {
    if (!paying) return
    const reference = paying.localReference ?? String(paying.orderNumber)
    // The money flies from the card's place into the bills column — capture
    // where it stood before the refresh takes the card away.
    const fromRect = document
      .querySelector<HTMLElement>(`[data-flip-id="${paying.id}"]`)
      ?.getBoundingClientRect()
    void act(
      () => billing.payOrder(paying.id, payments),
      `Order ${reference} recorded as paid. Bill number assigned after delivery.`,
    ).then((bill) => {
      if (!bill || typeof bill !== 'object' || !('id' in bill)) return
      if (!fromRect) return
      void waitForElement(`[data-testid="shift-bill-${String(bill.id)}"]`).then((destination) => {
        if (!destination) return
        flyGhost({
          fromRect: {
            left: fromRect.left,
            top: fromRect.top,
            width: fromRect.width,
            height: fromRect.height,
          },
          resolveToRect: () => {
            const rect = destination.getBoundingClientRect()
            return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
          },
          label: formatPaise(paying.totalPaise),
        })
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
    // The rail's own silhouette: two section headings over compact ticket
    // cards — the shape this column fills once the pipeline arrives. Reshaped
    // with the layout in the same change, per the standing placeholder rule.
    return (
      <LoadingRegion label="the pipeline" className="space-y-2">
        <Shimmer className="mb-1 h-4 w-20" />
        <Shimmer className="h-24" />
        <Shimmer className="h-24" />
        <div className="my-3 border-t border-border" />
        <Shimmer className="mb-1 h-4 w-28" />
        <Shimmer className="h-24" />
      </LoadingRegion>
    )
  }

  const renderSection = (
    title: string,
    Icon: typeof Flame,
    sectionOrders: BillingOrder[],
    section: 'preparing' | 'unpaid-prepared',
    emptyText: string,
    testid: string,
  ) => (
    <section data-testid={testid} aria-label={title}>
      {!hideHeading && (
        <h4 className="mb-1 flex items-center gap-1.5 text-sm font-black text-content">
          <Icon aria-hidden size={15} className="text-accent-text" />
          {title}
        </h4>
      )}
      {sectionOrders.length === 0 ? (
        <p className="rounded-lg bg-surface-raised p-2 text-xs text-content-muted">{emptyText}</p>
      ) : (
        <ul className="space-y-2">
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
                  void act(
                    () => billing.markOrderPrepared(target.id, true),
                    `${target.localReference ?? `Order #${target.orderNumber}`} marked prepared.`,
                  )
                }
                onMarkPaid={(target) => {
                  setMessage(null)
                  setPaying(target)
                }}
                onCancel={(target) => {
                  setMessage(null)
                  setCancelling(target)
                }}
                onUnpay={(target, reason) =>
                  void act(
                    () => billing.unpayOrder(target.id, target.billId!, reason),
                    'The payment was taken back and the order reopened.',
                  )
                }
                onCancelAfterPaid={(target, reason) =>
                  void act(
                    () => billing.cancelPaidOrder(target.id, reason),
                    'The bill was voided and the order cancelled.',
                  )
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
      className={embedded ? 'space-y-2' : 'space-y-4'}
      aria-labelledby="open-orders-title"
    >
      {!hideHeading && <OpenOrdersHeading embedded={embedded} />}

      {message && (
        <p
          role="status"
          className="rounded-lg border border-border bg-surface p-2 text-sm font-semibold text-content"
        >
          {message}
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
            Flame,
            preparing,
            'preparing',
            'Nothing waiting to be made.',
            'pipeline-preparing',
          )}
          <div
            className="my-3 flex items-center gap-2"
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
            ReceiptText,
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
          void act(
            () => billing.cancelOrder(cancelling.id, reason),
            `Order ${cancelling.localReference ?? cancelling.orderNumber} cancelled.`,
          )
        }}
      />
    </section>
  )
}
