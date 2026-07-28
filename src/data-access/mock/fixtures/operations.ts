import type { Tables } from '../../database.types'
import { OUTLET_KALYANI_ID } from './outlets'

/**
 * Stock, expenses and the cash float — a manager's demo day.
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

const LAST_UPDATED = '2026-07-26T00:00:00+00:00'

function stockItem(
  id: string,
  name: string,
  unit: Tables<'inventory_items'>['unit'],
  currentQuantity: number,
  lowStockThreshold: number,
  purchaseCostPaise: number,
): Tables<'inventory_items'> {
  return {
    id,
    outlet_id: OUTLET_KALYANI_ID,
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
  stockItem(INVENTORY_CHICKEN_ID, 'Chicken', 'kg', 12.5, 5, 24000),
  // 8 packets against a threshold of 10 — low, and visibly so.
  stockItem(INVENTORY_PITA_ID, 'Pita bread', 'packet', 8, 10, 4500),
  stockItem(INVENTORY_MAYO_ID, 'Mayonnaise', 'litre', 5.7, 4, 18000),
  stockItem(INVENTORY_CHEESE_ID, 'Cheese slices', 'packet', 15, 6, 22000),
  stockItem(INVENTORY_PACKAGING_ID, 'Packaging boxes', 'piece', 240, 100, 800),
]

export interface MovementSeed {
  itemId: string
  /** Business days back from today. 0 is today. */
  daysAgo: number
  movementType: Tables<'inventory_movements'>['movement_type']
  /** Magnitude for added / used / wasted; signed for a correction. */
  quantity: number
  note?: string
}

export const movementSeeds: MovementSeed[] = [
  // Chicken — 20 in, 22.5 used across three days, 15 in again. Ends at 12.5.
  { itemId: INVENTORY_CHICKEN_ID, daysAgo: 3, movementType: 'added', quantity: 20 },
  { itemId: INVENTORY_CHICKEN_ID, daysAgo: 3, movementType: 'used', quantity: 6.5 },
  { itemId: INVENTORY_CHICKEN_ID, daysAgo: 2, movementType: 'used', quantity: 5.5 },
  { itemId: INVENTORY_CHICKEN_ID, daysAgo: 1, movementType: 'added', quantity: 15 },
  { itemId: INVENTORY_CHICKEN_ID, daysAgo: 1, movementType: 'used', quantity: 8 },
  { itemId: INVENTORY_CHICKEN_ID, daysAgo: 0, movementType: 'used', quantity: 2.5 },

  // Pita bread — including a wastage, which is why it is short. Ends at 8.
  { itemId: INVENTORY_PITA_ID, daysAgo: 3, movementType: 'added', quantity: 30 },
  { itemId: INVENTORY_PITA_ID, daysAgo: 2, movementType: 'used', quantity: 9 },
  { itemId: INVENTORY_PITA_ID, daysAgo: 1, movementType: 'used', quantity: 8 },
  {
    itemId: INVENTORY_PITA_ID,
    daysAgo: 1,
    movementType: 'wasted',
    quantity: 2,
    note: 'Packet split on the floor during the evening rush.',
  },
  { itemId: INVENTORY_PITA_ID, daysAgo: 0, movementType: 'used', quantity: 3 },

  // Mayonnaise — carries the correction, so the ledger shows how history is
  // fixed without being edited. Ends at 5.7.
  { itemId: INVENTORY_MAYO_ID, daysAgo: 3, movementType: 'added', quantity: 10 },
  { itemId: INVENTORY_MAYO_ID, daysAgo: 2, movementType: 'used', quantity: 1.8 },
  { itemId: INVENTORY_MAYO_ID, daysAgo: 1, movementType: 'used', quantity: 2 },
  {
    itemId: INVENTORY_MAYO_ID,
    daysAgo: 0,
    movementType: 'correction',
    quantity: -0.5,
    note: 'Recounted after the delivery — half a litre less than the sheet said.',
  },

  // Cheese slices. Ends at 15.
  { itemId: INVENTORY_CHEESE_ID, daysAgo: 3, movementType: 'added', quantity: 20 },
  { itemId: INVENTORY_CHEESE_ID, daysAgo: 1, movementType: 'used', quantity: 5 },

  // Packaging. Ends at 240.
  { itemId: INVENTORY_PACKAGING_ID, daysAgo: 3, movementType: 'added', quantity: 300 },
  { itemId: INVENTORY_PACKAGING_ID, daysAgo: 2, movementType: 'used', quantity: 25 },
  { itemId: INVENTORY_PACKAGING_ID, daysAgo: 1, movementType: 'used', quantity: 20 },
  { itemId: INVENTORY_PACKAGING_ID, daysAgo: 0, movementType: 'used', quantity: 15 },
]

export interface ExpenseSeed {
  /** Business days back from today. 0 is today. */
  daysAgo: number
  /** IST wall-clock time on that business day, `HH:MM`. */
  time: string
  category: Tables<'expenses'>['category']
  amountPaise: number
  paymentMethod: Tables<'expenses'>['payment_method']
  description?: string
}

/**
 * Both days carry cash and non-cash expenses, because the rule the cash screen
 * exists to demonstrate — only cash reaches the drawer — cannot be shown by a
 * day where everything was cash.
 */
export const expenseSeeds: ExpenseSeed[] = [
  {
    daysAgo: 1,
    time: '09:15',
    category: 'raw_materials',
    amountPaise: 150000,
    paymentMethod: 'cash',
    description: 'Chicken and vegetables from the morning market',
  },
  {
    daysAgo: 1,
    time: '11:00',
    category: 'electricity',
    amountPaise: 120000,
    paymentMethod: 'upi',
    description: 'Monthly bill',
  },
  {
    daysAgo: 1,
    time: '17:30',
    category: 'other',
    amountPaise: 20000,
    paymentMethod: 'cash',
    description: 'Tea for the evening shift',
  },
  {
    daysAgo: 0,
    time: '09:05',
    category: 'raw_materials',
    amountPaise: 120000,
    paymentMethod: 'cash',
    description: 'Chicken from Nadia Poultry',
  },
  {
    daysAgo: 0,
    time: '10:20',
    category: 'packaging',
    amountPaise: 85000,
    paymentMethod: 'upi',
    description: 'Boxes and napkins',
  },
  {
    daysAgo: 0,
    time: '13:10',
    category: 'maintenance',
    amountPaise: 45000,
    paymentMethod: 'cash',
    description: 'New regulator for the grill',
  },
]

/** What was in the drawer when each day started. */
export const OPENING_CASH_PAISE = 200000

export interface WithdrawalSeed {
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
]

/**
 * Yesterday's counted drawer, **deliberately not what was expected**.
 *
 * The store computes what the day should have come to and stores this as the
 * counted figure, so the mismatch is a real difference between two derived
 * numbers rather than a hard-coded one that could not actually arise.
 */
export const YESTERDAY_MISCOUNT_PAISE = -24000
