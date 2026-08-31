import type { Tables } from '../../database.types'
import { OUTLET_KALYANI_ID, OUTLET_KANCHRAPARA_ID } from './outlets'

/**
 * Stock, expenses and the cash float — a manager's demo day, at each of the two
 * trading outlets.
 *
 * Two things here are deliberate awkwardness rather than oversight, because a
 * screen that has only ever been seen going well has not been reviewed:
 *
 *  - **one item is at or below its threshold**, so the low-stock treatment is on
 *    screen from the moment the surface opens;
 *  - **yesterday closed with a real mismatch**, and a bill for yesterday arrived
 *    after it closed (see fixtures/billing.ts), so the reconciliation exception
 *    is visible without anybody staging it.
 *
 * **Both belong to Kalyani, and Kanchrapara is deliberately fine** (design D2).
 * The comparison screen exists to answer "which shop is doing better, and why",
 * and two outlets with identical shapes make that unreadable — a difference is
 * only legible against something that is not different.
 *
 * Movements are seeds with a `daysAgo` offset, materialised by the store. The
 * items' stored quantities are written out too — the schema has the column and
 * a fixture must satisfy it — and the store asserts on construction that each
 * one equals the sum of its own ledger. A demo where the list and the ledger
 * disagreed would make "why does it say 4 kg?" unanswerable, which is the exact
 * question the ledger exists for.
 */

export const INVENTORY_CHICKEN_ID = 'd9000000-0000-4000-a000-000000000001'
/** The one at its threshold: the low-stock treatment has to have a subject. */
export const INVENTORY_PITA_ID = 'd9000000-0000-4000-a000-000000000002'
export const INVENTORY_MAYO_ID = 'd9000000-0000-4000-a000-000000000003'
export const INVENTORY_CHEESE_ID = 'd9000000-0000-4000-a000-000000000004'
export const INVENTORY_PACKAGING_ID = 'd9000000-0000-4000-a000-000000000005'

const KPA_CHICKEN_ID = 'd9000000-0000-4000-a001-000000000001'
const KPA_PITA_ID = 'd9000000-0000-4000-a001-000000000002'
const KPA_MAYO_ID = 'd9000000-0000-4000-a001-000000000003'
const KPA_PACKAGING_ID = 'd9000000-0000-4000-a001-000000000005'

const LAST_UPDATED = '2026-07-26T00:00:00+00:00'

function stockItem(
  outletId: string,
  id: string,
  name: string,
  unit: Tables<'inventory_items'>['unit'],
  currentQuantity: number,
  lowStockThreshold: number,
  purchaseCostPaise: number,
): Tables<'inventory_items'> {
  return {
    id,
    outlet_id: outletId,
    name,
    unit,
    current_quantity: currentQuantity,
    low_stock_threshold: lowStockThreshold,
    purchase_cost_paise: purchaseCostPaise,
    is_active: true,
    last_updated_at: LAST_UPDATED,
  }
}

export const inventoryItemFixtures: Tables<'inventory_items'>[] = [
  // ── Kalyani ──────────────────────────────────────────────────────────────
  stockItem(OUTLET_KALYANI_ID, INVENTORY_CHICKEN_ID, 'Chicken', 'kg', 15.7, 5, 24000),
  // 6 packets against a threshold of 10 — low, and visibly so.
  stockItem(OUTLET_KALYANI_ID, INVENTORY_PITA_ID, 'Pita bread', 'packet', 6, 10, 4500),
  stockItem(OUTLET_KALYANI_ID, INVENTORY_MAYO_ID, 'Mayonnaise', 'litre', 4.6, 4, 18000),
  stockItem(OUTLET_KALYANI_ID, INVENTORY_CHEESE_ID, 'Cheese slices', 'packet', 9.9, 6, 22000),
  stockItem(OUTLET_KALYANI_ID, INVENTORY_PACKAGING_ID, 'Packaging boxes', 'piece', 179, 100, 800),

  // ── Kanchrapara — nothing short, nothing wasted ──────────────────────────
  stockItem(OUTLET_KANCHRAPARA_ID, KPA_CHICKEN_ID, 'Chicken', 'kg', 6.6, 5, 24000),
  stockItem(OUTLET_KANCHRAPARA_ID, KPA_PITA_ID, 'Pita bread', 'packet', 13, 10, 4500),
  stockItem(OUTLET_KANCHRAPARA_ID, KPA_MAYO_ID, 'Mayonnaise', 'litre', 4.1, 3, 18000),
  stockItem(OUTLET_KANCHRAPARA_ID, KPA_PACKAGING_ID, 'Packaging boxes', 'piece', 175, 100, 800),
]

export interface MovementSeed {
  itemId: string
  /** Business days back from today. 0 is today. */
  daysAgo: number
  /** Magnitude for added / used / wasted; signed for a correction. */
  movementType: Tables<'inventory_movements'>['movement_type']
  quantity: number
  note?: string
}

/**
 * **Stock is consumed on the days that traded, in the quantities those bills
 * imply, at a food cost of roughly a third of takings.**
 *
 * That correspondence is not decoration. The P&L's consumption basis prices
 * this ledger against the bills, so a ledger invented independently of them
 * produces a demo where a shawarma shop appears to lose money on every wrap —
 * and a stock movement on a day the counter rang nothing is the first thing
 * anyone comparing two screens would notice. Both were true here until the
 * owner console made them visible (ui-owner-console-and-demo, verification).
 *
 * Deliveries land on the first day; consumption follows the trade.
 */
export const movementSeeds: MovementSeed[] = [
  // Chicken — the biggest line, and roughly 0.35 kg per wrap sold.
  { itemId: INVENTORY_CHICKEN_ID, daysAgo: 3, movementType: 'added', quantity: 15 },
  { itemId: INVENTORY_CHICKEN_ID, daysAgo: 3, movementType: 'used', quantity: 1.4 },
  { itemId: INVENTORY_CHICKEN_ID, daysAgo: 2, movementType: 'used', quantity: 1.5 },
  { itemId: INVENTORY_CHICKEN_ID, daysAgo: 1, movementType: 'used', quantity: 2.8 },
  // The weekend delivery the day-0 expense paid for — most of it still in the
  // cold room, which is the whole reason the two profit bases disagree.
  { itemId: INVENTORY_CHICKEN_ID, daysAgo: 0, movementType: 'added', quantity: 10.8 },
  { itemId: INVENTORY_CHICKEN_ID, daysAgo: 0, movementType: 'used', quantity: 4.4 },

  // Pita bread — including the wastage, which is why it is short. Ends at 6.
  { itemId: INVENTORY_PITA_ID, daysAgo: 3, movementType: 'added', quantity: 24 },
  { itemId: INVENTORY_PITA_ID, daysAgo: 3, movementType: 'used', quantity: 3 },
  { itemId: INVENTORY_PITA_ID, daysAgo: 2, movementType: 'used', quantity: 3 },
  { itemId: INVENTORY_PITA_ID, daysAgo: 1, movementType: 'used', quantity: 4 },
  {
    itemId: INVENTORY_PITA_ID,
    daysAgo: 1,
    movementType: 'wasted',
    quantity: 2,
    note: 'Packet split on the floor during the evening rush.',
  },
  { itemId: INVENTORY_PITA_ID, daysAgo: 0, movementType: 'used', quantity: 6 },

  // Mayonnaise — carries the correction, so the ledger shows how history is
  // fixed without being edited. Ends at 4.6.
  { itemId: INVENTORY_MAYO_ID, daysAgo: 3, movementType: 'added', quantity: 7 },
  { itemId: INVENTORY_MAYO_ID, daysAgo: 3, movementType: 'used', quantity: 0.3 },
  { itemId: INVENTORY_MAYO_ID, daysAgo: 2, movementType: 'used', quantity: 0.3 },
  { itemId: INVENTORY_MAYO_ID, daysAgo: 1, movementType: 'used', quantity: 0.5 },
  { itemId: INVENTORY_MAYO_ID, daysAgo: 0, movementType: 'used', quantity: 0.8 },
  {
    itemId: INVENTORY_MAYO_ID,
    daysAgo: 0,
    movementType: 'correction',
    quantity: -0.5,
    note: 'Recounted after the delivery — half a litre less than the sheet said.',
  },

  // Cheese slices — only the mozzarella wrap uses them. Ends at 9.9.
  { itemId: INVENTORY_CHEESE_ID, daysAgo: 3, movementType: 'added', quantity: 12 },
  { itemId: INVENTORY_CHEESE_ID, daysAgo: 3, movementType: 'used', quantity: 0.4 },
  { itemId: INVENTORY_CHEESE_ID, daysAgo: 2, movementType: 'used', quantity: 0.3 },
  { itemId: INVENTORY_CHEESE_ID, daysAgo: 1, movementType: 'used', quantity: 0.6 },
  { itemId: INVENTORY_CHEESE_ID, daysAgo: 0, movementType: 'used', quantity: 0.8 },

  // Packaging — one box per bill, near enough. Ends at 179.
  { itemId: INVENTORY_PACKAGING_ID, daysAgo: 3, movementType: 'added', quantity: 250 },
  { itemId: INVENTORY_PACKAGING_ID, daysAgo: 3, movementType: 'used', quantity: 12 },
  { itemId: INVENTORY_PACKAGING_ID, daysAgo: 2, movementType: 'used', quantity: 14 },
  { itemId: INVENTORY_PACKAGING_ID, daysAgo: 1, movementType: 'used', quantity: 17 },
  { itemId: INVENTORY_PACKAGING_ID, daysAgo: 0, movementType: 'used', quantity: 28 },

  // ── Kanchrapara — smaller quantities, no wastage, no corrections ─────────
  { itemId: KPA_CHICKEN_ID, daysAgo: 3, movementType: 'added', quantity: 10 },
  { itemId: KPA_CHICKEN_ID, daysAgo: 3, movementType: 'used', quantity: 0.4 },
  { itemId: KPA_CHICKEN_ID, daysAgo: 2, movementType: 'used', quantity: 0.7 },
  { itemId: KPA_CHICKEN_ID, daysAgo: 1, movementType: 'used', quantity: 1.2 },
  { itemId: KPA_CHICKEN_ID, daysAgo: 0, movementType: 'used', quantity: 1.1 },

  { itemId: KPA_PITA_ID, daysAgo: 3, movementType: 'added', quantity: 20 },
  { itemId: KPA_PITA_ID, daysAgo: 3, movementType: 'used', quantity: 1 },
  { itemId: KPA_PITA_ID, daysAgo: 2, movementType: 'used', quantity: 2 },
  { itemId: KPA_PITA_ID, daysAgo: 1, movementType: 'used', quantity: 2 },
  { itemId: KPA_PITA_ID, daysAgo: 0, movementType: 'used', quantity: 2 },

  { itemId: KPA_MAYO_ID, daysAgo: 3, movementType: 'added', quantity: 5 },
  { itemId: KPA_MAYO_ID, daysAgo: 3, movementType: 'used', quantity: 0.1 },
  { itemId: KPA_MAYO_ID, daysAgo: 2, movementType: 'used', quantity: 0.2 },
  { itemId: KPA_MAYO_ID, daysAgo: 1, movementType: 'used', quantity: 0.3 },
  { itemId: KPA_MAYO_ID, daysAgo: 0, movementType: 'used', quantity: 0.3 },

  { itemId: KPA_PACKAGING_ID, daysAgo: 3, movementType: 'added', quantity: 190 },
  { itemId: KPA_PACKAGING_ID, daysAgo: 3, movementType: 'used', quantity: 2 },
  { itemId: KPA_PACKAGING_ID, daysAgo: 2, movementType: 'used', quantity: 3 },
  { itemId: KPA_PACKAGING_ID, daysAgo: 1, movementType: 'used', quantity: 5 },
  { itemId: KPA_PACKAGING_ID, daysAgo: 0, movementType: 'used', quantity: 5 },
]

export interface ExpenseSeed {
  /** Defaults to Kalyani, where the persona manager works. */
  outletId?: string
  /** Business days back from today. 0 is today. */
  daysAgo: number
  /** IST wall-clock time on that business day, `HH:MM`. */
  time: string
  category: Tables<'expenses'>['category']
  amountPaise: number
  paymentMethod: Tables<'bills'>['payment_method']
  description?: string
}

/**
 * Both days carry cash and non-cash expenses, because the rule the cash screen
 * exists to demonstrate — only cash reaches the drawer — cannot be shown by a
 * day where everything was cash.
 *
 * **The words are the ones a person would type**, not the identifiers of the
 * closed list that free-text categories replaced in
 * `expense-categories-grow-from-use`. `seed.sql` has said so since that change;
 * these fixtures had not caught up, and it stopped being invisible when
 * `retire-the-manual-ledger` (#12) promoted one expense record and the counter
 * tablet began listing these rows beside the ones staff type themselves. A demo
 * that greets its reader with `raw_materials` is teaching a vocabulary the app
 * does not use.
 *
 * Every outlet carries a food-purchase row, because it is the largest recurring
 * cost the month has and a breakdown without one reads like somebody else's
 * shop. It no longer exists to feed a basis toggle: #12 withdrew the
 * consumption basis, because inventory is shelved and a basis that cannot be
 * computed is worse than one honestly offered.
 */
export const expenseSeeds: ExpenseSeed[] = [
  {
    daysAgo: 3,
    time: '09:10',
    category: 'Chicken',
    amountPaise: 90000,
    paymentMethod: 'cash',
    description: 'Chicken from Nadia Poultry',
  },
  {
    daysAgo: 3,
    time: '18:00',
    category: 'Other',
    amountPaise: 15000,
    paymentMethod: 'cash',
    description: 'Tea for the evening shift',
  },
  {
    daysAgo: 2,
    time: '09:10',
    category: 'Chicken',
    amountPaise: 100000,
    paymentMethod: 'cash',
    description: 'Chicken and vegetables from the morning market',
  },
  {
    daysAgo: 2,
    time: '11:30',
    category: 'Packaging',
    amountPaise: 40000,
    paymentMethod: 'upi',
    description: 'Boxes',
  },
  {
    daysAgo: 1,
    time: '09:15',
    category: 'Chicken',
    amountPaise: 150000,
    paymentMethod: 'cash',
    description: 'Chicken and vegetables from the morning market',
  },
  {
    daysAgo: 1,
    time: '11:00',
    category: 'Electricity',
    amountPaise: 120000,
    paymentMethod: 'upi',
    description: 'Monthly bill',
  },
  {
    daysAgo: 1,
    time: '17:30',
    category: 'Other',
    amountPaise: 20000,
    paymentMethod: 'cash',
    description: 'Tea for the evening shift',
  },
  {
    /**
     * **A bulk delivery, and the reason the P&L's basis toggle has something to
     * show.** Bought today, most of it still in the cold room: the cash basis
     * charges the whole ₹2,600 to this period, the consumption basis charges
     * only what the kitchen actually used. With purchases and consumption in
     * step the two bases land within a few rupees of each other, and a control
     * whose effect nobody can see teaches nothing.
     */
    daysAgo: 0,
    time: '09:05',
    category: 'Chicken',
    amountPaise: 260000,
    paymentMethod: 'cash',
    description: 'Weekend delivery from Nadia Poultry — chicken for three days',
  },
  {
    daysAgo: 0,
    time: '10:20',
    category: 'Packaging',
    amountPaise: 85000,
    paymentMethod: 'upi',
    description: 'Boxes and napkins',
  },
  {
    daysAgo: 0,
    time: '13:10',
    category: 'Maintenance',
    amountPaise: 45000,
    paymentMethod: 'cash',
    description: 'New regulator for the grill',
  },

  // ── Kanchrapara ──────────────────────────────────────────────────────────
  {
    outletId: OUTLET_KANCHRAPARA_ID,
    daysAgo: 3,
    time: '09:40',
    category: 'Chicken',
    amountPaise: 45000,
    paymentMethod: 'cash',
    description: 'Chicken from the morning market',
  },
  {
    outletId: OUTLET_KANCHRAPARA_ID,
    daysAgo: 2,
    time: '09:40',
    category: 'Chicken',
    amountPaise: 45000,
    paymentMethod: 'cash',
    description: 'Chicken and vegetables',
  },
  {
    outletId: OUTLET_KANCHRAPARA_ID,
    daysAgo: 1,
    time: '09:30',
    category: 'Chicken',
    amountPaise: 70000,
    paymentMethod: 'cash',
    description: 'Chicken from the morning market',
  },
  {
    outletId: OUTLET_KANCHRAPARA_ID,
    daysAgo: 1,
    time: '16:00',
    category: 'Packaging',
    amountPaise: 40000,
    paymentMethod: 'upi',
    description: 'Boxes',
  },
  {
    outletId: OUTLET_KANCHRAPARA_ID,
    daysAgo: 0,
    time: '09:20',
    category: 'Chicken',
    amountPaise: 55000,
    paymentMethod: 'cash',
    description: 'Chicken and vegetables',
  },
  {
    outletId: OUTLET_KANCHRAPARA_ID,
    daysAgo: 0,
    time: '12:00',
    category: 'Electricity',
    amountPaise: 60000,
    paymentMethod: 'upi',
    description: 'Monthly bill',
  },
]

/** What was in the drawer when each day started, at every outlet. */
export const OPENING_CASH_PAISE = 200000

export interface WithdrawalSeed {
  /** Defaults to Kalyani. */
  outletId?: string
  daysAgo: number
  time: string
  amountPaise: number
  withdrawnBy: string
  reason?: string
}

export const withdrawalSeeds: WithdrawalSeed[] = [
  {
    daysAgo: 1,
    time: '20:00',
    amountPaise: 100000,
    withdrawnBy: 'Demo Owner',
    reason: 'Banked on the way home',
  },
  {
    daysAgo: 0,
    time: '15:45',
    amountPaise: 150000,
    withdrawnBy: 'Demo Owner',
    reason: 'Cash for tomorrow’s market run',
  },
  {
    outletId: OUTLET_KANCHRAPARA_ID,
    daysAgo: 1,
    time: '21:00',
    amountPaise: 60000,
    withdrawnBy: 'Demo Owner',
    reason: 'Banked on the way home',
  },
]

/** Days back from today that were counted and signed off. Today is the one a walkthrough closes. */
export const CLOSED_DAYS_AGO = [3, 2, 1]

/**
 * The one drawer that did not come out right: **Kalyani, yesterday**.
 *
 * The store computes what each day should have come to and stores the counted
 * figure as that plus this, so the mismatch is a real difference between two
 * derived numbers rather than a hard-coded one that could not actually arise.
 *
 * Every other closed day balances exactly, at both outlets. A shortfall is only
 * legible as a problem beside drawers that came out right (design D2) — and a
 * demo where every day was short would demonstrate a shop with a thief in it
 * rather than a product that notices.
 */
export const MISCOUNT_PAISE = -24000
export const MISCOUNT_OUTLET_ID = OUTLET_KALYANI_ID
export const MISCOUNT_DAYS_AGO = 1
