import { AlertTriangle, ClipboardList } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { EmptyState } from '@/components/layout/empty-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { LoadingRegion, Shimmer } from '@/components/ui/loading'
import { useAdapters } from '@/data-access'
import {
  DataActionError,
  type BillingAttentionItem,
  type BillingBill,
  type ShiftBillingHistory,
} from '@/data-access/adapters'
import { formatDateTime, isCorrectableRefusal } from '@/domain'
import { newUuid } from '@/lib/uuid'

import { ShiftBillList } from './shift-bill-list'
import { PaymentDialog } from './payment-dialog'
import { PaymentTotalCards } from './payment-total-cards'
import { UnpayDialog, CancelAfterPaidDialog } from './pipeline-card'
import { useFlip } from './flip'
import { useCounterState } from './use-counter-state'

export function MyShiftSurface({
  embedded = false,
  refreshKey = 0,
  onActivityChanged,
}: {
  embedded?: boolean
  refreshKey?: number
  onActivityChanged?: () => void
} = {}) {
  const { billing } = useAdapters()
  const { shift } = useCounterState()
  const [history, setHistory] = useState<ShiftBillingHistory | null>(null)
  const [attention, setAttention] = useState<BillingAttentionItem[]>([])
  const [reason, setReason] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [editingPayment, setEditingPayment] = useState<BillingBill | null>(null)
  const [savingPayment, setSavingPayment] = useState(false)
  const [unpayingBill, setUnpayingBill] = useState<BillingBill | null>(null)
  const [cancellingPaidBill, setCancellingPaidBill] = useState<BillingBill | null>(null)
  // Bill rows glide when the list reorders or a row unwinds away.
  const billListRef = useRef<HTMLDivElement | null>(null)
  useFlip(billListRef, [history])

  const load = useCallback(async () => {
    await Promise.resolve()
    if (!shift) {
      setAttention([])
      return setHistory({ bills: [], totals: [] })
    }
    const [nextHistory, nextAttention] = await Promise.all([
      billing.listShiftHistory(shift.id),
      billing.listAttention(),
    ])
    setHistory(nextHistory)
    setAttention(nextAttention)
  }, [billing, shift])

  useEffect(() => {
    void Promise.resolve()
      .then(load)
      .catch(() => setMessage('Could not load this shift.'))
  }, [load, refreshKey])

  const resolve = async (operation: () => Promise<unknown>, success: string) => {
    try {
      await operation()
      setMessage(success)
      setReason('')
      await load()
      onActivityChanged?.()
    } catch (cause) {
      setMessage(
        cause instanceof DataActionError ? cause.message : 'That item could not be resolved.',
      )
    }
  }

  if (history === null)
    return (
      // The bills column's own silhouette: the totals pair over collapsed bill
      // rows — reshaped beside this column's new layout, per the standing
      // placeholder rule.
      <LoadingRegion label="this shift" className="space-y-2" data-testid="bills-loading">
        <div className="grid grid-cols-2 gap-2">
          <Shimmer className="h-12" />
          <Shimmer className="h-12" />
        </div>
        {[1, 2, 3].map((key) => (
          <Shimmer key={key} className="h-9" />
        ))}
      </LoadingRegion>
    )

  const tenderLabelOf = (bill: BillingBill): string | null => {
    const methods = [...new Set(bill.payments.map((payment) => payment.method))]
    if (methods.length === 0) return null
    return methods.map((method) => (method === 'upi' ? 'UPI' : 'Cash')).join(' + ')
  }

  return (
    /*
      Embedded, this is a **column with a fixed head and a scrolling body**, not
      a list that grows.
      
      It sits in the counter's middle track, which is height-constrained by the
      workspace, and without an internal scroller a busy evening simply ran the
      bills off the bottom of the screen: the last bills and — worse — any
      needs-attention card below them became unreachable, on the one surface
      whose whole job is to be reachable mid-service. The day's Cash and UPI
      totals stay pinned, because they are the figures somebody checks *while*
      scrolling the list beneath them, and a total that scrolls away is a total
      you have to stop and hunt for with a queue in front of you.
    */
    <section
      className={embedded ? 'flex min-h-0 flex-1 flex-col gap-2' : 'space-y-5'}
      aria-labelledby="my-shift-title"
    >
      <div className={embedded ? 'shrink-0' : undefined}>
        {embedded ? (
          <h3 id="my-shift-title" className="text-sm font-black text-content">
            Bills this shift
          </h3>
        ) : (
          <>
            <h1 id="my-shift-title" className="text-2xl font-black text-content">
              My shift
            </h1>
            <p className="text-sm text-content-muted">
              Paid bills from this tablet&rsquo;s current shift only.
            </p>
          </>
        )}
      </div>
      <div className={embedded ? 'shrink-0 space-y-2' : 'space-y-5'}>
        <PaymentTotalCards totals={history.totals} testIdPrefix="shift-total" />
        {message && (
          <p
            role="status"
            className="rounded-lg border border-border bg-surface p-3 text-sm font-semibold text-content"
          >
            {message}
          </p>
        )}
      </div>
      {/* Everything below the totals scrolls together, so an attention card
          never sits below the fold with no way to reach it. */}
      <div className={embedded ? 'min-h-0 flex-1 space-y-2 overflow-y-auto' : 'space-y-5'}>
        {/*
          Needs-attention first, above the money.

          It was last, beneath every bill of the evening, which put the one
          item on this column that somebody has to *act* on furthest from the
          eye and — before this column could scroll at all — frequently off
          the screen entirely. A refused payment is not a footnote to the
          day’s takings; it is the reason the takings are wrong.
        */}
        {attention
          .filter((item) => item.state === 'needs_attention')
          .map((item) => (
            <article
              key={item.reference}
              className={
                embedded
                  ? 'rounded-lg border-2 border-danger bg-surface p-3'
                  : 'rounded-xl border-2 border-danger bg-surface p-4'
              }
            >
              <div className="flex gap-2">
                <AlertTriangle aria-hidden className="shrink-0 text-danger" />
                <div className="min-w-0">
                  <h2 className="font-bold text-content">
                    {item.orderNumber === null
                      ? 'Payment needs attention'
                      : `Order ${item.orderNumber} needs attention`}
                  </h2>
                  <p className="text-sm text-content-muted">{item.refusedTrace}</p>
                  <p className="mt-1 text-xs text-content-muted">
                    Reference {item.reference.slice(0, 8)} · {formatDateTime(item.receivedAt)}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {/*
                Correction resends the same payload under a new identity, so it
                is offered only where a resend could land differently. For a
                terminal refusal — an order already paid, an edit window closed —
                it is certain to be refused again and each attempt leaves another
                permanent row in the manager's diagnostics, so discard is the
                only action shown.
              */}
                {isCorrectableRefusal(item.resultCategory) ? (
                  <Button
                    size="phone"
                    onClick={() =>
                      void resolve(
                        () => billing.correctAttention(item.reference, newUuid()),
                        'A linked correction was created with a new identity. The refused trace remains here.',
                      )
                    }
                  >
                    Correct with new copy
                  </Button>
                ) : (
                  <p className="w-full text-sm text-content-muted">
                    Sending this again cannot change the answer. Discard it with a reason.
                  </p>
                )}
                <Input
                  className="min-w-48 flex-1"
                  aria-label="Discard reason"
                  placeholder="Reason to discard"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
                <Button
                  variant="danger"
                  size="phone"
                  disabled={!reason.trim()}
                  onClick={() =>
                    void resolve(
                      () => billing.discardAttention(item.reference, reason),
                      'The item was discarded with its reason and trace retained.',
                    )
                  }
                >
                  Discard
                </Button>
              </div>
            </article>
          ))}
        {history.bills.length === 0 ? (
          embedded ? (
            <p className="rounded-lg bg-surface-raised p-3 text-sm text-content-muted">
              No paid bills in this shift yet.
            </p>
          ) : (
            <EmptyState icon={ClipboardList} title="No paid bills in this shift yet." />
          )
        ) : (
          <div ref={billListRef}>
            <ShiftBillList
              bills={history.bills}
              compact={embedded}
              onEditPayment={(bill) => {
                setMessage(null)
                setEditingPayment(bill)
              }}
              onTakeBackPayment={(bill) => {
                setMessage(null)
                setUnpayingBill(bill)
              }}
              onCancelAfterPaid={(bill) => {
                setMessage(null)
                setCancellingPaidBill(bill)
              }}
              {...(billing.advanceDemoPaymentClock && {
                onAdvanceDemoClock: billing.advanceDemoPaymentClock,
              })}
            />
          </div>
        )}
      </div>
      <UnpayDialog
        open={unpayingBill !== null}
        reference={
          unpayingBill
            ? `bill ${unpayingBill.billNumber > 0 ? unpayingBill.billNumber : 'pending'}`
            : ''
        }
        totalPaise={unpayingBill?.totalPaise ?? 0}
        tenderLabel={unpayingBill ? tenderLabelOf(unpayingBill) : null}
        busy={savingPayment}
        onClose={() => setUnpayingBill(null)}
        onConfirm={(why) => {
          if (!unpayingBill?.orderId) return
          const bill = unpayingBill
          setUnpayingBill(null)
          void resolve(
            () => billing.unpayOrder(bill.orderId!, bill.id, why),
            'The payment was taken back and the order reopened.',
          )
        }}
      />
      <CancelAfterPaidDialog
        open={cancellingPaidBill !== null}
        reference={
          cancellingPaidBill
            ? `bill ${cancellingPaidBill.billNumber > 0 ? cancellingPaidBill.billNumber : 'pending'}`
            : ''
        }
        totalPaise={cancellingPaidBill?.totalPaise ?? 0}
        busy={savingPayment}
        onClose={() => setCancellingPaidBill(null)}
        onConfirm={(why) => {
          if (!cancellingPaidBill?.orderId) return
          const bill = cancellingPaidBill
          setCancellingPaidBill(null)
          void resolve(
            () => billing.cancelPaidOrder(bill.orderId!, why),
            'The bill was voided and the order cancelled.',
          )
        }}
      />
      <PaymentDialog
        open={editingPayment !== null}
        mode="correct"
        totalPaise={editingPayment?.totalPaise ?? 0}
        initialPayments={editingPayment?.payments ?? []}
        busy={savingPayment}
        error={message}
        onClose={() => setEditingPayment(null)}
        onConfirm={(payments) => {
          if (!editingPayment) return
          setSavingPayment(true)
          setMessage(null)
          void billing
            .correctBillPayment(editingPayment.id, editingPayment.paymentRevision, payments)
            .then(async () => {
              setEditingPayment(null)
              setMessage('Payment updated.')
              await load()
              onActivityChanged?.()
            })
            .catch((cause: unknown) =>
              setMessage(
                cause instanceof DataActionError
                  ? cause.message
                  : 'That payment could not be updated.',
              ),
            )
            .finally(() => setSavingPayment(false))
        }}
      />
    </section>
  )
}
