import { Check } from 'lucide-react'
import type { BillLineDraft } from '@/data-access/adapters'
import { cn } from '@/lib/cn'

export type ReadyCue = 'halo' | 'pulse-dot' | 'steady-dot'

export function ReadyDish({
  line,
  readyQuantity,
  interactive,
  onTick,
  cue = 'pulse-dot',
}: {
  line: BillLineDraft
  readyQuantity: number
  interactive: boolean
  onTick: () => void
  cue?: ReadyCue
}) {
  const ticked = (line.preparedQuantity ?? 0) >= line.quantity
  const ready = readyQuantity > (line.preparedQuantity ?? 0)
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
              ? 'border-primary'
              : 'border-content-muted',
        )}
      >
        {ticked && <Check size={11} strokeWidth={4} />}
        {ready && !ticked && (
          <span
            data-testid="dish-ready-cue"
            data-cue={cue}
            className={cn(
              'pointer-events-none',
              cue === 'halo'
                ? 'ready-checkbox-pulse absolute -inset-[3px] rounded-[5px] border border-primary bg-primary/10'
                : cue === 'pulse-dot'
                  ? 'ready-dot-pulse absolute inset-0 overflow-hidden rounded-[1.5px]'
                  : 'size-[5px] rounded-full bg-primary',
            )}
          />
        )}
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
            <span className={cn('block text-xs font-semibold', !ticked && 'text-accent-text')}>
              {line.note}
            </span>
          )}
        </span>
      </span>
    </>
  )
  const className = cn(
    'flex w-full items-center gap-0.5 rounded-md pl-1 text-left text-[13px] leading-4',
    ticked ? 'text-primary' : 'text-content',
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
            'cursor-pointer transition-[box-shadow,background-color] hover:bg-surface hover:shadow-sm focus-visible:focus-ring',
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
