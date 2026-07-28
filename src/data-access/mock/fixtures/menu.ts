import type { Tables } from '../../database.types'
import { OUTLET_KALYANI_ID } from './outlets'

/**
 * The live menu, as of `docs/BUSINESS_CONTEXT.md`. Public business facts, so
 * these are the real names and the real prices — fixtures may carry those; what
 * they may never carry is a real person.
 *
 * Prices are integer paise, like every money value in this system: ₹139 is
 * `13900`, never `139.00`.
 *
 * **Every item on the current menu is non-vegetarian**, because every item is
 * built on chicken. The veg marker therefore has no live example to render, and
 * inventing a vegetarian item the business does not sell would put a fabricated
 * product in front of a prospective franchisee. Both marker shapes are proved by
 * `veg-marker.test.tsx` instead, and a walkthrough can create a vegetarian item
 * from the menu form in seconds.
 *
 * One item is deliberately unavailable. A menu screen that has only ever been
 * seen with everything in stock has not been reviewed, and the counter's
 * "cannot sell what is off" rule needs something to be off.
 */

const CREATED_AT = '2026-07-26T00:00:00+00:00'

export const MENU_CATEGORY_SHAWARMA_ID = 'd4000000-0000-4000-a000-000000000001'
export const MENU_CATEGORY_BURGERS_ID = 'd4000000-0000-4000-a000-000000000002'

/** Named because the counter's "an unavailable item is not sellable" test needs it. */
export const MENU_ITEM_STUFFED_ID = 'd4000000-0000-4000-b000-000000000006'
/** The bestseller — the item most demo bills are rung against. */
export const MENU_ITEM_CLASSIC_ID = 'd4000000-0000-4000-b000-000000000001'
export const MENU_ITEM_MAYO_ID = 'd4000000-0000-4000-b000-000000000002'
export const MENU_ITEM_DOUBLE_ID = 'd4000000-0000-4000-b000-000000000003'
export const MENU_ITEM_MOZZARELLA_ID = 'd4000000-0000-4000-b000-000000000004'
export const MENU_ITEM_BURGER_ID = 'd4000000-0000-4000-b000-000000000007'

export const menuCategoryFixtures: Tables<'menu_categories'>[] = [
  {
    id: MENU_CATEGORY_SHAWARMA_ID,
    outlet_id: OUTLET_KALYANI_ID,
    name: 'Shawarma',
    sort_order: 1,
    is_active: true,
  },
  {
    id: MENU_CATEGORY_BURGERS_ID,
    outlet_id: OUTLET_KALYANI_ID,
    name: 'Burgers',
    sort_order: 2,
    is_active: true,
  },
]

function item(
  id: string,
  categoryId: string,
  name: string,
  pricePaise: number,
  sortOrder: number,
  options: { description?: string; isAvailable?: boolean } = {},
): Tables<'menu_items'> {
  return {
    id,
    outlet_id: OUTLET_KALYANI_ID,
    category_id: categoryId,
    name,
    description: options.description ?? null,
    price_paise: pricePaise,
    is_veg: false,
    is_available: options.isAvailable ?? true,
    sort_order: sortOrder,
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
  }
}

export const menuItemFixtures: Tables<'menu_items'>[] = [
  item(MENU_ITEM_CLASSIC_ID, MENU_CATEGORY_SHAWARMA_ID, 'Classic Chicken Shawarma', 13900, 1, {
    description: 'Bestseller',
  }),
  item(MENU_ITEM_MAYO_ID, MENU_CATEGORY_SHAWARMA_ID, 'Mayonnaise Chicken Shawarma', 15900, 2, {
    description: 'Top rated',
  }),
  item(MENU_ITEM_DOUBLE_ID, MENU_CATEGORY_SHAWARMA_ID, 'Double Chicken Shawarma', 17900, 3),
  item(
    MENU_ITEM_MOZZARELLA_ID,
    MENU_CATEGORY_SHAWARMA_ID,
    'Mozzarella Cheese Chicken Shawarma',
    19900,
    4,
  ),
  item(
    'd4000000-0000-4000-b000-000000000005',
    MENU_CATEGORY_SHAWARMA_ID,
    'Healthy Chicken Shawarma Salad',
    21900,
    5,
    { description: '25.8g protein per 100g' },
  ),
  item(
    MENU_ITEM_STUFFED_ID,
    MENU_CATEGORY_SHAWARMA_ID,
    'Stuffed Lebanese Chicken Shawarma',
    23800,
    6,
    // Off today. The counter must show it and refuse to sell it.
    { description: 'Saaj / pita style', isAvailable: false },
  ),
  item(MENU_ITEM_BURGER_ID, MENU_CATEGORY_BURGERS_ID, 'Fully Loaded Smashed Burger', 25000, 1, {
    description: 'New',
  }),
]
