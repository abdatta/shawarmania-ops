import { Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { Input } from '@/components/ui/input'
import { Money } from '@/components/ui/money'
import { VegMarker } from '@/components/ui/veg-marker'
import type { MenuCategoryWithItems } from '@/data-access/adapters'
import type { Tables } from '@/data-access/database.types'
import { cn } from '@/lib/cn'

import { filterMenu } from './menu-search'

/**
 * The menu, whole, with a search over it.
 *
 * The menu outgrew one screen, so a biller can type to narrow it. The search is
 * a filter over the menu the counter already holds, never a request, and it
 * **stays until the biller clears it** — with ×, or Escape — so a run of taps on
 * the same few tiles does not mean retyping between each one.
 *
 * **A tile adds, and only adds.** Quantity is adjusted on the bill line
 * instead, because a −/+ pair here would halve the target at exactly the moment
 * speed matters — and a mis-tap would then quietly *decrement* an order rather
 * than visibly miss it. The count rides on the tile as feedback, not as a
 * control.
 *
 * An unavailable item stays on the grid and refuses to be sold. A tile that
 * vanished when the kitchen ran out would read as a bug to whoever was looking
 * straight at it.
 */
export function MenuGrid({
  menu,
  quantities,
  onAdd,
}: {
  menu: MenuCategoryWithItems[]
  /** Quantity currently on the bill, by menu item id. */
  quantities: Map<string, number>
  onAdd: (item: Tables<'menu_items'>) => void
}) {
  const [query, setQuery] = useState('')
  const shown = useMemo(() => filterMenu(menu, query), [menu, query])

  return (
    <div className="space-y-3" data-testid="menu-grid">
      <MenuSearch query={query} onChange={setQuery} />
      {shown.length === 0 && (
        <p data-testid="menu-search-empty" className="py-6 text-center text-sm text-content-muted">
          No item matches &ldquo;{query.trim()}&rdquo;.
        </p>
      )}
      {shown.map(({ category, items }) => (
        <section key={category.id} aria-label={category.name}>
          <h2 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-content-muted">
            {category.name}
          </h2>
          {/*
            Sized against **this column**, not the viewport. The counter's menu
            column is a fixed 22rem once the layout starts scrolling sideways, so
            a viewport-keyed `sm:grid-cols-3` would put three tiles in a phone's
            width of space at exactly the wrong moment.
          */}
          <div className="grid grid-cols-2 gap-2 @md:grid-cols-3 @2xl:grid-cols-4">
            {items.map((item) => {
              const quantity = quantities.get(item.id) ?? 0
              return (
                <button
                  key={item.id}
                  type="button"
                  disabled={!item.is_available}
                  data-testid={`tile-${item.id}`}
                  aria-label={`${item.name}${item.is_available ? '' : ' — unavailable'}`}
                  onClick={() => onAdd(item)}
                  className={cn(
                    // `min-h-20` rather than `h-20`: a tile grows to fit its name.
                    // Every row of the grid stretches to its tallest tile, so the
                    // grid stays even without any tile having to truncate.
                    'flex min-h-20 items-start gap-2 rounded-xl border p-2 text-left',
                    'focus-visible:focus-ring',
                    item.is_available
                      ? 'border-border bg-surface hover:bg-surface-raised'
                      : 'cursor-not-allowed border-dashed border-border bg-surface-raised opacity-60',
                    quantity > 0 && 'border-primary',
                  )}
                >
                  <span className="flex min-w-0 flex-1 items-start gap-1.5">
                    <VegMarker isVeg={item.is_veg} className="mt-0.5" />
                    {/*
                      Never truncated. A biller picking between "Mozzarella Cheese
                      Chicken Shawarma" and "Mayonnaise Chicken Shawarma" needs the
                      end of the name, and an ellipsis takes exactly the part that
                      tells them apart.
                    */}
                    <span className="text-sm font-semibold leading-tight text-content">
                      {item.name}
                    </span>
                  </span>

                  {/*
                    Top-right on every tile — the one place the eye can sweep down
                    a column without the figure moving because the name above it
                    wrapped onto a second line.

                    An unavailable item shows **Unavailable instead of its price**, not as
                    well as it. The price of something nobody can sell is the one
                    number on this screen that cannot be acted on, and next to a
                    column of prices that can be, it is a figure a biller might
                    quote to a customer before noticing the tile is dashed.
                  */}
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    {item.is_available ? (
                      <>
                        <Money paise={item.price_paise} className="text-sm font-bold" />
                        {quantity > 0 && (
                          <span
                            data-testid={`tile-count-${item.id}`}
                            className="rounded-lg bg-primary px-2 text-xs font-bold text-on-primary"
                          >
                            ×{quantity}
                          </span>
                        )}
                      </>
                    ) : (
                      // Normal case at the badge size, not tracked capitals: the word
                      // is three times OFF's length and the name beside it is never
                      // truncated, so it must fit the slot a price takes (design D3).
                      <span className="rounded-md border border-border px-1.5 py-0.5 text-[0.6875rem] font-bold text-content-muted">
                        Unavailable
                      </span>
                    )}
                  </span>
                </button>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}

/**
 * A text field, so it raises the touch keyboard, and the one text field on the
 * counter's main surface — no number pad listens outside a dialog, so typing
 * here never reaches one.
 *
 * **Escape clears it from anywhere on the surface**, not only while it has
 * focus: a tap on a tile takes focus away, and the search outlives the tap.
 * Escape already means something else in three places here, and each of them
 * wins: an open dialog closes, the account menu closes, and a card's actions
 * menu is left alone. Escape only clears the search when none of them is open,
 * and never while another text field has the key.
 */
function MenuSearch({ query, onChange }: { query: string; onChange: (query: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (query === '') return

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      if (document.querySelector('dialog[open], details[open], [role="menu"]')) return
      const focused = document.activeElement
      if (
        focused !== inputRef.current &&
        (focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement)
      ) {
        return
      }
      event.preventDefault()
      onChange('')
      inputRef.current?.blur()
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [query, onChange])

  return (
    // Sticky inside the menu column's own scroll, so the field stays in reach
    // however far down a long result list the biller has scrolled.
    //
    // The 3px of padding is the focus ring's width. The ring is drawn outside
    // the field, and the column's scroll clips whatever crosses its edge, so a
    // field flush against that edge kept only the bottom of its ring and read as
    // underlined rather than focused.
    <div className="sticky top-0 z-10 bg-canvas px-[3px] pb-1 pt-[3px]" role="search">
      <div className="relative">
        <Search
          aria-hidden
          size={18}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-content-muted"
        />
        <Input
          ref={inputRef}
          type="text"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          aria-label="Search the menu"
          placeholder="Search the menu"
          data-testid="menu-search"
          value={query}
          onChange={(event) => onChange(event.target.value)}
          className="pl-10 pr-11"
        />
        {query !== '' && (
          <button
            type="button"
            aria-label="Clear search"
            data-testid="menu-search-clear"
            // Clearing drops the cursor too, so a touch screen's keyboard goes
            // away with the search rather than covering the grid it restored.
            onClick={() => {
              onChange('')
              inputRef.current?.blur()
            }}
            className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-content-muted hover:bg-surface-raised hover:text-content focus-visible:focus-ring"
          >
            <X aria-hidden size={18} />
          </button>
        )}
      </div>
    </div>
  )
}
