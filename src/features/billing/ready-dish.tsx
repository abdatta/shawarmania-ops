import { Check } from 'lucide-react'

import type { BillLineDraft } from '@/data-access/adapters'
import { cn } from '@/lib/cn'

/**
 * One dish on a rail card, ticked off on its own (each-dish-is-ticked-off,
 * design D6, D9, R6; `dish-ticks`).
 *
 * Three looks. **Waiting**: a gray checkbox beside the quantity and the name.
 * **Ready** (`kitchen-ready`, when a kitchen has marked more of it Ready than
 * the counter has ticked): the whole row fills with the orange accent, its text
 * inverted, the checkbox kept gray on it (owner, 2026-10-14), and a light band
 * crosses it until it is ticked (owner, 2026-10-12). **Ticked**: orange text and a filled
 * checkbox. A tap ticks or unticks; the quantity is always its own and visible.
 */
export function ReadyDish({
  line,
  readyQuantity,
  readyOn,
  interactive,
  onTick,
}: {
  line: BillLineDraft
  readyQuantity: number
  /** `kitchen-ready`: off, a dish the kitchen marked Ready reads as waiting. */
  readyOn: boolean
  interactive: boolean
  onTick: () => void
}) {
  const ticked = (line.preparedQuantity ?? 0) >= line.quantity
  const ready = readyOn && !ticked && readyQuantity > (line.preparedQuantity ?? 0)
  const contents = (
    <>
      <span
        aria-hidden
        data-testid="dish-checkbox"
        className={cn(
          'relative grid size-[15px] shrink-0 place-items-center rounded-[3px] border-[1.5px]',
          ticked
            ? 'border-primary bg-primary text-on-primary'
            : ready
              ? 'border-content-muted bg-surface'
              : 'border-content-muted',
        )}
      >
        {ticked && <Check size={11} strokeWidth={4} />}
      </span>
      <span className="flex min-h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-transparent px-1.5 py-1">
        <span
          data-testid="dish-quantity"
          className="grid h-4 min-w-4 shrink-0 place-items-center text-xs font-black tabular-nums"
        >
          {line.quantity}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-bold">{line.itemName}</span>
          {line.note && (
            <span
              className={cn('block text-xs font-semibold', !ticked && !ready && 'text-accent-text')}
            >
              {line.note}
            </span>
          )}
        </span>
      </span>
    </>
  )
  const className = cn(
    'flex w-full items-center gap-0.5 rounded-md pl-1 text-left text-[13px] leading-4',
    ready ? 'dish-ready-fill' : ticked ? 'text-primary' : 'text-content',
  )
  return (
    <li data-ready={ready || undefined} data-ticked={ticked || undefined}>
      {interactive ? (
        <button
          type="button"
          aria-label={`${ticked ? 'Untick' : 'Tick'} ${line.quantity} ${line.itemName}${line.note ? `, ${line.note}` : ''}`}
          aria-pressed={ticked}
          aria-description={ready ? 'Kitchen ready — tick when handed over' : undefined}
          onClick={onTick}
          className={cn(
            className,
            'cursor-pointer transition-[box-shadow,background-color] hover:shadow-sm focus-visible:focus-ring',
            !ready && 'hover:bg-surface',
          )}
        >
          {contents}
        </button>
      ) : (
        <div className={className}>{contents}</div>
      )}
    </li>
  )
}
