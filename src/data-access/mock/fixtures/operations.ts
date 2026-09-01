import type { Tables } from '../../database.types'
import { OUTLET_KALYANI_ID, OUTLET_KANCHRAPARA_ID } from './outlets'

/**
 * Expenses and the cash float — a manager's demo day, at each of the two
 * trading outlets.
 *
 * **It held the stock ledger too until #51**, which deleted the Stock surface
 * along with the low-stock item that gave its treatment a subject.
 *
 * One thing here is deliberate awkwardness rather than oversight, because a
 * screen that has only ever been seen going well has not been reviewed:
 * **yesterday closed with a real mismatch**, and a bill for yesterday arrived
 * after it closed (see fixtures/billing.ts), so the reconciliation exception is
 * visible without anybody staging it.
 *
 * **It belongs to Kalyani, and Kanchrapara is deliberately fine** (design D2).
 * Two outlets with identical shapes make the console unreadable — a difference
 * is only legible against something that is not different.
 */

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
     * **A bulk delivery: one day carrying three days of chicken.** It was here
     * to give the P&L's basis toggle something to show, and both the toggle
     * (#12) and the P&L (#51) have since gone. It stays because the Ledger
     * still reads better for it — a shop does not buy in even daily amounts,
     * and a month of identical purchases is a month nobody would recognise.
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
