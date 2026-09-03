import { Minus, Pencil, Plus } from 'lucide-react'
import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { Money } from '@/components/ui/money'
import type { BillLineDraft } from '@/data-access/adapters'
import { lineTotalPaise } from '@/domain'
import { cn } from '@/lib/cn'

/**
 * The current bill: what is on it, and — for a new order — how it leaves.
 *
 * Composing a new bill, everything below the line list is pinned: an order that
 * runs long scrolls *inside* the list, so the total, the customer fields and both
 * terminal actions are never scrolled off. A control that can hide is a control
 * that costs a queue. **Order is the primary action**, because the ordinary sale
 * is cooked before it is paid for, and Mark Paid is the secondary upfront path.
 * Neither captures tender here; that is a dialog, so method buttons cannot crowd
 * the panel.
 *
 * Editing a saved order, the footer is not here at all — it has moved into the
 * card docked against this column at the top of the activity rail, beside the
 * order it is changing. What is left is exactly what editing is about: the items,
 * and the accent outline and title saying which order they belong to. See
 * `BillComposerFooter`, which is the one instance moving between the two.
 */
export function BillPanel({
  lines,
  onChangeQuantity,
  editingOrderReference,
  footer,
  discountRows,
  addDiscount,
}: {
  lines: BillLineDraft[]
  onChangeQuantity: (menuItemId: string, delta: number) => void
  editingOrderReference?: string
  /** The composer footer, when this panel is the one holding it. */
  footer?: ReactNode
  /**
   * What came off, and the round-up, as rows beneath the items. They belong
   * inside the scrolling list rather than above the footer, because they are
   * part of the bill rather than part of the controls that finish it.
   */
  discountRows?: ReactNode
  /** The control that opens the discount panel, pinned under the lines. */
  addDiscount?: ReactNode
}) {
  const editing = editingOrderReference !== undefined

  return (
    /*
      `flex-1` so the panel fills its column: the footer then sits at the bottom
      of the screen rather than floating wherever the current order happens to
      end.
    */
    <aside
      id="bill-panel"
      aria-label="Current bill"
      data-testid="bill-panel"
      data-editing={editing ? '' : undefined}
      className={cn(
        'flex min-h-0 flex-1 flex-col rounded-xl border bg-surface',
        // A ring rather than a thicker border: an accent outline that appears on
        // edit must not reflow the column it appears in.
        editing ? 'border-primary ring-1 ring-primary' : 'border-border',
      )}
    >
      <h2
        className={cn(
          'flex items-center gap-1.5 border-b px-3 py-2 text-sm font-bold',
          editing ? 'border-primary text-accent-text' : 'border-border text-content',
        )}
      >
        {editing && <Pencil aria-hidden size={15} />}
        {editing ? `Editing ${editingOrderReference}` : 'Current bill'}
      </h2>

      <div className="min-h-20 flex-1 overflow-y-auto px-3 md:min-h-0" data-testid="bill-lines">
        {lines.length === 0 ? (
          <p className="py-6 text-center text-sm text-content-muted">
            Tap an item to start the order.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {lines.map((line, index) => (
              <li
                key={`${line.menuItemId}-${index}`}
                data-testid={`bill-line-${line.menuItemId}`}
                className="flex items-center gap-2 py-2"
              >
                {/* Wraps rather than truncating: this column is a fixed width, and
                    the end of an item's name is the part that distinguishes it. */}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold leading-tight text-content">
                    {line.itemName}
                  </p>
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

        {discountRows}
      </div>

      {addDiscount && <div className="px-3 pb-2">{addDiscount}</div>}

      {footer && <div className="border-t border-border p-3">{footer}</div>}
    </aside>
  )
}
