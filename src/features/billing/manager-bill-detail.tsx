import { Ban, ChevronDown, Clock3, ReceiptText, UserRound } from 'lucide-react'
import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { Money } from '@/components/ui/money'
import type { BillingBill } from '@/data-access/adapters'
import { formatBusinessDate, formatDayTime, lineTotalPaise } from '@/domain'

const CANCELLATION_REASONS = ['Duplicate bill', 'Mistaken entry'] as const

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

function BillStatusNotice({
  testId,
  tone,
  muted = false,
  children,
  trailing,
}: {
  testId: string
  tone: 'success' | 'danger'
  muted?: boolean
  children: ReactNode
  trailing: ReactNode
}) {
  const border =
    tone === 'success' ? (muted ? 'border-success/60' : 'border-success') : 'border-danger'

  return (
    <div data-testid={testId} className={`mb-3 rounded-xl border ${border} bg-surface p-3`}>
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 truncate text-sm font-semibold text-content">{children}</p>
        <span className="shrink-0 text-xs text-content-muted">{trailing}</span>
      </div>
    </div>
  )
}

export function ManagerBillDetail({
  bill,
  currentUserId,
  cancelling,
  reason,
  onReasonChange,
  onStartCancelling,
  onKeepBill,
  onConfirmCancellation,
}: {
  bill: BillingBill
  currentUserId?: string
  cancelling: boolean
  reason: string
  onReasonChange: (reason: string) => void
  onStartCancelling: () => void
  onKeepBill: () => void
  onConfirmCancellation: () => void
}) {
  const detailId = `bill-detail-${bill.id}`
  const cancellationActor =
    bill.voidedBy?.id === currentUserId ? 'You' : (bill.voidedBy?.name ?? 'someone')

  return (
    <article
      id={detailId}
      aria-labelledby={`bill-summary-${bill.id}`}
      data-testid={detailId}
      className="rounded-b-xl border border-t-0 border-border bg-surface-raised p-3 sm:p-4"
    >
      {bill.status === 'void' && (
        <BillStatusNotice
          testId="cancelled-bill-notice"
          tone="danger"
          trailing={
            bill.voidedAt && <time dateTime={bill.voidedAt}>{formatDayTime(bill.voidedAt)}</time>
          }
        >
          <span className="font-black text-danger">Cancelled</span>
          <span>{` by ${cancellationActor}`}</span>
          {bill.voidKind === 'cancelled_after_paid' && (
            <span className="font-black text-danger">· Cancelled after paid</span>
          )}
          <span aria-hidden className="text-content-muted">
            {' · '}
          </span>
          {bill.voidReason}
        </BillStatusNotice>
      )}

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
          <BillStatusNotice
            testId="paid-bill-notice"
            tone="success"
            muted={bill.status === 'void'}
            trailing={<Money paise={bill.totalPaise} className="text-sm font-black text-content" />}
          >
            <span className="font-black text-success">Paid</span> by{' '}
            {bill.payments.map((payment, index) => (
              <span key={payment.method}>
                {index > 0 && <span aria-hidden> + </span>}
                {methodLabel(payment.method)}
                {bill.payments.length > 1 && (
                  <>
                    {' ('}
                    <Money paise={payment.amountPaise} />)
                  </>
                )}
              </span>
            ))}
          </BillStatusNotice>

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

      {bill.status !== 'void' && (
        <div className="mt-3 border-t border-border pt-3">
          <Button variant="secondary" className="text-danger" onClick={onStartCancelling}>
            <Ban aria-hidden size={18} />
            Cancel this bill
          </Button>
        </div>
      )}

      <Modal
        open={cancelling}
        onClose={onKeepBill}
        aria-label={`Cancel bill ${bill.billNumber}`}
        className="m-auto w-[min(92vw,26rem)] rounded-2xl p-4"
      >
        <h2 className="text-lg font-black text-content">Cancel bill {bill.billNumber}?</h2>
        <label
          htmlFor={`cancel-reason-${bill.id}`}
          className="mt-4 block text-sm font-bold text-content"
        >
          Cancellation reason
        </label>
        <div
          className="mt-3 grid grid-cols-2 gap-2"
          role="group"
          aria-label="Common cancellation reasons"
        >
          {CANCELLATION_REASONS.map((candidate) => (
            <Button
              key={candidate}
              variant={reason === candidate ? 'primary' : 'secondary'}
              size="phone"
              aria-pressed={reason === candidate}
              onClick={() => onReasonChange(candidate)}
            >
              {candidate}
            </Button>
          ))}
        </div>
        <Input
          id={`cancel-reason-${bill.id}`}
          aria-label={`Cancellation reason for bill ${bill.billNumber}`}
          className="mt-1"
          placeholder="Or type a reason"
          value={reason}
          onChange={(event) => onReasonChange(event.target.value)}
        />
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button variant="secondary" size="control" onClick={onKeepBill}>
            Keep bill
          </Button>
          <Button
            variant="danger"
            size="control"
            disabled={!reason.trim()}
            onClick={onConfirmCancellation}
          >
            <Ban aria-hidden size={18} />
            Cancel bill
          </Button>
        </div>
      </Modal>
    </article>
  )
}
