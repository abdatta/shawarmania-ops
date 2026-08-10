import { Money } from '@/components/ui/money'
import { VegMarker } from '@/components/ui/veg-marker'
import type { MenuCategoryWithItems } from '@/data-access/adapters'
import type { Tables } from '@/data-access/database.types'
import { cn } from '@/lib/cn'

/**
 * The menu, whole, on one screen.
 *
 * Seven items today against a stated ceiling of about twenty, so there is no
 * search box and no category drilling: at a counter, looking is faster than
 * typing, and a biller who has to find an item has already lost the order's
 * worth of time.
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
  return (
    <div className="space-y-3" data-testid="menu-grid">
      {menu.map(({ category, items }) => (
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
                  aria-label={`${item.name}${item.is_available ? '' : ' — off the menu'}`}
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

                    An unavailable item shows **Off instead of its price**, not as
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
                      <span className="rounded-md border border-border px-1.5 py-0.5 text-xs font-bold uppercase tracking-wide text-content-muted">
                        Off
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
