import { Pencil, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Money } from '@/components/ui/money'
import type { BillDiscountDraft, BillLineDraft } from '@/data-access/adapters'
import { formatPaise, groupMenuDiscounts, menuDiscountLabel } from '@/domain'

/**
 * What came off, as rows in the bill column beside the items.
 *
 * They sit with the lines rather than in a summary block because that is what
 * they are to the person reading the bill: things that happened to this order.
 *
 * **Menu rows carry no controls at all.** They are the owner's, and a biller
 * cancelling the owner's discount for one customer is a decision rather than a
 * keystroke [owner, 2026-09-03]. Bill rows carry edit and delete, where an item
 * row carries plus and minus.
 */

/** One row as it is drawn: a title, a subtext, an amount, and maybe controls. */
interface DiscountRow {
  key: string
  title: string
  subtext: string
  amountPaise: number
  /** Present only on a discount this counter may change. */
  billIndex?: number
}

/**
 * Turn the shared grouping into the rows this column draws.
 *
 * The grouping itself lives in `@/domain` because the customer's receipt needs
 * the same rule and cannot reuse this component: it renders a settled bill in
 * SQL, and this renders a draft that has no rows in the database yet. The two
 * are held together by `discount-row-cases.json`.
 *
 * What stays here is the wording, and one case that is deliberately only the
 * counter's: **every category on the menu covered reads as `All Items`**. That
 * is a claim about what the menu contains, which this surface can make while
 * the sale is happening and a later reader cannot -- which is why the manager's
 * bill detail passes an infinite `categoryCount` and the receipt does not offer
 * the phrase at all.
 */
function menuDiscountRows(lines: readonly BillLineDraft[], categoryCount: number): DiscountRow[] {
  return groupMenuDiscounts(lines).map((group) => {
    const label = menuDiscountLabel(group, formatPaise)
    return {
      key: `menu-${label}`,
      title: `Menu Discount (${label})`,
      subtext:
        group.categories.length > 0 && group.categories.length === categoryCount
          ? 'All Items'
          : group.categories.join(', '),
      amountPaise: group.amountPaise,
    }
  })
}

export function BillDiscountRows({
  lines,
  discounts,
  categoryCount,
  roundingPaise,
  editable,
  onEdit,
  onRemove,
}: {
  lines: readonly BillLineDraft[]
  discounts: readonly BillDiscountDraft[]
  categoryCount: number
  roundingPaise: number
  /** False on another till's order, and on a bill that is already history. */
  editable: boolean
  onEdit?: (index: number) => void
  onRemove?: (index: number) => void
}) {
  const menuRows = menuDiscountRows(lines, categoryCount)

  const billRows: DiscountRow[] = discounts.map((discount, index) => ({
    key: `bill-${index}`,
    title:
      discount.basis === 'percent'
        ? `Discount (${(discount.valueBp ?? 0) / 100}%)`
        : `Discount (${formatPaise(discount.valuePaise ?? 0)})`,
    subtext: 'On this bill',
    amountPaise: discount.amountPaise,
    billIndex: index,
  }))

  if (menuRows.length === 0 && billRows.length === 0 && roundingPaise === 0) return null

  return (
    <ul className="divide-y divide-border border-t border-border" data-testid="bill-discount-rows">
      {[...menuRows, ...billRows].map((row) => (
        <li
          key={row.key}
          data-testid={`discount-row-${row.key}`}
          className="flex items-center gap-2 py-2"
        >
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold leading-tight text-content">{row.title}</p>
            {row.subtext && <p className="text-xs text-content-muted">{row.subtext}</p>}
          </div>

          {row.billIndex !== undefined && editable && (
            <div className="flex shrink-0 items-center gap-1">
              <Button
                variant="secondary"
                size="phone"
                className="w-10 px-0"
                aria-label={`Edit ${row.title}`}
                onClick={() => onEdit?.(row.billIndex!)}
              >
                <Pencil aria-hidden size={15} />
              </Button>
              <Button
                variant="secondary"
                size="phone"
                className="w-10 px-0"
                aria-label={`Remove ${row.title}`}
                onClick={() => onRemove?.(row.billIndex!)}
              >
                <Trash2 aria-hidden size={15} />
              </Button>
            </div>
          )}

          <Money
            paise={-row.amountPaise}
            className="w-20 shrink-0 text-right text-sm font-semibold"
          />
        </li>
      ))}

      {roundingPaise > 0 && (
        <li data-testid="discount-row-rounding" className="flex items-center gap-2 py-2">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold leading-tight text-content">Round up</p>
            <p className="text-xs text-content-muted">To the nearest rupee</p>
          </div>
          <Money paise={roundingPaise} className="w-20 shrink-0 text-right text-sm font-semibold" />
        </li>
      )}
    </ul>
  )
}
