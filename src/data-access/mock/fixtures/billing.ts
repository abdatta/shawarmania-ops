import type { Tables } from '../../database.types'
import {
  MENU_ITEM_BURGER_ID,
  MENU_ITEM_CLASSIC_ID,
  MENU_ITEM_DOUBLE_ID,
  MENU_ITEM_MAYO_ID,
  MENU_ITEM_MOZZARELLA_ID,
} from './menu'
import { OUTLET_KALYANI_ID } from './outlets'

/**
 * The counter's demo data: the tablet, the shift that is already open, and a
 * trading day's worth of bills.
 *
 * Bills are **seeds, not rows** — an intent (when, what, how it was paid) that
 * the store materialises through the same totals function the counter uses and
 * the same snapshot rule the schema enforces. A fixture that hard-coded its own
 * totals could describe a bill the database would reject, which is the one thing
 * a demo must not do.
 *
 * Offsets are business days back from today, so a walkthrough always shows a
 * plausible recent day rather than a date from whenever these were written.
 */

export const DEMO_COUNTER_DEVICE_ID = 'd5000000-0000-4000-a000-000000000001'

/** The persona biller, and a colleague — a handover needs two people. */
export const DEMO_BILLER_ID = 'd1000000-0000-4000-a000-000000000003'
export const DEMO_MORNING_BILLER_ID = 'd1000000-0000-4000-a000-000000000010'

/** The shift that is already open when a walkthrough arrives at the counter. */
export const DEMO_OPEN_SHIFT_ID = 'd6000000-0000-4000-a000-000000000001'

/**
 * Every demo biller's PIN.
 *
 * A PIN selects attribution; it is not the security boundary, and the real one
 * arrives with `counter-devices-and-offline` (#9) as a hash with a real refusal
 * path behind it. This exists so the unlock and handover screens have something
 * to refuse — a PIN pad that accepts anything demonstrates a product where it
 * does — and it is one shared value so a walkthrough needs no crib sheet.
 * Recorded in `docs/DEMO_MODE.md` beside the persona names.
 */
export const DEMO_BILLER_PIN = '1234'

export const counterDeviceFixtures: Tables<'counter_devices'>[] = [
  {
    id: DEMO_COUNTER_DEVICE_ID,
    outlet_id: OUTLET_KALYANI_ID,
    label: 'Counter tablet',
    enrolled_at: '2026-07-26T00:00:00+00:00',
    enrolled_by: null,
    last_seen_at: null,
    revoked_at: null,
  },
]

export interface BillLineSeed {
  menuItemId: string
  quantity: number
}

export interface BillSeed {
  /** Business days back from today. 0 is today. */
  daysAgo: number
  /** IST wall-clock time on that business day, `HH:MM`. */
  time: string
  paymentMethod: Tables<'bills'>['payment_method']
  lines: BillLineSeed[]
  customerName?: string
  /**
   * This bill reached the server *after* its business day was closed — the
   * reconciliation exception the whole daily-cash chain exists to protect
   * against. The closed figures do not move; the surface says so.
   */
  arrivedAfterClose?: boolean
}

/**
 * Yesterday's trade and today's, so the cash screen has a closed day to show and
 * an open one to close. Deliberately mixed methods: only the cash ones reach the
 * drawer, and a demo where every bill was cash could never demonstrate that.
 */
export const billSeeds: BillSeed[] = [
  // ── Yesterday — the day that is already closed ───────────────────────────
  {
    daysAgo: 1,
    time: '12:10',
    paymentMethod: 'cash',
    lines: [{ menuItemId: MENU_ITEM_CLASSIC_ID, quantity: 2 }],
  },
  {
    daysAgo: 1,
    time: '13:02',
    paymentMethod: 'upi',
    lines: [
      { menuItemId: MENU_ITEM_MAYO_ID, quantity: 1 },
      { menuItemId: MENU_ITEM_BURGER_ID, quantity: 1 },
    ],
    customerName: 'Demo Customer',
  },
  {
    daysAgo: 1,
    time: '13:30',
    paymentMethod: 'cash',
    lines: [{ menuItemId: MENU_ITEM_CLASSIC_ID, quantity: 4 }],
  },
  {
    daysAgo: 1,
    time: '19:24',
    paymentMethod: 'cash',
    lines: [{ menuItemId: MENU_ITEM_MOZZARELLA_ID, quantity: 3 }],
  },
  {
    daysAgo: 1,
    time: '20:05',
    paymentMethod: 'swiggy',
    lines: [{ menuItemId: MENU_ITEM_CLASSIC_ID, quantity: 4 }],
  },
  {
    daysAgo: 1,
    time: '20:15',
    paymentMethod: 'cash',
    lines: [
      { menuItemId: MENU_ITEM_DOUBLE_ID, quantity: 2 },
      { menuItemId: MENU_ITEM_MAYO_ID, quantity: 1 },
    ],
  },
  {
    daysAgo: 1,
    time: '21:40',
    paymentMethod: 'cash',
    lines: [{ menuItemId: MENU_ITEM_BURGER_ID, quantity: 1 }],
  },
  {
    // Rung on a tablet that had lost its connection, and delivered the next
    // morning — after the drawer had been counted and signed off.
    daysAgo: 1,
    time: '22:15',
    paymentMethod: 'cash',
    lines: [{ menuItemId: MENU_ITEM_MAYO_ID, quantity: 2 }],
    arrivedAfterClose: true,
  },

  // ── Today — the day a walkthrough closes ─────────────────────────────────
  {
    daysAgo: 0,
    time: '11:45',
    paymentMethod: 'cash',
    lines: [{ menuItemId: MENU_ITEM_CLASSIC_ID, quantity: 3 }],
  },
  {
    daysAgo: 0,
    time: '12:20',
    paymentMethod: 'upi',
    lines: [{ menuItemId: MENU_ITEM_MOZZARELLA_ID, quantity: 2 }],
  },
  {
    daysAgo: 0,
    time: '12:58',
    paymentMethod: 'cash',
    lines: [
      { menuItemId: MENU_ITEM_CLASSIC_ID, quantity: 2 },
      { menuItemId: MENU_ITEM_BURGER_ID, quantity: 1 },
    ],
    customerName: 'Demo Regular',
  },
  {
    daysAgo: 0,
    time: '13:35',
    paymentMethod: 'zomato',
    lines: [{ menuItemId: MENU_ITEM_MAYO_ID, quantity: 2 }],
  },
  {
    daysAgo: 0,
    time: '14:02',
    paymentMethod: 'cash',
    lines: [{ menuItemId: MENU_ITEM_MAYO_ID, quantity: 4 }],
  },
  {
    daysAgo: 0,
    time: '14:31',
    paymentMethod: 'card',
    lines: [{ menuItemId: MENU_ITEM_BURGER_ID, quantity: 2 }],
  },
  {
    daysAgo: 0,
    time: '19:20',
    paymentMethod: 'cash',
    lines: [
      { menuItemId: MENU_ITEM_CLASSIC_ID, quantity: 5 },
      { menuItemId: MENU_ITEM_MOZZARELLA_ID, quantity: 2 },
    ],
  },
  {
    daysAgo: 0,
    time: '20:05',
    paymentMethod: 'upi',
    lines: [{ menuItemId: MENU_ITEM_CLASSIC_ID, quantity: 4 }],
  },
  {
    daysAgo: 0,
    time: '20:40',
    paymentMethod: 'cash',
    lines: [
      { menuItemId: MENU_ITEM_DOUBLE_ID, quantity: 3 },
      { menuItemId: MENU_ITEM_BURGER_ID, quantity: 2 },
    ],
  },
]
