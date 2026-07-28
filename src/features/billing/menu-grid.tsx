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
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
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
                    'flex h-20 flex-col justify-between rounded-xl border p-2 text-left',
                    'focus-visible:focus-ring',
                    item.is_available
                      ? 'border-border bg-surface hover:bg-surface-raised'
                      : 'cursor-not-allowed border-dashed border-border bg-surface-raised opacity-60',
                    quantity > 0 && 'border-primary',
                  )}
                >
                  <span className="flex items-start gap-1.5">
                    <VegMarker isVeg={item.is_veg} className="mt-0.5" />
                    <span className="line-clamp-2 text-sm font-semibold leading-tight text-content">
                      {item.name}
                    </span>
                  </span>
                  <span className="flex items-end justify-between gap-2">
                    <Money paise={item.price_paise} className="text-sm font-bold" />
                    {item.is_available ? (
                      quantity > 0 && (
                        <span
                          data-testid={`tile-count-${item.id}`}
                          className="rounded-lg bg-primary px-2 text-xs font-bold text-on-primary"
                        >
                          ×{quantity}
                        </span>
                      )
                    ) : (
                      <span className="text-xs font-semibold text-content-muted">Off</span>
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
