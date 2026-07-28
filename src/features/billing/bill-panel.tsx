import { Banknote, Minus, Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Money } from '@/components/ui/money'
import type { BillLineDraft, PaymentMethod } from '@/data-access/adapters'
import { billTotals, lineTotalPaise } from '@/domain'
import { cn } from '@/lib/cn'

/**
 * The current bill: what is on it, who it is for, how it was paid, and Settle.
 *
 * Everything below the line list is pinned. An order that runs long scrolls
 * *inside* the list, so the total, the payment methods and Settle are never
 * scrolled off — a settle control that can hide is a settle control that costs
 * a queue.
 *
 * **Cash is distinguished by size and position as well as colour**: it is the
 * only method on its own full-width row, with a note that it is the one that
 * reaches the drawer. It is also the most-tapped, so the largest target is the
 * right one anyway.
 *
 * Customer name and phone are genuinely optional and are placed after the total
 * and before payment, where they are skippable by looking past them. At peak
 * they will be, and a required field here would collect a hundred junk values a
 * day.
 */

/** The six methods, cash first because it is both the commonest and the special one. */
const OTHER_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'upi', label: 'UPI' },
  { value: 'card', label: 'Card' },
  { value: 'swiggy', label: 'Swiggy' },
  { value: 'zomato', label: 'Zomato' },
  { value: 'other', label: 'Other' },
]

export function BillPanel({
  lines,
  customerName,
  customerPhone,
  paymentMethod,
  settling,
  onChangeQuantity,
  onCustomerNameChange,
  onCustomerPhoneChange,
  onPaymentMethodChange,
  onSettle,
}: {
  lines: BillLineDraft[]
  customerName: string
  customerPhone: string
  paymentMethod: PaymentMethod | null
  settling: boolean
  onChangeQuantity: (menuItemId: string, delta: number) => void
  onCustomerNameChange: (value: string) => void
  onCustomerPhoneChange: (value: string) => void
  onPaymentMethodChange: (method: PaymentMethod) => void
  onSettle: () => void
}) {
  const totals = billTotals(
    lines.map((line) => ({ unitPricePaise: line.unitPricePaise, quantity: line.quantity })),
  )

  return (
    /*
      `flex-1` so the panel fills its column: Settle then sits at the bottom of
      the screen, under the hand holding the tablet, rather than floating
      wherever the current order happens to end.
    */
    <aside
      aria-label="Current bill"
      data-testid="bill-panel"
      className="flex min-h-0 flex-1 flex-col rounded-xl border border-border bg-surface"
    >
      <h2 className="border-b border-border px-3 py-2 text-sm font-bold text-content">
        Current bill
      </h2>

      <div className="min-h-0 flex-1 overflow-y-auto px-3" data-testid="bill-lines">
        {lines.length === 0 ? (
          <p className="py-6 text-center text-sm text-content-muted">
            Tap an item to start the order.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {lines.map((line) => (
              <li
                key={line.menuItemId}
                data-testid={`bill-line-${line.menuItemId}`}
                className="flex items-center gap-2 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-content">{line.itemName}</p>
                  <Money paise={line.unitPricePaise} className="text-xs text-content-muted" />
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="secondary"
                    size="phone"
                    className="w-10 px-0"
                    aria-label={`One fewer ${line.itemName}`}
                    onClick={() => onChangeQuantity(line.menuItemId, -1)}
                  >
                    <Minus aria-hidden size={16} />
                  </Button>
                  <span
                    data-numeric=""
                    data-testid={`bill-quantity-${line.menuItemId}`}
                    className="w-6 text-center text-sm font-bold"
                  >
                    {line.quantity}
                  </span>
                  <Button
                    variant="secondary"
                    size="phone"
                    className="w-10 px-0"
                    aria-label={`One more ${line.itemName}`}
                    onClick={() => onChangeQuantity(line.menuItemId, 1)}
                  >
                    <Plus aria-hidden size={16} />
                  </Button>
                </div>

                <Money
                  paise={lineTotalPaise(line.unitPricePaise, line.quantity)}
                  className="w-20 shrink-0 text-right text-sm font-semibold"
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-3 border-t border-border p-3">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-semibold text-content-muted">Total</span>
          <Money paise={totals.totalPaise} display data-testid="bill-total" />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="sr-only" htmlFor="customer-name">
            Customer name (optional)
          </label>
          <Input
            id="customer-name"
            className="h-11"
            autoComplete="off"
            placeholder="Customer (optional)"
            value={customerName}
            onChange={(event) => onCustomerNameChange(event.target.value)}
          />
          <label className="sr-only" htmlFor="customer-phone">
            Customer phone (optional)
          </label>
          <Input
            id="customer-phone"
            className="h-11"
            type="tel"
            autoComplete="off"
            placeholder="Phone (optional)"
            value={customerPhone}
            onChange={(event) => onCustomerPhoneChange(event.target.value)}
          />
        </div>

        <div role="group" aria-label="Payment method" className="space-y-2">
          <Button
            variant={paymentMethod === 'cash' ? 'primary' : 'secondary'}
            size="phone"
            className="w-full"
            aria-pressed={paymentMethod === 'cash'}
            data-testid="method-cash"
            onClick={() => onPaymentMethodChange('cash')}
          >
            <Banknote aria-hidden size={18} />
            Cash — goes in the drawer
          </Button>
          <div className="grid grid-cols-3 gap-2">
            {OTHER_METHODS.map((method) => (
              <Button
                key={method.value}
                variant={paymentMethod === method.value ? 'primary' : 'secondary'}
                size="phone"
                aria-pressed={paymentMethod === method.value}
                data-testid={`method-${method.value}`}
                onClick={() => onPaymentMethodChange(method.value)}
              >
                {method.label}
              </Button>
            ))}
          </div>
        </div>

        <Button
          size="control"
          className={cn('w-full text-lg')}
          disabled={settling}
          data-testid="settle"
          onClick={onSettle}
        >
          Settle
        </Button>
      </div>
    </aside>
  )
}
