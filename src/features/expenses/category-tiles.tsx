import { Check } from 'lucide-react'

import type { ExpenseCategoryChoice } from '@/data-access/adapters'
import { cn } from '@/lib/cn'

/**
 * An expense's category, picked from the owners' list as tiles
 * (a-check-in-at-the-shop-approves-itself, design D11; `expense-category-list`).
 * Each is as wide as its name and they flow onto as many lines as they need,
 * each line's tiles stretching to fill it, rather than a two-column grid that
 * leaves short names floating in wide boxes [owner, 2026-10-29].
 *
 * **Nothing is pre-chosen**, for the reason the payment method starts on
 * Choose…: a default that is right most days is one missed tap from a month
 * filed under the wrong heading. A name already on the expense being edited
 * that the list does not hold is one more tile, chosen, so changing an old
 * entry's amount never forces it to be re-filed.
 */
export function CategoryTiles({
  choices,
  value,
  onChange,
}: {
  /** Already narrowed to what this reader may pick. */
  choices: readonly ExpenseCategoryChoice[]
  value: string
  onChange: (name: string) => void
}) {
  const names = choices.map((choice) => choice.name)
  const recorded =
    value && !names.some((name) => name.toLocaleLowerCase() === value.toLocaleLowerCase())
      ? value
      : null
  const tiles = recorded ? [...names, recorded] : names

  return (
    <div
      role="radiogroup"
      aria-labelledby="expense-category-label"
      className="flex flex-wrap gap-2"
      data-testid="expense-category-tiles"
    >
      {tiles.map((name) => {
        const chosen = name.toLocaleLowerCase() === value.toLocaleLowerCase()
        return (
          <button
            key={name}
            type="button"
            role="radio"
            aria-checked={chosen}
            data-testid={`expense-category-tile-${name}`}
            onClick={() => onChange(name)}
            className={cn(
              'flex min-h-12 grow items-center justify-center gap-2 rounded-xl border py-2 text-center text-sm font-semibold focus-visible:focus-ring',
              // The tick and its gap (24px) come out of the padding, so a chosen
              // tile is no wider and the lines never reflow under the thumb;
              // the name and tick are centred together [owner, 2026-10-29].
              chosen
                ? 'border-primary bg-primary/10 px-5 text-accent-text'
                : 'border-border bg-surface px-8 text-content hover:bg-surface-raised',
            )}
          >
            <span className="min-w-0 break-words">{name}</span>
            {chosen && <Check aria-hidden size={16} className="shrink-0" />}
          </button>
        )
      })}
    </div>
  )
}
