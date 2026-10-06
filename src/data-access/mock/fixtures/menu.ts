import type { MenuDiscount } from '../../adapters'
import type { Tables } from '../../database.types'
import { OUTLET_KALYANI_ID, OUTLET_KANCHRAPARA_ID } from './outlets'

/**
 * The live menu: Kalyani Cafe's sixty items in ten categories, transcribed from
 * the owner's own menu screen [owner, 2026-10-06]. Public business facts, so
 * these are the real names and the real prices — fixtures may carry those; what
 * they may never carry is a real person.
 *
 * Prices are integer paise, like every money value in this system: ₹135 is
 * `13500`, never `135.00`.
 *
 * **Long on purpose.** The counter's menu search exists because a real menu
 * outgrew one screen, and a demo with seven tiles could neither show why nor
 * exercise the column scrolling under a pinned search bar.
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

export type MenuCategoryKey =
  | 'shawarma'
  | 'burgers'
  | 'sandwiches'
  | 'appetizers'
  | 'mains'
  | 'arabian'
  | 'desserts'
  | 'tea'
  | 'mocktails'
  | 'water'

/**
 * Category order, and each category's id suffix. Shawarma and Burgers keep the
 * first two slots, so the ids that existed before the menu grew are unchanged.
 */
const CATEGORY_ORDER: MenuCategoryKey[] = [
  'shawarma',
  'burgers',
  'sandwiches',
  'appetizers',
  'mains',
  'arabian',
  'desserts',
  'tea',
  'mocktails',
  'water',
]

const CATEGORY_NAMES: Record<MenuCategoryKey, string> = {
  shawarma: 'Shawarmas',
  burgers: 'Burgers',
  sandwiches: 'Sandwiches',
  appetizers: 'Appetizers',
  mains: 'Main Course',
  arabian: 'Arabian Favourites',
  desserts: 'Desserts',
  tea: 'Tea & Coffee',
  mocktails: 'Mocktails',
  water: 'Water',
}

/** The stable id of one outlet's category. */
export function menuCategoryId(outletId: string, key: MenuCategoryKey): string {
  const index = CATEGORY_ORDER.indexOf(key) + 1
  return `d4000000-0000-4000-a${slotFor(outletId)}-${String(index).padStart(12, '0')}`
}

interface ItemBlueprint {
  key: string
  category: MenuCategoryKey
  name: string
  pricePaise: number
  /** Position within its category, as the owner's menu orders it. */
  sortOrder: number
  veg?: true
  description?: string
}

/**
 * The menu itself, once. **Each item's position in this array is its id
 * suffix**, so the seven items the demo has always had come first, in their
 * old order, and keep their ids; everything else follows. `sortOrder` is what
 * places an item on screen.
 */
const ITEM_BLUEPRINT = [
  {
    key: 'classic',
    category: 'shawarma',
    name: 'Classic Chicken Shawarma',
    pricePaise: 13500,
    sortOrder: 9,
  },
  {
    key: 'mayo',
    category: 'shawarma',
    name: 'Mayonnaise Chicken Shawarma',
    pricePaise: 15500,
    sortOrder: 2,
    description: 'Creamy, indulgent & subtly sweet with our signature chicken filling.',
  },
  {
    key: 'double',
    category: 'shawarma',
    name: 'Double Chicken Shawarma',
    pricePaise: 17500,
    sortOrder: 3,
    description: 'Twice the chicken. Twice the indulgence. Made for serious cravings.',
  },
  {
    key: 'cheese',
    category: 'shawarma',
    name: 'Cheese Chicken Shawarma',
    pricePaise: 17500,
    sortOrder: 4,
    description: 'Our signature chicken shawarma finished with a generous mozzarella melt.',
  },
  {
    key: 'salad',
    category: 'shawarma',
    name: 'Chicken Shawarma Salad',
    pricePaise: 22000,
    sortOrder: 7,
    description: 'Juicy shawarma chicken over crisp greens for a lighter, protein-packed plate.',
  },
  {
    key: 'lebanese',
    category: 'shawarma',
    name: 'Lebanese Chicken Shawarma',
    pricePaise: 22000,
    sortOrder: 5,
    description: 'Tender chicken paired with silky hummus & tahini for a Lebanese touch.',
  },
  {
    key: 'burger',
    category: 'burgers',
    name: 'Smashed Chicken Burger',
    pricePaise: 25000,
    sortOrder: 4,
    description:
      'Crispy-edged smashed chicken, fresh vegetables & our signature house sauce with fries.',
  },
  {
    key: 'peri-peri-chicken-shawarma',
    category: 'shawarma',
    name: 'Peri Peri Chicken Shawarma',
    pricePaise: 14500,
    sortOrder: 1,
    description:
      'Our signature chicken shawarma with a fiery peri peri finish in crispy saaj bread.',
  },
  {
    key: 'taco-chicken-shawarma',
    category: 'shawarma',
    name: 'Taco Chicken Shawarma',
    pricePaise: 22000,
    sortOrder: 6,
    description: 'A bold meeting of Mexican taco flavours and our signature shawarma.',
  },
  {
    key: 'shawarmania-mutton-shawarma',
    category: 'shawarma',
    name: 'Shawarmania Mutton Shawarma',
    pricePaise: 25000,
    sortOrder: 8,
    description: 'Succulent mutton, bold spices & signature flavours in every bite.',
  },
  {
    key: 'paneer-shawarma',
    category: 'shawarma',
    name: 'Paneer Shawarma',
    pricePaise: 13500,
    sortOrder: 10,
    veg: true,
  },
  {
    key: 'smashed-mutton-burger',
    category: 'burgers',
    name: 'Smashed Mutton Burger',
    pricePaise: 35000,
    sortOrder: 1,
    description:
      'Hand-smashed mutton, aromatic spices & signature sauce in a buttery brioche with fries.',
  },
  {
    key: 'messy-chicken-burger',
    category: 'burgers',
    name: 'Messy Chicken Burger',
    pricePaise: 32000,
    sortOrder: 2,
    description:
      'Smashed chicken, fresh crunch & a lavish pour of house cheese sauce. Will make your hands messy with fries.',
  },
  {
    key: 'nashville-chicken-burger',
    category: 'burgers',
    name: 'Nashville Chicken Burger',
    pricePaise: 27000,
    sortOrder: 3,
    description:
      'Crispy chicken glazed in fiery Nashville sauce, tucked into buttery brioche with fries.',
  },
  {
    key: 'smashed-veg-burger',
    category: 'burgers',
    name: 'Smashed Veg Burger',
    pricePaise: 20000,
    sortOrder: 5,
    veg: true,
  },
  {
    key: 'avocado-mushroom-sandwich',
    category: 'sandwiches',
    name: 'Avocado Mushroom Sandwich',
    pricePaise: 30000,
    sortOrder: 1,
    veg: true,
    description:
      'Creamy avocado, sautéed mushrooms & house sauce layered on toasted brown bread along with fries.',
  },
  {
    key: 'tuna-sandwich',
    category: 'sandwiches',
    name: 'Tuna Sandwich',
    pricePaise: 30000,
    sortOrder: 2,
    description:
      'Tuna, sweet corn & creamy textures between beautifully toasted bread along with fries.',
  },
  {
    key: 'chicken-cheese-sandwich',
    category: 'sandwiches',
    name: 'Chicken & Cheese Sandwich',
    pricePaise: 25000,
    sortOrder: 3,
    description:
      'Tender chicken and molten cheese layered between golden toasted bread along with fries.',
  },
  {
    key: 'spinach-cheese-sandwich',
    category: 'sandwiches',
    name: 'Spinach & Cheese Sandwich',
    pricePaise: 20000,
    sortOrder: 4,
    veg: true,
    description: 'Creamy spinach, sweet corn & cheese in perfectly toasted bread along with fries.',
  },
  {
    key: 'fish-fry-vetki',
    category: 'appetizers',
    name: 'Fish Fry (Vetki)',
    pricePaise: 30000,
    sortOrder: 1,
    description: 'Spiced Vetki, fried golden and served with classic mustard sauce.',
  },
  {
    key: 'cilantro-fish-sticks',
    category: 'appetizers',
    name: 'Cilantro Fish Sticks',
    pricePaise: 20000,
    sortOrder: 2,
    description: 'Crispy fish with fragrant cilantro, wrapped in a golden crumb. (4 pieces)',
  },
  {
    key: 'nashville-chicken-wings',
    category: 'appetizers',
    name: 'Nashville Chicken Wings',
    pricePaise: 27000,
    sortOrder: 3,
    description: 'Crispy wings lacquered in our fiery Nashville house sauce. (4 pieces)',
  },
  {
    key: 'chicken-nachos',
    category: 'appetizers',
    name: 'Chicken Nachos',
    pricePaise: 24000,
    sortOrder: 4,
    description:
      'Crunchy tortilla chips layered with seasoned chicken, molten cheese & fresh toppings.',
  },
  {
    key: 'scotch-chicken-egg',
    category: 'appetizers',
    name: 'Scotch Chicken & Egg',
    pricePaise: 20000,
    sortOrder: 5,
    description: 'A whole egg wrapped in seasoned chicken, crumbed & fried golden.',
  },
  {
    key: 'chicken-overloaded-fries',
    category: 'appetizers',
    name: 'Chicken Overloaded Fries',
    pricePaise: 20000,
    sortOrder: 6,
    description: 'Golden fries piled with savoury chicken and a generous cheese sauce.',
  },
  {
    key: 'chicken-nuggets',
    category: 'appetizers',
    name: 'Chicken Nuggets',
    pricePaise: 14000,
    sortOrder: 7,
    description: 'Tender seasoned chicken encased in a delicate golden crunch. (6 pieces)',
  },
  {
    key: 'peri-peri-french-fries',
    category: 'appetizers',
    name: 'Peri Peri French Fries',
    pricePaise: 12000,
    sortOrder: 8,
    veg: true,
    description: 'Golden fries tossed with our signature fiery peri peri seasoning.',
  },
  {
    key: 'mutton-galawati-kebab',
    category: 'mains',
    name: 'Mutton Galawati Kebab',
    pricePaise: 45000,
    sortOrder: 1,
    description: 'Silken Awadhi mutton kebabs that melt effortlessly, served with paratha & gravy.',
  },
  {
    key: 'chicken-steak',
    category: 'mains',
    name: 'Chicken Steak',
    pricePaise: 40000,
    sortOrder: 2,
    description:
      'Succulent chicken breast with herb rice, silky mash, sautéed vegetables & house gravy.',
  },
  {
    key: 'paneer-steak',
    category: 'mains',
    name: 'Paneer Steak',
    pricePaise: 40000,
    sortOrder: 3,
    veg: true,
    description: 'Spiced paneer paired with herb rice, creamy mash, vegetables & house gravy.',
  },
  {
    key: 'fish-chips',
    category: 'mains',
    name: 'Fish & Chips',
    pricePaise: 35000,
    sortOrder: 4,
    description: 'Golden battered fish with crisp, chunky potato wedges.',
  },
  {
    key: 'chicken-a-la-kiev',
    category: 'mains',
    name: 'Chicken À la Kiev',
    pricePaise: 35000,
    sortOrder: 5,
    description:
      'Crisp chicken revealing a rich garlic-herb butter centre, served with mash & vegetables.',
  },
  {
    key: 'chicken-katsu-rice',
    category: 'mains',
    name: 'Chicken Katsu Rice',
    pricePaise: 28000,
    sortOrder: 6,
    description: 'Golden chicken katsu over fragrant herb rice with savoury curry.',
  },
  {
    key: 'omelette-rice',
    category: 'mains',
    name: 'Omelette Rice',
    pricePaise: 20000,
    sortOrder: 7,
    description: 'A fluffy double omelette over herb rice with savoury curry.',
  },
  {
    key: 'sauted-mushroom-rice',
    category: 'mains',
    name: 'Sauted Mushroom Rice',
    pricePaise: 18000,
    sortOrder: 8,
    veg: true,
    description: 'Mushroom sauteed over herb rice and savory curry along with veggies.',
  },
  {
    key: 'lemon-butter-garlic-fish',
    category: 'mains',
    name: 'Lemon Butter Garlic Fish',
    pricePaise: 48000,
    sortOrder: 9,
    description: 'Grilled Vetki fish with lemon butter sauce and herb rice.',
  },
  {
    key: 'chicken-batata-harra',
    category: 'arabian',
    name: 'Chicken Batata Harra',
    pricePaise: 22000,
    sortOrder: 1,
    description:
      'Crisp potatoes, tender chicken, garlic, cilantro, chilli & a bright lemon finish.',
  },
  {
    key: 'veg-batata-harra',
    category: 'arabian',
    name: 'Veg Batata Harra',
    pricePaise: 20000,
    sortOrder: 2,
    veg: true,
    description: 'Golden potatoes & cottage cheese with garlic, cilantro, chilli & lemon.',
  },
  {
    key: 'lotus-biscoff-cheesecake',
    category: 'desserts',
    name: 'Lotus Biscoff Cheesecake',
    pricePaise: 30000,
    sortOrder: 1,
    veg: true,
    description: 'Velvety cheesecake layered with the unmistakable caramelised charm of Biscoff.',
  },
  {
    key: 'melt-in-mouth-biscoff',
    category: 'desserts',
    name: 'Melt-In-Mouth Biscoff',
    pricePaise: 25000,
    sortOrder: 2,
    veg: true,
    description: 'A rich Biscoff indulgence with an irresistibly soft, melt-away finish.',
  },
  {
    key: 'og-tiramisu',
    category: 'desserts',
    name: 'OG Tiramisu',
    pricePaise: 20000,
    sortOrder: 3,
    veg: true,
    description: 'Classic Italian comfort — coffee, cream & mascarpone in perfect harmony.',
  },
  {
    key: 'hot-fudge-brownie',
    category: 'desserts',
    name: 'Hot Fudge Brownie',
    pricePaise: 20000,
    sortOrder: 4,
    veg: true,
    description: 'Warm, decadent brownie crowned with a luxurious hot fudge pour.',
  },
  {
    key: 'chocolate-taco-cake',
    category: 'desserts',
    name: 'Chocolate Taco Cake',
    pricePaise: 15000,
    sortOrder: 5,
    veg: true,
    description: 'A playful chocolate creation with crisp taco-style shells and indulgent cake.',
  },
  {
    key: 'milk-tea',
    category: 'tea',
    name: 'Milk Tea',
    pricePaise: 4000,
    sortOrder: 1,
    veg: true,
    description: 'A comforting classic, brewed rich and smooth.',
  },
  {
    key: 'green-tea',
    category: 'tea',
    name: 'Green Tea',
    pricePaise: 6000,
    sortOrder: 2,
    veg: true,
    description: 'Delicate, refreshing and wonderfully light.',
  },
  {
    key: 'lemon-honey-tea',
    category: 'tea',
    name: 'Lemon Honey Tea',
    pricePaise: 6000,
    sortOrder: 3,
    veg: true,
    description: 'Bright lemon and mellow honey in a soothing brew.',
  },
  {
    key: 'makaibari-spring-tea',
    category: 'tea',
    name: 'Makaibari Spring Tea',
    pricePaise: 10000,
    sortOrder: 4,
    veg: true,
    description: 'A delicate premium brew from the celebrated Makaibari estate.',
  },
  {
    key: 'kashmiri-kawa-tea',
    category: 'tea',
    name: 'Kashmiri Kawa Tea',
    pricePaise: 10000,
    sortOrder: 5,
    veg: true,
    description: 'Fragrant Kashmiri tea kissed with warming aromatic spices and Kesar.',
  },
  {
    key: 'black-coffee',
    category: 'tea',
    name: 'Black Coffee',
    pricePaise: 6000,
    sortOrder: 6,
    veg: true,
    description: 'Bold, aromatic and beautifully uncomplicated.',
  },
  {
    key: 'milk-coffee',
    category: 'tea',
    name: 'Milk Coffee',
    pricePaise: 7000,
    sortOrder: 7,
    veg: true,
    description: 'Smooth espresso-style coffee softened with creamy milk.',
  },
  {
    key: 'cold-coffee-with-ice-cream',
    category: 'tea',
    name: 'Cold Coffee with Ice Cream',
    pricePaise: 15000,
    sortOrder: 8,
    veg: true,
    description: 'Velvety chilled coffee crowned with a scoop of creamy indulgence.',
  },
  {
    key: 'eye-opener',
    category: 'tea',
    name: 'Eye Opener',
    pricePaise: 20000,
    sortOrder: 9,
    veg: true,
    description: 'Cold brew, ice cream & brownie — a dessert disguised as coffee.',
  },
  {
    key: 'virgin-pina-colada',
    category: 'mocktails',
    name: 'Virgin Piña Colada',
    pricePaise: 15000,
    sortOrder: 1,
    veg: true,
    description: 'Tropical pineapple and creamy coconut in a chilled island-inspired blend.',
  },
  {
    key: 'cold-blue',
    category: 'mocktails',
    name: 'Cold Blue',
    pricePaise: 12000,
    sortOrder: 2,
    veg: true,
    description: 'A vibrant, icy-blue refresher with bright fruity notes.',
  },
  {
    key: 'mango-crush',
    category: 'mocktails',
    name: 'Mango Crush',
    pricePaise: 12000,
    sortOrder: 3,
    veg: true,
    description: 'Luscious mango blended into a bright, refreshing cooler.',
  },
  {
    key: 'masala-cold-drinks',
    category: 'mocktails',
    name: 'Masala Cold Drinks',
    pricePaise: 10000,
    sortOrder: 4,
    veg: true,
    description: 'Fizzy favourites elevated with a punch of Indian masala.',
  },
  {
    key: 'virgin-mojito',
    category: 'mocktails',
    name: 'Virgin Mojito',
    pricePaise: 9000,
    sortOrder: 5,
    veg: true,
    description: 'Fresh mint, zesty lime and sparkling refreshment.',
  },
  {
    key: 'fresh-lime-soda',
    category: 'mocktails',
    name: 'Fresh Lime Soda',
    pricePaise: 7000,
    sortOrder: 6,
    veg: true,
    description: 'Bright, bubbly and refreshing with freshly squeezed lime.',
  },
  { key: 'water-10', category: 'water', name: 'Water', pricePaise: 1000, sortOrder: 1, veg: true },
  { key: 'water-20', category: 'water', name: 'Water', pricePaise: 2000, sortOrder: 2, veg: true },
] as const satisfies readonly ItemBlueprint[]

export type MenuItemKey = (typeof ITEM_BLUEPRINT)[number]['key']

/** The stable id of one outlet's menu item. */
export function menuItemId(outletId: string, key: MenuItemKey): string {
  const index = ITEM_BLUEPRINT.findIndex((item) => item.key === key) + 1
  if (index === 0) throw new Error(`No demo menu item: ${key}`)
  return `d4000000-0000-4000-b${slotFor(outletId)}-${String(index).padStart(12, '0')}`
}

/** Unavailable today, at Kalyani only. The counter must show it and refuse to sell it. */
const UNAVAILABLE_AT_KALYANI: MenuItemKey = 'lebanese'

export const MENU_CATEGORY_SHAWARMA_ID = menuCategoryId(OUTLET_KALYANI_ID, 'shawarma')
export const MENU_CATEGORY_BURGERS_ID = menuCategoryId(OUTLET_KALYANI_ID, 'burgers')

/** Named because the counter's "an unavailable item is not sellable" test needs it. */
export const MENU_ITEM_LEBANESE_ID = menuItemId(OUTLET_KALYANI_ID, 'lebanese')
/** The bestseller — the item most demo bills are rung against. */
export const MENU_ITEM_CLASSIC_ID = menuItemId(OUTLET_KALYANI_ID, 'classic')
export const MENU_ITEM_MAYO_ID = menuItemId(OUTLET_KALYANI_ID, 'mayo')
export const MENU_ITEM_DOUBLE_ID = menuItemId(OUTLET_KALYANI_ID, 'double')
export const MENU_ITEM_CHEESE_ID = menuItemId(OUTLET_KALYANI_ID, 'cheese')
export const MENU_ITEM_BURGER_ID = menuItemId(OUTLET_KALYANI_ID, 'burger')

export const menuCategoryFixtures: Tables<'menu_categories'>[] = MENU_OUTLET_IDS.flatMap(
  (outletId) =>
    CATEGORY_ORDER.map((key, index) => ({
      id: menuCategoryId(outletId, key),
      outlet_id: outletId,
      name: CATEGORY_NAMES[key],
      sort_order: index + 1,
      is_active: true,
    })),
)

export const menuItemFixtures: Tables<'menu_items'>[] = MENU_OUTLET_IDS.flatMap((outletId) =>
  ITEM_BLUEPRINT.map((entry) => {
    // Widened, so the optional fields read the same on every entry.
    const blueprint: ItemBlueprint = entry
    return {
      id: menuItemId(outletId, entry.key),
      outlet_id: outletId,
      category_id: menuCategoryId(outletId, blueprint.category),
      name: blueprint.name,
      description: blueprint.description ?? null,
      price_paise: blueprint.pricePaise,
      is_veg: blueprint.veg ?? false,
      is_available: !(outletId === OUTLET_KALYANI_ID && entry.key === UNAVAILABLE_AT_KALYANI),
      is_active: true,
      sort_order: blueprint.sortOrder,
      created_at: CREATED_AT,
      updated_at: CREATED_AT,
    }
  }),
)

/**
 * A discount the owner is running, so the demo walks the feature rather than
 * showing an empty section where it would be.
 *
 * Fifteen percent across Kalyani's Burgers: a percentage rather than an amount
 * because that is the shape a promotion usually takes, and one category rather
 * than all of them so a bill can show the discounted lines and the undiscounted
 * ones side by side — which is the case the panel's grouping has to get right.
 *
 * Burgers rather than Shawarma because the counter's own suite rings two
 * shawarmas to assert unrelated things about quantities and tender. Discounting
 * those would have moved five totals that are not about discounts at all, and a
 * test whose expected figure moved for a reason it never mentions is a test
 * nobody can read. Which category carries the demo discount is arbitrary; which
 * one keeps the rest of the suite meaningful is not.
 */
export const menuDiscountFixtures: MenuDiscount[] = [
  {
    id: 'd9000000-0000-4000-a000-000000000001',
    outletId: OUTLET_KALYANI_ID,
    basis: 'percent',
    valueBp: 1500,
    valuePaise: null,
    isActive: true,
    categoryIds: [menuCategoryId(OUTLET_KALYANI_ID, 'burgers')],
  },
]
