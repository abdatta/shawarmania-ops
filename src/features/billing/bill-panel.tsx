import { Minus, Pencil, Plus } from 'lucide-react'
import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { Money } from '@/components/ui/money'
import type { BillLineDraft } from '@/data-access/adapters'
import { dishRows, isPackagingLine, isWaivedPackaging, lineKey, lineTotalPaise } from '@/domain'
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
 * Editing a saved order, most of the footer is not here — it has moved into the
 * card docked against this column at the top of the activity rail, beside the
 * order it is changing. **The customer row stays**, in the same place it sits
 * while composing, because a biller who has just learnt where the customer goes
 * should not have to find it again on the way back in [owner, 2026-09-19]. What
 * is left is what editing is about: the items, who they are for, and the accent
 * outline and title saying which order they belong to. See
 * `BillComposerFooter`, which is the one instance moving between the two.
 */
export function BillPanel({
  lines,
  labelField,
  onNote,
  onChangeQuantity,
  packagingFlat = false,
  editingOrderReference,
  footer,
  discountRows,
  addDiscount,
  moneyHidden = false,
}: {
  lines: BillLineDraft[]
  labelField?: ReactNode
  /**
   * The dish ticks' note action, for a row: its line not made yet (or its first,
   * when all of it is made) and how much of the row is made.
   */
  onNote?: (line: BillLineDraft, made: number) => void
  /** Keyed by `lineKey`, so the packaging line is changed like any other. */
  onChangeQuantity: (lineKey: string, delta: number) => void
  /**
   * The outlet charges packaging flat per order, so its line is one charge
   * that is removed rather than counted up and down.
   */
  packagingFlat?: boolean
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
  /**
   * A delivery order's panel (delivery-orders-are-made-not-billed): the
   * counter's prices are not what the platform charged, so no price is shown.
   */
  moneyHidden?: boolean
}) {
  const editing = editingOrderReference !== undefined
  /*
    The dish ticks draw one row per dish, note and price, with its true total:
    food the kitchen has made and food added since are separate lines only for
    the rail and the kitchen (owner, 2026-10-14). A row's controls are called by
    its first line's key. Off, a row is a line, as ever.
  */
  const rows = onNote
    ? dishRows(lines).map((row) => ({
        line: { ...row.lines[0]!, quantity: row.quantity },
        key: row.key,
        made: row.made,
        noted: row.growing ?? row.lines[0]!,
      }))
    : lines.map((line) => ({ line, key: lineKey(line), made: 0, noted: line }))

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

      {labelField}
      {/* No drawn scrollbar, as every scrolling column on the counter. */}
      <div
        className="no-scrollbar min-h-20 flex-1 overflow-y-auto px-3 md:min-h-0"
        data-testid="bill-lines"
      >
        {lines.length === 0 ? (
          <p className="py-6 text-center text-sm text-content-muted">
            Tap an item to start the order.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map(({ line, key, made, noted }, index) => {
              // A noted dish is its own row; the first row of a dish keeps the
              // menu item in its test id. Off, a line is its menu item, as ever.
              const testKey =
                !onNote || isPackagingLine(line)
                  ? key
                  : rows.findIndex((row) => row.line.menuItemId === line.menuItemId) === index
                    ? line.menuItemId
                    : key
              const packaging = isPackagingLine(line)
              const totalPaise = lineTotalPaise(line.unitPricePaise, line.quantity)
              // The gold waiver: the packaging line's whole amount as its own
              // discount (design D4). Nothing else can discount this line.
              const waived = isWaivedPackaging(line)
              return (
                <li
                  key={`${key}-${index}`}
                  data-testid={`bill-line-${testKey}`}
                  data-waived={waived || undefined}
                  className="flex items-center gap-2 py-2"
                >
                  {/* Wraps rather than truncating: this column is a fixed width, and
                      the end of an item's name is the part that distinguishes it. */}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold leading-tight text-content">
                      {line.itemName}
                    </p>
                    {onNote && line.note && (
                      <p className="text-xs font-semibold text-accent-text">{line.note}</p>
                    )}
                    {onNote && made > 0 && (
                      <p
                        data-testid={`bill-made-${testKey}`}
                        className="text-xs text-content-muted"
                      >
                        {made} made
                      </p>
                    )}
                    {!moneyHidden && (
                      <Money paise={line.unitPricePaise} className="text-xs text-content-muted" />
                    )}
                  </div>

                  {packaging && packagingFlat ? (
                    /*
                      A flat charge is one thing, not a count, and the counter
                      neither changes nor removes it [owner, 2026-09-27]: it goes
                      only when the order stops being takeaway. No control, so
                      none can be reached for.
                    */
                    <span aria-hidden className="w-28 shrink-0" />
                  ) : (
                    <div
                      className={cn(
                        'flex shrink-0 items-center',
                        onNote
                          ? 'gap-0 overflow-hidden rounded-full border border-border bg-surface'
                          : 'gap-1',
                      )}
                    >
                      <Button
                        variant="secondary"
                        size="phone"
                        className={cn(
                          onNote
                            ? 'h-10 w-8 rounded-none border-0 bg-transparent px-0 shadow-none hover:bg-surface-raised'
                            : 'w-10 px-0',
                        )}
                        aria-label={`One fewer ${line.itemName}`}
                        // Bags count down to one and no further: packaging is
                        // never removed at the counter [owner, 2026-09-27].
                        disabled={packaging && line.quantity <= 1}
                        onClick={() => onChangeQuantity(key, -1)}
                      >
                        <Minus aria-hidden size={16} />
                      </Button>
                      <span
                        data-numeric=""
                        data-testid={`bill-quantity-${testKey}`}
                        className="w-6 text-center text-sm font-bold"
                      >
                        {line.quantity}
                      </span>
                      <Button
                        variant="secondary"
                        size="phone"
                        className={cn(
                          onNote
                            ? 'h-10 w-8 rounded-none border-0 bg-transparent px-0 shadow-none hover:bg-surface-raised'
                            : 'w-10 px-0',
                        )}
                        aria-label={`One more ${line.itemName}`}
                        onClick={() => onChangeQuantity(key, 1)}
                      >
                        <Plus aria-hidden size={16} />
                      </Button>
                    </div>
                  )}

                  {moneyHidden ? null : waived ? (
                    <span className="flex w-20 shrink-0 flex-col items-end leading-tight">
                      <Money
                        paise={totalPaise}
                        className="text-xs text-content-muted line-through"
                      />
                      <span className="text-sm font-semibold text-success">Free</span>
                    </span>
                  ) : (
                    <Money
                      paise={totalPaise}
                      className={cn(
                        'shrink-0 text-right text-sm font-semibold',
                        onNote ? 'min-w-12' : 'w-20',
                      )}
                    />
                  )}
                  {onNote && !packaging && (
                    <Button
                      variant="secondary"
                      size="phone"
                      className="h-10 w-8 shrink-0 border-transparent bg-transparent px-0 shadow-none hover:border-border"
                      aria-label={`Note for ${line.itemName}`}
                      onClick={() => onNote(noted, made)}
                    >
                      <Pencil aria-hidden size={15} />
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
        )}

        {discountRows}
      </div>

      {addDiscount && <div className="px-3 pb-2">{addDiscount}</div>}

      {footer && <div className="border-t border-border p-3">{footer}</div>}
    </aside>
  )
}
