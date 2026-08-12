import { Ban, ChevronDown, Clock3, CreditCard, ReceiptText, UserRound } from 'lucide-react'
import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Money } from '@/components/ui/money'
import type { BillingBill } from '@/data-access/adapters'
import { formatBusinessDate, formatDayTime, lineTotalPaise } from '@/domain'

function methodLabel(method: BillingBill['paymentMethod']) {
  return method === 'upi' ? 'UPI' : method[0]!.toUpperCase() + method.slice(1)
}

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof ReceiptText
  title: string
  children: ReactNode
}) {
  return (
    <section data-bill-section className="rounded-xl border border-border bg-surface p-3">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-black text-content">
        <Icon aria-hidden size={17} className="text-content-muted" />
        {title}
      </h3>
      {children}
    </section>
  )
}

function CollapsibleSection({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof ReceiptText
  title: string
  children: ReactNode
}) {
  return (
    <details data-bill-section className="group rounded-xl border border-border bg-surface">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-3 text-sm font-black text-content focus-visible:focus-ring [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2">
          <Icon aria-hidden size={17} className="text-content-muted" />
          {title}
        </span>
        <ChevronDown
          aria-hidden
          size={17}
          className="shrink-0 text-content-muted transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="px-3 pb-3">{children}</div>
    </details>
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[0.6875rem] font-semibold leading-tight text-content-muted">{label}</dt>
      <dd className="mt-0.5 break-words text-sm font-semibold leading-tight text-content">
        {children}
      </dd>
    </div>
  )
}

export function ManagerBillDetail({
  bill,
  cancelling,
  reason,
  onReasonChange,
  onStartCancelling,
  onKeepBill,
  onConfirmCancellation,
}: {
  bill: BillingBill
  cancelling: boolean
  reason: string
  onReasonChange: (reason: string) => void
  onStartCancelling: () => void
  onKeepBill: () => void
  onConfirmCancellation: () => void
}) {
  const detailId = `bill-detail-${bill.id}`

  return (
    <article
      id={detailId}
      aria-labelledby={`bill-summary-${bill.id}`}
      data-testid={detailId}
      className="rounded-b-xl border border-t-0 border-border bg-surface-raised p-3 sm:p-4"
    >
      <div className="grid gap-3 lg:grid-cols-2">
        <Section icon={ReceiptText} title="Order items">
          <ul className="divide-y divide-border">
            {bill.lines.map((line, index) => (
              <li
                key={`${line.menuItemId}-${index}`}
                className="grid grid-cols-[1fr_auto] gap-x-3 py-2 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="font-semibold leading-tight text-content">{line.itemName}</p>
                  <p className="mt-1 text-xs text-content-muted">
                    {line.quantity} × <Money paise={line.unitPricePaise} /> each
                  </p>
                </div>
                <Money
                  paise={lineTotalPaise(line.unitPricePaise, line.quantity)}
                  className="self-center font-bold"
                />
              </li>
            ))}
          </ul>
        </Section>

        <div className="space-y-3">
          <Section icon={CreditCard} title="Payment">
            <dl className="space-y-2">
              {bill.payments.map((payment) => (
                <div key={payment.method} className="flex items-center justify-between gap-3">
                  <dt className="text-sm font-semibold text-content">
                    {methodLabel(payment.method)}
                  </dt>
                  <dd>
                    <Money paise={payment.amountPaise} className="font-bold" />
                  </dd>
                </div>
              ))}
              <div className="flex items-center justify-between gap-3 border-t border-border pt-2">
                <dt className="font-black text-content">Total</dt>
                <dd>
                  <Money paise={bill.totalPaise} className="text-lg font-black" />
                </dd>
              </div>
            </dl>
          </Section>

          <CollapsibleSection icon={UserRound} title="Customer details">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Fact label="Customer name">{bill.customerName || 'Not provided'}</Fact>
              <Fact label="Customer phone">{bill.customerPhone || 'Not provided'}</Fact>
            </dl>
          </CollapsibleSection>

          <CollapsibleSection icon={Clock3} title="Bill timeline">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Fact label="Ordered">{formatDayTime(bill.orderedAt)}</Fact>
              <Fact label="Paid">{formatDayTime(bill.paidAt)}</Fact>
              <Fact label="Revenue day">{formatBusinessDate(bill.businessDate)}</Fact>
              {bill.paymentBusinessDate !== bill.businessDate && (
                <Fact label="Payment day">{formatBusinessDate(bill.paymentBusinessDate)}</Fact>
              )}
              <Fact label="Order reference">
                {bill.orderNumber === null ? 'Paid directly' : `Order ${bill.orderNumber}`}
              </Fact>
              <Fact label="Bill reference">Bill {bill.billNumber}</Fact>
            </dl>
          </CollapsibleSection>
        </div>
      </div>

      {bill.status === 'void' ? (
        <div className="mt-3 rounded-xl border border-danger bg-surface p-3">
          <p className="font-black text-danger">Cancelled</p>
          <p className="mt-1 text-sm text-content">{bill.voidReason}</p>
          {bill.voidedAt && (
            <p className="mt-1 text-xs text-content-muted">
              Cancelled {formatDayTime(bill.voidedAt)}
            </p>
          )}
        </div>
      ) : cancelling ? (
        <div className="mt-3 rounded-xl border border-danger bg-surface p-3">
          <h3 className="font-black text-content">Cancel bill {bill.billNumber}?</h3>
          <p className="mt-1 text-sm text-content-muted">
            The original bill will stay in history as Cancelled. Ring the corrected sale manually on
            the enrolled counter tablet.
          </p>
          <label
            htmlFor={`cancel-reason-${bill.id}`}
            className="mt-3 block text-sm font-bold text-content"
          >
            Why is this bill being cancelled?
          </label>
          <Input
            id={`cancel-reason-${bill.id}`}
            aria-label={`Cancellation reason for bill ${bill.billNumber}`}
            className="mt-1"
            placeholder="For example, wrong item was billed"
            value={reason}
            onChange={(event) => onReasonChange(event.target.value)}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={onKeepBill}>
              Keep bill
            </Button>
            <Button variant="danger" disabled={!reason.trim()} onClick={onConfirmCancellation}>
              <Ban aria-hidden size={18} />
              Confirm cancellation
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 border-t border-border pt-3">
          <Button variant="secondary" className="text-danger" onClick={onStartCancelling}>
            <Ban aria-hidden size={18} />
            Cancel this bill
          </Button>
        </div>
      )}
    </article>
  )
}
