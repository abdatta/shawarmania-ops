import { UserRound } from 'lucide-react'

import { Money } from '@/components/ui/money'
import type { BillLineDraft } from '@/data-access/adapters'
import { formatRecentAge } from '@/domain'

/**
 * How an open order looks, in one place.
 *
 * Two surfaces draw an open order: the tablet's Open orders list, and the card
 * the activity rail docks against the composer while that order is being edited.
 * They have to be the *same* card — the docked one is the list's card after it
 * has moved, and a biller who watches it change shape mid-move has been shown
 * two different things and told they are one.
 *
 * Preparation work leads: customer if there is one, then every quantity, item and
 * line amount unabbreviated, with the total prominent. The order number is a
 * small reference, not a headline, and the creator's name appears only when it is
 * not the person already holding the tablet.
 */
export function OpenOrderCardBody({
  orderNumber,
  localReference,
  orderedAt,
  customerName,
  creatorName,
  lines,
  showLines = true,
}: {
  orderNumber: number
  localReference?: string | null
  orderedAt: string
  customerName: string | null
  /** Omitted for the current shift holder — they know who took the order. */
  creatorName?: string | undefined
  lines: BillLineDraft[]
  /**
   * The list is the point of this card in Open orders, where it is preparation
   * work. It is off on the docked card, where the composer beside it is already
   * showing the same items and editing them.
   */
  showLines?: boolean
}) {
  const totalPaise = lines.reduce((sum, line) => sum + line.unitPricePaise * line.quantity, 0)
  const reference = localReference ?? `Order #${orderNumber}`

  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {customerName && (
            <p className="flex items-start gap-1.5 text-base font-black leading-5 text-content">
              <UserRound aria-hidden className="mt-0.5 shrink-0 text-accent-text" size={17} />
              <span>{customerName}</span>
            </p>
          )}
          <div
            className={
              customerName
                ? 'mt-1 flex flex-wrap items-center gap-1.5'
                : 'flex flex-wrap items-center gap-1.5'
            }
          >
            <span className="rounded-md border border-border bg-surface px-1.5 py-0.5 text-xs font-bold text-content-muted">
              {reference}
            </span>
            <span className="text-xs text-content-muted">
              {formatRecentAge(orderedAt)}
              {creatorName && <> · {creatorName}</>}
            </span>
          </div>
        </div>
        <Money paise={totalPaise} display className="shrink-0 font-black text-content" />
      </div>

      {showLines && (
        <ul className="mt-3 space-y-1.5" aria-label={`Items for ${reference}`}>
          {lines.map((line) => (
            <li key={line.menuItemId} className="flex items-start gap-2 text-sm text-content">
              <span className="min-w-7 rounded-md bg-primary px-1.5 py-0.5 text-center font-black leading-5 text-on-primary">
                {line.quantity}×
              </span>
              <span className="min-w-0 flex-1 pt-0.5 font-bold leading-5">{line.itemName}</span>
              <Money
                paise={line.unitPricePaise * line.quantity}
                className="shrink-0 pt-0.5 text-sm font-bold"
              />
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
