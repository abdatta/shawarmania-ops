import { Check, ListPlus, Minus, Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Money } from '@/components/ui/money'
import type { BillLineDraft } from '@/data-access/adapters'
import { billTotals, lineTotalPaise } from '@/domain'

/**
 * The current bill: what is on it, who it is for, and how work leaves the composer.
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
 * Either customer name or phone is required by this UI trial. The database keeps
 * both nullable so the owner can reverse the trial without a migration.
 */

export function BillPanel({
  lines,
  customerName,
  customerPhone,
  settling,
  onChangeQuantity,
  onCustomerNameChange,
  onCustomerPhoneChange,
  onPaid,
  onSaveOrder,
  editingOrderNumber,
  onCancelEdit,
}: {
  lines: BillLineDraft[]
  customerName: string
  customerPhone: string
  settling: boolean
  onChangeQuantity: (menuItemId: string, delta: number) => void
  onCustomerNameChange: (value: string) => void
  onCustomerPhoneChange: (value: string) => void
  onPaid: () => void
  onSaveOrder: () => void
  editingOrderNumber?: number
  onCancelEdit?: () => void
}) {
  const totals = billTotals(
    lines.map((line) => ({ unitPricePaise: line.unitPricePaise, quantity: line.quantity })),
  )
  const hasCustomerIdentity = customerName.trim() !== '' || customerPhone.trim() !== ''
  const canComplete = !settling && lines.length > 0 && hasCustomerIdentity
  const editing = editingOrderNumber !== undefined

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
        {editing ? `Editing order #${editingOrderNumber}` : 'Current bill'}
      </h2>

      <div className="min-h-20 flex-1 overflow-y-auto px-3 md:min-h-0" data-testid="bill-lines">
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
            Customer name
          </label>
          <Input
            id="customer-name"
            className="h-11"
            autoComplete="off"
            placeholder="Customer name"
            aria-describedby={
              lines.length > 0 && !hasCustomerIdentity ? 'customer-requirement' : undefined
            }
            value={customerName}
            onChange={(event) => onCustomerNameChange(event.target.value)}
          />
          <label className="sr-only" htmlFor="customer-phone">
            Customer phone
          </label>
          <Input
            id="customer-phone"
            className="h-11"
            type="tel"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            placeholder="Phone number"
            aria-describedby={
              lines.length > 0 && !hasCustomerIdentity ? 'customer-requirement' : undefined
            }
            value={customerPhone}
            onChange={(event) => onCustomerPhoneChange(event.target.value)}
          />
        </div>

        {lines.length > 0 && !hasCustomerIdentity && (
          <p id="customer-requirement" className="text-xs font-semibold text-danger">
            Add a customer name or phone to continue.
          </p>
        )}

        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
          <Button
            size="control"
            className="w-full text-lg"
            disabled={!canComplete}
            data-testid="save-order"
            onClick={onSaveOrder}
          >
            {editing ? <Check aria-hidden size={18} /> : <ListPlus aria-hidden size={18} />}
            {editing ? 'Save changes' : 'Order'}
          </Button>
          {editing ? (
            <Button
              variant="secondary"
              size="control"
              disabled={settling}
              data-testid="cancel-edit"
              onClick={onCancelEdit}
            >
              Cancel edit
            </Button>
          ) : (
            <Button
              variant="secondary"
              size="control"
              disabled={!canComplete}
              data-testid="settle"
              onClick={onPaid}
            >
              Mark Paid
            </Button>
          )}
        </div>
      </div>
    </aside>
  )
}
