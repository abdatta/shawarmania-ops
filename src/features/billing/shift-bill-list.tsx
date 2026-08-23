import { ChevronDown, Pencil } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Money } from '@/components/ui/money'
import type { BillingBill } from '@/data-access/adapters'
import { formatDayTime, lineTotalPaise } from '@/domain'
import { cn } from '@/lib/cn'

function methodLabel(method: BillingBill['paymentMethod']) {
  return method === 'upi' ? 'UPI' : method[0]!.toUpperCase() + method.slice(1)
}

/** A closed bill is a compact summary until somebody needs to inspect its facts. */
export function ShiftBillList({
  bills,
  compact = false,
  onEditPayment,
  onAdvanceDemoClock,
  onTakeBackPayment,
  onCancelAfterPaid,
}: {
  bills: BillingBill[]
  compact?: boolean
  onEditPayment?: (bill: BillingBill) => void
  onAdvanceDemoClock?: (milliseconds: number) => void
  /**
   * Offered beside tender editing while this tablet's five-minute window is
   * open on an order bill: taking the money back reopens the order.
   */
  onTakeBackPayment?: (bill: BillingBill) => void
  /** Same window, louder consequence: voids the money and cancels the order. */
  onCancelAfterPaid?: (bill: BillingBill) => void
}) {
  return (
    <ul className={cn('divide-y divide-border', !compact && 'rounded-xl border border-border')}>
      {bills.map((bill) => (
        <li key={bill.id} data-flip-id={bill.id}>
          <details className="group" data-testid={`shift-bill-${bill.id}`}>
            <summary
              className={cn(
                'flex min-h-12 cursor-pointer list-none items-center gap-2 text-content focus-visible:focus-ring',
                compact ? 'px-1 py-2' : 'px-3 py-2.5',
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="font-bold">
                    {bill.billNumber > 0 ? `Bill ${bill.billNumber}` : 'Bill pending'}
                  </span>
                  {bill.orderNumber !== null && (
                    <span className="text-xs font-semibold text-content-muted">
                      Order {bill.orderNumber}
                    </span>
                  )}
                  {onEditPayment && bill.paymentEditableUntil && (
                    <PaymentEditIndicator editableUntil={bill.paymentEditableUntil} />
                  )}
                </div>
                <p className="truncate text-xs text-content-muted">
                  {formatDayTime(bill.paidAt)} · {methodLabel(bill.paymentMethod)}
                </p>
              </div>
              <Money paise={bill.totalPaise} className="shrink-0 font-bold" />
              <ChevronDown
                aria-hidden
                size={18}
                className="shrink-0 text-content-muted transition-transform group-open:rotate-180"
              />
            </summary>

            <div
              className={cn('border-t border-border bg-surface-raised', compact ? 'p-2' : 'p-3')}
              data-testid={`shift-bill-detail-${bill.id}`}
            >
              <ul className="divide-y divide-border">
                {bill.lines.map((line) => (
                  <li key={line.menuItemId} className="grid grid-cols-[1fr_auto] gap-x-3 py-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold leading-tight text-content">
                        {line.itemName}
                      </p>
                      <p className="text-xs text-content-muted">
                        {line.quantity} × <Money paise={line.unitPricePaise} />
                      </p>
                    </div>
                    <Money
                      paise={lineTotalPaise(line.unitPricePaise, line.quantity)}
                      className="self-center text-sm font-semibold"
                    />
                  </li>
                ))}
              </ul>

              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t border-border pt-2 text-xs">
                <dt className="text-content-muted">Paid</dt>
                <dd className="text-right font-semibold text-content">
                  {formatDayTime(bill.paidAt)}
                </dd>
                <dt className="text-content-muted">Tender</dt>
                <dd className="space-y-0.5 text-right font-semibold text-content">
                  {bill.payments.map((payment) => (
                    <span key={payment.method} className="block">
                      {methodLabel(payment.method)} <Money paise={payment.amountPaise} />
                    </span>
                  ))}
                </dd>
                {bill.paymentBusinessDate !== bill.businessDate && (
                  <>
                    <dt className="text-content-muted">Payment date</dt>
                    <dd className="text-right font-semibold text-content">
                      {bill.paymentBusinessDate}
                    </dd>
                  </>
                )}
                {bill.customerName && (
                  <>
                    <dt className="text-content-muted">Customer</dt>
                    <dd className="truncate text-right font-semibold text-content">
                      {bill.customerName}
                    </dd>
                  </>
                )}
                <dt className="pt-1 font-bold text-content">Total</dt>
                <dd className="pt-1 text-right">
                  <Money paise={bill.totalPaise} className="font-black" />
                </dd>
              </dl>
              {onEditPayment && bill.paymentEditableUntil && (
                <PaymentEditAction
                  editableUntil={bill.paymentEditableUntil}
                  onEdit={() => onEditPayment(bill)}
                  {...(onAdvanceDemoClock && { onAdvanceDemoClock })}
                />
              )}
              {(onTakeBackPayment || onCancelAfterPaid) &&
                bill.orderId &&
                bill.paymentEditableUntil && (
                  <div className="mt-3 flex flex-wrap justify-end gap-2 border-t border-border pt-3">
                    {onTakeBackPayment && (
                      <Button
                        size="phone"
                        variant="secondary"
                        onClick={() => onTakeBackPayment(bill)}
                      >
                        Un-pay
                      </Button>
                    )}
                    {onCancelAfterPaid && (
                      <Button
                        size="phone"
                        variant="secondary"
                        className="text-danger"
                        onClick={() => onCancelAfterPaid(bill)}
                      >
                        Cancel after paid
                      </Button>
                    )}
                  </div>
                )}
            </div>
          </details>
        </li>
      ))}
    </ul>
  )
}

export function paymentEditLabel(remainingMs: number): string | null {
  if (remainingMs <= 0) return null
  if (remainingMs >= 60_000) return `Edit (${Math.ceil(remainingMs / 60_000)} min)`
  return `Edit (${Math.ceil(remainingMs / 1_000)} sec)`
}

function PaymentEditIndicator({ editableUntil }: { editableUntil: string }) {
  const [active, setActive] = useState(true)

  useEffect(() => {
    const remaining = Date.parse(editableUntil) - Date.now()
    const timer = window.setTimeout(() => setActive(false), Math.max(0, remaining))
    return () => window.clearTimeout(timer)
  }, [editableUntil])

  if (!active) return null
  return (
    <span
      aria-label="Payment editable"
      title="Payment editable"
      className="inline-flex size-6 items-center justify-center rounded-full border border-primary bg-surface-raised text-accent-text"
    >
      <Pencil aria-hidden size={12} strokeWidth={2.25} />
    </span>
  )
}

function PaymentEditAction({
  editableUntil,
  onEdit,
  onAdvanceDemoClock,
}: {
  editableUntil: string
  onEdit: () => void
  onAdvanceDemoClock?: (milliseconds: number) => void
}) {
  const [now, setNow] = useState<number | null>(null)
  const [demoOffsetMs, setDemoOffsetMs] = useState(0)
  const deadline = Date.parse(editableUntil)
  const label = now === null ? null : paymentEditLabel(deadline - now - demoOffsetMs)

  useEffect(() => {
    const timer = window.setTimeout(() => setNow(Date.now()), 0)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (!label) return
    const remaining = deadline - Date.now() - demoOffsetMs
    const delay = remaining >= 60_000 ? remaining % 60_000 || 60_000 : remaining % 1_000 || 1_000
    const timer = window.setTimeout(() => setNow(Date.now()), delay)
    return () => window.clearTimeout(timer)
  }, [deadline, demoOffsetMs, label, now])

  if (!label) return null
  return (
    <div className="mt-3 flex flex-wrap justify-end gap-2 border-t border-border pt-3">
      {onAdvanceDemoClock && (
        <>
          <Button
            size="phone"
            variant="ghost"
            onClick={() => {
              const advance = Math.max(0, deadline - Date.now() - demoOffsetMs - 59_000)
              onAdvanceDemoClock(advance)
              setDemoOffsetMs((value) => value + advance)
            }}
          >
            Demo: 59 sec
          </Button>
          <Button
            size="phone"
            variant="ghost"
            onClick={() => {
              const advance = Math.max(0, deadline - Date.now() - demoOffsetMs)
              onAdvanceDemoClock(advance)
              setDemoOffsetMs((value) => value + advance)
            }}
          >
            Demo: expire
          </Button>
        </>
      )}
      <Button size="phone" variant="secondary" onClick={onEdit}>
        {label}
      </Button>
    </div>
  )
}
