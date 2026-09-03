import { Pencil, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Money } from '@/components/ui/money'
import type { BillDiscountDraft, BillLineDraft } from '@/data-access/adapters'
import { formatPaise } from '@/domain'

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
 * Group the menu's line discounts into the rows a person reads.
 *
 * Three cases, in order, and they are the owner's:
 *   - every category on the menu covered → one row saying `All Items`
 *   - several categories at one value → one row listing them
 *   - different values → a row each
 *
 * Derived from the lines rather than stored, so a row can never disagree with
 * the lines it is describing.
 */
function menuDiscountRows(lines: readonly BillLineDraft[], categoryCount: number): DiscountRow[] {
  const groups = new Map<string, { label: string; categories: Set<string>; paise: number }>()

  for (const line of lines) {
    const paise = line.discountPaise ?? 0
    if (paise <= 0) continue

    // Grouped by what the customer was actually given: a percentage groups by
    // that percentage, and a rupee discount by its per-unit amount, because two
    // lines at "₹20 off each" are one discount however different their totals.
    const label =
      line.discountPercentBp != null
        ? `${line.discountPercentBp / 100}%`
        : formatPaise(Math.round(paise / Math.max(1, line.quantity)))

    const group = groups.get(label) ?? { label, categories: new Set<string>(), paise: 0 }
    if (line.categoryName) group.categories.add(line.categoryName)
    group.paise += paise
    groups.set(label, group)
  }

  return [...groups.values()].map((group) => {
    const names = [...group.categories]
    return {
      key: `menu-${group.label}`,
      title: `Menu Discount (${group.label})`,
      subtext: names.length > 0 && names.length === categoryCount ? 'All Items' : names.join(', '),
      amountPaise: group.paise,
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
