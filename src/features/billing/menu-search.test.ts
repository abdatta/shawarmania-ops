import { describe, expect, it } from 'vitest'

import type { MenuCategoryWithItems } from '@/data-access/adapters'
import type { Tables } from '@/data-access/database.types'

import { filterMenu } from './menu-search'

const CREATED_AT = '2026-10-06T00:00:00+00:00'

function category(id: string, name: string): Tables<'menu_categories'> {
  return { id, outlet_id: 'o', name, sort_order: 1, is_active: true }
}

function item(
  id: string,
  categoryId: string,
  name: string,
  available = true,
): Tables<'menu_items'> {
  return {
    id,
    outlet_id: 'o',
    category_id: categoryId,
    name,
    description: null,
    price_paise: 10_000,
    is_veg: false,
    is_available: available,
    is_active: true,
    sort_order: 1,
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
  }
}

const MENU: MenuCategoryWithItems[] = [
  {
    category: category('c1', 'Shawarmas'),
    items: [
      item('classic', 'c1', 'Classic Chicken Shawarma'),
      item('cheese', 'c1', 'Cheese Chicken Shawarma'),
      item('lebanese', 'c1', 'Lebanese Chicken Shawarma', false),
      item('paneer', 'c1', 'Paneer Shawarma'),
    ],
  },
  {
    category: category('c2', 'Burgers'),
    items: [item('nashville', 'c2', 'Nashville Chicken Burger'), item('veg', 'c2', 'Smashed Veg')],
  },
]

const ids = (menu: MenuCategoryWithItems[]) => menu.flatMap(({ items }) => items.map((i) => i.id))

describe('filterMenu', () => {
  it('returns the menu itself for a blank query', () => {
    expect(filterMenu(MENU, '')).toBe(MENU)
    expect(filterMenu(MENU, '   ')).toBe(MENU)
  })

  it('needs every word, in any order and case', () => {
    expect(ids(filterMenu(MENU, 'chee chi'))).toEqual(['cheese'])
    expect(ids(filterMenu(MENU, 'CHICKEN cheese'))).toEqual(['cheese'])
    expect(ids(filterMenu(MENU, '  chicken   classic '))).toEqual(['classic'])
  })

  it("matches a category's name, so a category word finds items that do not say it", () => {
    // "Smashed Veg" never says burger; it is found because it sits under Burgers.
    expect(ids(filterMenu(MENU, 'burger'))).toEqual(['nashville', 'veg'])
  })

  it('drops a category left with nothing, and keeps the order of what remains', () => {
    const result = filterMenu(MENU, 'nashville')
    expect(result.map(({ category: c }) => c.name)).toEqual(['Burgers'])
    expect(ids(filterMenu(MENU, 'chicken'))).toEqual(['classic', 'cheese', 'lebanese', 'nashville'])
  })

  it('keeps a matching unavailable item, so it reads as run out rather than not sold', () => {
    expect(ids(filterMenu(MENU, 'lebanese'))).toEqual(['lebanese'])
  })

  it('returns nothing when nothing matches', () => {
    expect(filterMenu(MENU, 'pizza')).toEqual([])
  })
})
