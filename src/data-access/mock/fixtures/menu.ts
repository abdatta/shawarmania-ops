import type { Tables } from '../../database.types'
import { OUTLET_KALYANI_ID, OUTLET_KANCHRAPARA_ID } from './outlets'

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
 * **Both trading outlets carry their own rows.** `menu_categories` and
 * `menu_items` are outlet-scoped tables, so a shared menu is not something this
 * schema can express — a demo that gave two outlets one set of rows would be
 * demonstrating a product with a brand-wide catalogue, which is
 * [`shared-menu-catalogue`](../../../../openspec/todos/shared-menu-catalogue.md)
 * and is deliberately not built. The blueprint below is materialised once per
 * outlet, so the two menus agree without being the same rows (design D1).
 *
 * One item is deliberately unavailable **at Kalyani only**. A menu screen that
 * has only ever been seen with everything in stock has not been reviewed, and
 * the counter's "cannot sell what is off" rule needs something to be off —
 * while Kanchrapara stays the tidy outlet, so that Kalyani's problems read as
 * differences rather than as how the app always looks (design D2).
 */

const CREATED_AT = '2026-07-26T00:00:00+00:00'

/**
 * The per-outlet slot in every generated id's fourth group. Kalyani keeps
 * `a000`/`b000` so every id that existed before this change is unchanged — a
 * fixture id is a stable handle that tests and other fixtures point at.
 */
const OUTLET_SLOTS: Record<string, string> = {
  [OUTLET_KALYANI_ID]: '000',
  [OUTLET_KANCHRAPARA_ID]: '001',
}

/** Outlets that trade, and therefore have a menu. The mistake outlet has none. */
export const MENU_OUTLET_IDS = [OUTLET_KALYANI_ID, OUTLET_KANCHRAPARA_ID]

function slotFor(outletId: string): string {
  const slot = OUTLET_SLOTS[outletId]
  if (!slot) throw new Error(`No demo menu is defined for outlet ${outletId}.`)
  return slot
}

export type MenuCategoryKey = 'shawarma' | 'burgers'

export type MenuItemKey =
  | 'classic'
  | 'mayo'
  | 'double'
  | 'mozzarella'
  | 'salad'
  | 'stuffed'
  | 'burger'

const CATEGORY_ORDER: MenuCategoryKey[] = ['shawarma', 'burgers']

/** The stable id of one outlet's category. */
export function menuCategoryId(outletId: string, key: MenuCategoryKey): string {
  const index = CATEGORY_ORDER.indexOf(key) + 1
  return `d4000000-0000-4000-a${slotFor(outletId)}-${String(index).padStart(12, '0')}`
}

interface ItemBlueprint {
  key: MenuItemKey
  category: MenuCategoryKey
  name: string
  pricePaise: number
  sortOrder: number
  description?: string
}

/**
 * The menu itself, once. Ordered so each item's position in this array is its
 * id suffix — which is why the order below matches the ids the previous
 * single-outlet fixture handed out.
 */
const ITEM_BLUEPRINT: ItemBlueprint[] = [
  {
    key: 'classic',
    category: 'shawarma',
    name: 'Classic Chicken Shawarma',
    pricePaise: 13900,
    sortOrder: 1,
    description: 'Bestseller',
  },
  {
    key: 'mayo',
    category: 'shawarma',
    name: 'Mayonnaise Chicken Shawarma',
    pricePaise: 15900,
    sortOrder: 2,
    description: 'Top rated',
  },
  {
    key: 'double',
    category: 'shawarma',
    name: 'Double Chicken Shawarma',
    pricePaise: 17900,
    sortOrder: 3,
  },
  {
    key: 'mozzarella',
    category: 'shawarma',
    name: 'Mozzarella Cheese Chicken Shawarma',
    pricePaise: 19900,
    sortOrder: 4,
  },
  {
    key: 'salad',
    category: 'shawarma',
    name: 'Healthy Chicken Shawarma Salad',
    pricePaise: 21900,
    sortOrder: 5,
    description: '25.8g protein per 100g',
  },
  {
    key: 'stuffed',
    category: 'shawarma',
    name: 'Stuffed Lebanese Chicken Shawarma',
    pricePaise: 23800,
    sortOrder: 6,
    description: 'Saaj / pita style',
  },
  {
    key: 'burger',
    category: 'burgers',
    name: 'Fully Loaded Smashed Burger',
    pricePaise: 25000,
    sortOrder: 1,
    description: 'New',
  },
]

/** The stable id of one outlet's menu item. */
export function menuItemId(outletId: string, key: MenuItemKey): string {
  const index = ITEM_BLUEPRINT.findIndex((item) => item.key === key) + 1
  if (index === 0) throw new Error(`No demo menu item: ${key}`)
  return `d4000000-0000-4000-b${slotFor(outletId)}-${String(index).padStart(12, '0')}`
}

/** Off today, at Kalyani only. The counter must show it and refuse to sell it. */
const UNAVAILABLE_AT_KALYANI: MenuItemKey = 'stuffed'

export const MENU_CATEGORY_SHAWARMA_ID = menuCategoryId(OUTLET_KALYANI_ID, 'shawarma')
export const MENU_CATEGORY_BURGERS_ID = menuCategoryId(OUTLET_KALYANI_ID, 'burgers')

/** Named because the counter's "an unavailable item is not sellable" test needs it. */
export const MENU_ITEM_STUFFED_ID = menuItemId(OUTLET_KALYANI_ID, 'stuffed')
/** The bestseller — the item most demo bills are rung against. */
export const MENU_ITEM_CLASSIC_ID = menuItemId(OUTLET_KALYANI_ID, 'classic')
export const MENU_ITEM_MAYO_ID = menuItemId(OUTLET_KALYANI_ID, 'mayo')
export const MENU_ITEM_DOUBLE_ID = menuItemId(OUTLET_KALYANI_ID, 'double')
export const MENU_ITEM_MOZZARELLA_ID = menuItemId(OUTLET_KALYANI_ID, 'mozzarella')
export const MENU_ITEM_BURGER_ID = menuItemId(OUTLET_KALYANI_ID, 'burger')

export const menuCategoryFixtures: Tables<'menu_categories'>[] = MENU_OUTLET_IDS.flatMap(
  (outletId) =>
    CATEGORY_ORDER.map((key, index) => ({
      id: menuCategoryId(outletId, key),
      outlet_id: outletId,
      name: key === 'shawarma' ? 'Shawarma' : 'Burgers',
      sort_order: index + 1,
      is_active: true,
    })),
)

export const menuItemFixtures: Tables<'menu_items'>[] = MENU_OUTLET_IDS.flatMap((outletId) =>
  ITEM_BLUEPRINT.map((blueprint) => ({
    id: menuItemId(outletId, blueprint.key),
    outlet_id: outletId,
    category_id: menuCategoryId(outletId, blueprint.category),
    name: blueprint.name,
    description: blueprint.description ?? null,
    price_paise: blueprint.pricePaise,
    is_veg: false,
    is_available: !(outletId === OUTLET_KALYANI_ID && blueprint.key === UNAVAILABLE_AT_KALYANI),
    sort_order: blueprint.sortOrder,
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
  })),
)
