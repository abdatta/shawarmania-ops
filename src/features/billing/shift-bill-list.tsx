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
        <BillRow
          key={bill.id}
          bill={bill}
          compact={compact}
          {...(onEditPayment ? { onEditPayment } : {})}
          {...(onAdvanceDemoClock ? { onAdvanceDemoClock } : {})}
          {...(onTakeBackPayment ? { onTakeBackPayment } : {})}
          {...(onCancelAfterPaid ? { onCancelAfterPaid } : {})}
        />
      ))}
    </ul>
  )
}

/**
 * One bill, and the demo clock offset its two windowed controls share.
 *
 * The offset lives here rather than inside the edit control because the demo's
 * **Demo: expire** must end the *window*, not one affordance of it: the tender
 * edit and the two unwinds all answer to the same deadline, so a jump that
 * expired only the first would demonstrate something the counter never does.
 */
function BillRow({
  bill,
  compact,
  onEditPayment,
  onAdvanceDemoClock,
  onTakeBackPayment,
  onCancelAfterPaid,
}: {
  bill: BillingBill
  compact: boolean
  onEditPayment?: (bill: BillingBill) => void
  onAdvanceDemoClock?: (milliseconds: number) => void
  onTakeBackPayment?: (bill: BillingBill) => void
  onCancelAfterPaid?: (bill: BillingBill) => void
}) {
  const [demoOffsetMs, setDemoOffsetMs] = useState(0)
  return (
    <li data-flip-id={bill.id}>
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
              {onEditPayment && bill.paymentEditable && (
                <PaymentEditIndicator
                  editableUntil={bill.paymentEditableUntil}
                  demoOffsetMs={demoOffsetMs}
                />
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
            {bill.lines.map((line, index) => (
              <li
                key={`${line.menuItemId}-${index}`}
                className="grid grid-cols-[1fr_auto] gap-x-3 py-2"
              >
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
            <dd className="text-right font-semibold text-content">{formatDayTime(bill.paidAt)}</dd>
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
          {onEditPayment && bill.paymentEditable && (
            <PaymentEditAction
              editableUntil={bill.paymentEditableUntil}
              demoOffsetMs={demoOffsetMs}
              onEdit={() => onEditPayment(bill)}
              {...(onAdvanceDemoClock
                ? {
                    onAdvanceDemoClock: (advance: number) => {
                      onAdvanceDemoClock(advance)
                      setDemoOffsetMs((value) => value + advance)
                    },
                  }
                : {})}
            />
          )}
          {(onTakeBackPayment || onCancelAfterPaid) && bill.orderId && bill.paymentEditable && (
            <UnwindActions
              editableUntil={bill.paymentEditableUntil}
              demoOffsetMs={demoOffsetMs}
              {...(onTakeBackPayment ? { onTakeBackPayment: () => onTakeBackPayment(bill) } : {})}
              {...(onCancelAfterPaid ? { onCancelAfterPaid: () => onCancelAfterPaid(bill) } : {})}
            />
          )}
        </div>
      </details>
    </li>
  )
}

/**
 * Whether the ticket's edit window is still open — measured, never assumed, and
 * never a running timer: one timeout per deadline, fired when it passes.
 *
 * `null` while no clock has been read yet, which lasts one frame after mount. A
 * null `editableUntil` is a window that has **not started** (the bill's order is
 * still being made) and is therefore always open.
 *
 * `demoOffsetMs` is how far the demo has pushed its own payment clock forward.
 * It is a parameter rather than internal state because the offset belongs to the
 * bill, not to one of the several controls reading the same window.
 */
function useWindowOpen(editableUntil: string | null, demoOffsetMs: number): boolean | null {
  const [now, setNow] = useState<number | null>(null)
  const deadline = editableUntil === null ? null : Date.parse(editableUntil)

  useEffect(() => {
    const timer = window.setTimeout(() => setNow(Date.now()), 0)
    return () => window.clearTimeout(timer)
  }, [deadline, demoOffsetMs])

  useEffect(() => {
    if (deadline === null || now === null) return
    const remaining = deadline - Date.now() - demoOffsetMs
    if (remaining <= 0) return
    const timer = window.setTimeout(() => setNow(Date.now()), remaining)
    return () => window.clearTimeout(timer)
  }, [deadline, demoOffsetMs, now])

  if (deadline === null) return true
  if (now === null) return null
  return deadline - now - demoOffsetMs > 0
}

/**
 * Taking the money back, and cancelling after payment, on the same deadline as
 * the tender edit beside them.
 *
 * They share the window rather than merely the ownership flag, because a
 * control that outlived it would be offering something the database is going to
 * refuse. A null `editableUntil` is a window that has **not started** — the
 * bill's order is still being made — and nothing expires then.
 */
function UnwindActions({
  editableUntil,
  demoOffsetMs,
  onTakeBackPayment,
  onCancelAfterPaid,
}: {
  editableUntil: string | null
  demoOffsetMs: number
  onTakeBackPayment?: () => void
  onCancelAfterPaid?: () => void
}) {
  // Drawn until the clock says otherwise rather than withheld for a frame: a
  // control that flickered in would be worse than one that leaves a moment late.
  if (useWindowOpen(editableUntil, demoOffsetMs) === false) return null
  return (
    <div className="mt-3 flex flex-wrap justify-end gap-2 border-t border-border pt-3">
      {onTakeBackPayment && (
        <Button size="phone" variant="secondary" onClick={onTakeBackPayment}>
          Take the payment back
        </Button>
      )}
      {onCancelAfterPaid && (
        <Button
          size="phone"
          variant="secondary"
          className="text-danger"
          onClick={onCancelAfterPaid}
        >
          Cancel after paid
        </Button>
      )}
    </div>
  )
}

export function paymentEditLabel(remainingMs: number): string | null {
  if (remainingMs <= 0) return null
  if (remainingMs >= 60_000) return `Edit (${Math.ceil(remainingMs / 60_000)} min)`
  return `Edit (${Math.ceil(remainingMs / 1_000)} sec)`
}

/**
 * The compact pencil on a collapsed bill, for as long as its tender can still
 * be corrected. `editableUntil` is null while the window has not started —
 * the bill's order is not prepared yet — and then there is nothing to expire.
 */
function PaymentEditIndicator({
  editableUntil,
  demoOffsetMs,
}: {
  editableUntil: string | null
  demoOffsetMs: number
}) {
  if (useWindowOpen(editableUntil, demoOffsetMs) === false) return null
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

/**
 * The tender edit, with its countdown where there is one to draw.
 *
 * A null `editableUntil` is a window that has **not started**: the bill's order
 * is still being made, so the payment is editable with no deadline. A countdown
 * that has not started must not be drawn as one, and must certainly not be
 * drawn as expired — so the control says what is true instead, and the
 * countdown appears when the clock does.
 */
function PaymentEditAction({
  editableUntil,
  demoOffsetMs,
  onEdit,
  onAdvanceDemoClock,
}: {
  editableUntil: string | null
  demoOffsetMs: number
  onEdit: () => void
  onAdvanceDemoClock?: (milliseconds: number) => void
}) {
  const [now, setNow] = useState<number | null>(null)
  const deadline = editableUntil === null ? null : Date.parse(editableUntil)
  const label =
    deadline === null
      ? 'Edit'
      : now === null
        ? null
        : paymentEditLabel(deadline - now - demoOffsetMs)

  // Re-read on every deadline change, not only on mount: a deadline that moved
  // while a stale `now` stood would round the countdown up by a whole minute.
  useEffect(() => {
    const timer = window.setTimeout(() => setNow(Date.now()), 0)
    return () => window.clearTimeout(timer)
  }, [deadline])

  useEffect(() => {
    if (!label || deadline === null) return
    const remaining = deadline - Date.now() - demoOffsetMs
    const delay = remaining >= 60_000 ? remaining % 60_000 || 60_000 : remaining % 1_000 || 1_000
    const timer = window.setTimeout(() => setNow(Date.now()), delay)
    return () => window.clearTimeout(timer)
  }, [deadline, demoOffsetMs, label, now])

  if (!label) return null
  if (deadline === null) {
    return (
      <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
        <p className="mr-auto text-xs text-content-muted">
          Editable until this order is marked prepared.
        </p>
        <Button size="phone" variant="secondary" onClick={onEdit}>
          {label}
        </Button>
      </div>
    )
  }
  return (
    <div className="mt-3 flex flex-wrap justify-end gap-2 border-t border-border pt-3">
      {onAdvanceDemoClock && (
        <>
          <Button
            size="phone"
            variant="ghost"
            onClick={() =>
              onAdvanceDemoClock(Math.max(0, deadline - Date.now() - demoOffsetMs - 59_000))
            }
          >
            Demo: 59 sec
          </Button>
          <Button
            size="phone"
            variant="ghost"
            onClick={() => onAdvanceDemoClock(Math.max(0, deadline - Date.now() - demoOffsetMs))}
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
