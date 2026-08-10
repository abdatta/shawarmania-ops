import { ChevronDown } from 'lucide-react'

import { Money } from '@/components/ui/money'
import type { BillingBill } from '@/data-access/adapters'
import { formatDateTime, lineTotalPaise } from '@/domain'
import { cn } from '@/lib/cn'

function methodLabel(method: BillingBill['paymentMethod']) {
  return method === 'upi' ? 'UPI' : method[0]!.toUpperCase() + method.slice(1)
}

/** A closed bill is a compact summary until somebody needs to inspect its facts. */
export function ShiftBillList({
  bills,
  compact = false,
}: {
  bills: BillingBill[]
  compact?: boolean
}) {
  return (
    <ul className={cn('divide-y divide-border', !compact && 'rounded-xl border border-border')}>
      {bills.map((bill) => (
        <li key={bill.id}>
          <details className="group" data-testid={`shift-bill-${bill.id}`}>
            <summary
              className={cn(
                'flex min-h-12 cursor-pointer list-none items-center gap-2 text-content focus-visible:focus-ring',
                compact ? 'px-1 py-2' : 'px-3 py-2.5',
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="font-bold">Bill {bill.billNumber}</span>
                  {bill.orderNumber !== null && (
                    <span className="text-xs font-semibold text-content-muted">
                      Order {bill.orderNumber}
                    </span>
                  )}
                </div>
                <p className="truncate text-xs text-content-muted">
                  {formatDateTime(bill.paidAt)} · {methodLabel(bill.paymentMethod)}
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
                      <p className="truncate text-sm font-semibold text-content">{line.itemName}</p>
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
                  {formatDateTime(bill.paidAt)}
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
            </div>
          </details>
        </li>
      ))}
    </ul>
  )
}
