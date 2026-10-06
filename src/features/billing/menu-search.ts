import type { MenuCategoryWithItems } from '@/data-access/adapters'

/**
 * The menu narrowed to what a biller has typed, in the browser alone.
 *
 * The counter already holds the outlet's whole menu, so a search is a filter
 * over it and never a request: it works offline exactly as it works online.
 *
 * Every word typed must appear somewhere in the item's name or its category's,
 * in any order and case, so "cheese chi" finds "Cheese Chicken Shawarma" and
 * "Chicken & Cheese Sandwich", and "burger" finds every tile under Burgers. A category left with
 * no matching item is dropped rather than shown as an empty heading. Unavailable
 * items stay in the result: a search that hid them would read as "we don't sell
 * that" rather than "we've run out".
 */
export function filterMenu(menu: MenuCategoryWithItems[], query: string): MenuCategoryWithItems[] {
  const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return menu

  return menu.flatMap(({ category, items }) => {
    const matching = items.filter((item) => {
      const haystack = `${item.name} ${category.name}`.toLocaleLowerCase()
      return terms.every((term) => haystack.includes(term))
    })
    return matching.length > 0 ? [{ category, items: matching }] : []
  })
}
