import type { Tables } from '../../database.types'
import { menuItemId, type MenuItemKey } from './menu'
import { OUTLET_KALYANI_ID, OUTLET_KANCHRAPARA_ID } from './outlets'

/**
 * The counter's demo data: the tablets, the shift that is already open, and a
 * trading day's worth of bills at each outlet.
 *
 * Bills are **seeds, not rows** — an intent (where, when, what, how it was
 * paid) that the store materialises through the same totals function the
 * counter uses and the same snapshot rule the schema enforces. A fixture that
 * hard-coded its own totals could describe a bill the database would reject,
 * which is the one thing a demo must not do.
 *
 * Offsets are business days back from today, so a walkthrough always shows a
 * plausible recent day rather than a date from whenever these were written.
 *
 * **Two outlets trade here, and deliberately not identically** (design D2).
 * Kanchrapara turns over roughly half of Kalyani's and has nothing wrong with
 * it; Kalyani carries the low stock, the short drawer and the late bill. Two
 * outlets with the same shape would make the comparison screen — the one that
 * justifies the whole system for a multi-outlet owner — unreadable.
 */

export const DEMO_COUNTER_DEVICE_ID = 'd5000000-0000-4000-a000-000000000001'
export const DEMO_KANCHRAPARA_DEVICE_ID = 'd5000000-0000-4000-a000-000000000002'

/** The persona biller, and a colleague — a handover needs two people. */
export const DEMO_BILLER_ID = 'd1000000-0000-4000-a000-000000000003'
export const DEMO_MORNING_BILLER_ID = 'd1000000-0000-4000-a000-000000000010'
/** Kanchrapara's biller, from the account fixtures. No persona stands here. */
export const DEMO_KANCHRAPARA_BILLER_ID = 'd1000000-0000-4000-a000-000000000007'

/** The shift that is already open when a walkthrough arrives at the counter. */
export const DEMO_OPEN_SHIFT_ID = 'd6000000-0000-4000-a000-000000000001'
/** Kanchrapara's shift. Closed: nobody is standing at that counter in a demo. */
export const DEMO_KANCHRAPARA_SHIFT_ID = 'd6000000-0000-4000-a000-000000000002'

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
    set_up_at: '2026-07-26T00:00:00+00:00',
    set_up_by: null,
    last_seen_at: null,
    last_reported_unsent: 0,
    removed_at: null,
  },
  {
    id: DEMO_KANCHRAPARA_DEVICE_ID,
    outlet_id: OUTLET_KANCHRAPARA_ID,
    label: 'Counter tablet',
    set_up_at: '2026-07-26T00:00:00+00:00',
    set_up_by: null,
    last_seen_at: null,
    last_reported_unsent: 0,
    removed_at: null,
  },
]

export interface BillLineSeed {
  /** Resolved against the seed's own outlet, so one line list serves both. */
  item: MenuItemKey
  quantity: number
}

export interface BillSeed {
  /** Which outlet rang it. Defaults to Kalyani, where the personas stand. */
  outletId?: string
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

/** Resolve a seed's outlet, and its lines' menu items within that outlet. */
export function billSeedOutlet(seed: BillSeed): string {
  return seed.outletId ?? OUTLET_KALYANI_ID
}

export function billSeedItemId(seed: BillSeed, line: BillLineSeed): string {
  return menuItemId(billSeedOutlet(seed), line.item)
}

/**
 * **Four trading days at each outlet**, so a period is a period rather than a
 * pair of days with five blanks after it — and so the stock consumed over the
 * same days has bills to correspond to. Days 3, 2 and 1 are closed; today is
 * the one a walkthrough closes.
 *
 * Deliberately mixed methods: only the cash ones reach the drawer, and a demo
 * where every bill was cash could never demonstrate that.
 */
export const billSeeds: BillSeed[] = [
  // ── Kalyani, three days ago ──────────────────────────────────────────────
  {
    daysAgo: 3,
    time: '12:30',
    paymentMethod: 'cash',
    lines: [{ item: 'classic', quantity: 2 }],
  },
  {
    daysAgo: 3,
    time: '13:45',
    paymentMethod: 'upi',
    lines: [
      { item: 'mayo', quantity: 1 },
      { item: 'burger', quantity: 1 },
    ],
  },
  {
    daysAgo: 3,
    time: '19:30',
    paymentMethod: 'cash',
    lines: [{ item: 'mozzarella', quantity: 2 }],
  },
  {
    daysAgo: 3,
    time: '20:40',
    paymentMethod: 'cash',
    lines: [
      { item: 'classic', quantity: 3 },
      { item: 'double', quantity: 1 },
    ],
  },

  // ── Kalyani, two days ago ────────────────────────────────────────────────
  {
    daysAgo: 2,
    time: '12:15',
    paymentMethod: 'cash',
    lines: [{ item: 'classic', quantity: 3 }],
  },
  {
    daysAgo: 2,
    time: '13:20',
    paymentMethod: 'upi',
    lines: [{ item: 'double', quantity: 2 }],
  },
  {
    daysAgo: 2,
    time: '14:05',
    paymentMethod: 'cash',
    lines: [{ item: 'mayo', quantity: 2 }],
  },
  {
    daysAgo: 2,
    time: '19:50',
    paymentMethod: 'swiggy',
    lines: [{ item: 'classic', quantity: 2 }],
  },
  {
    daysAgo: 2,
    time: '20:30',
    paymentMethod: 'cash',
    lines: [
      { item: 'burger', quantity: 1 },
      { item: 'mozzarella', quantity: 1 },
    ],
  },

  // ── Kalyani, yesterday — the day with the short drawer ───────────────────
  {
    daysAgo: 1,
    time: '12:10',
    paymentMethod: 'cash',
    lines: [{ item: 'classic', quantity: 2 }],
  },
  {
    daysAgo: 1,
    time: '13:02',
    paymentMethod: 'upi',
    lines: [
      { item: 'mayo', quantity: 1 },
      { item: 'burger', quantity: 1 },
    ],
    customerName: 'Demo Customer',
  },
  {
    daysAgo: 1,
    time: '13:30',
    paymentMethod: 'cash',
    lines: [{ item: 'classic', quantity: 4 }],
  },
  {
    daysAgo: 1,
    time: '19:24',
    paymentMethod: 'cash',
    lines: [{ item: 'mozzarella', quantity: 3 }],
  },
  {
    daysAgo: 1,
    time: '20:05',
    paymentMethod: 'swiggy',
    lines: [{ item: 'classic', quantity: 4 }],
  },
  {
    daysAgo: 1,
    time: '20:15',
    paymentMethod: 'cash',
    lines: [
      { item: 'double', quantity: 2 },
      { item: 'mayo', quantity: 1 },
    ],
  },
  {
    daysAgo: 1,
    time: '21:40',
    paymentMethod: 'cash',
    lines: [{ item: 'burger', quantity: 1 }],
  },
  {
    // Rung on a tablet that had lost its connection, and delivered the next
    // morning — after the drawer had been counted and signed off.
    daysAgo: 1,
    time: '22:15',
    paymentMethod: 'cash',
    lines: [{ item: 'mayo', quantity: 2 }],
    arrivedAfterClose: true,
  },

  // ── Kalyani, today — the day a walkthrough closes ────────────────────────
  {
    daysAgo: 0,
    time: '11:45',
    paymentMethod: 'cash',
    lines: [{ item: 'classic', quantity: 3 }],
  },
  {
    daysAgo: 0,
    time: '12:20',
    paymentMethod: 'upi',
    lines: [{ item: 'mozzarella', quantity: 2 }],
  },
  {
    daysAgo: 0,
    time: '12:58',
    paymentMethod: 'cash',
    lines: [
      { item: 'classic', quantity: 2 },
      { item: 'burger', quantity: 1 },
    ],
    customerName: 'Demo Regular',
  },
  {
    daysAgo: 0,
    time: '13:35',
    paymentMethod: 'zomato',
    lines: [{ item: 'mayo', quantity: 2 }],
  },
  {
    daysAgo: 0,
    time: '14:02',
    paymentMethod: 'cash',
    lines: [{ item: 'mayo', quantity: 4 }],
  },
  {
    daysAgo: 0,
    time: '14:31',
    paymentMethod: 'card',
    lines: [{ item: 'burger', quantity: 2 }],
  },
  {
    daysAgo: 0,
    time: '19:20',
    paymentMethod: 'cash',
    lines: [
      { item: 'classic', quantity: 5 },
      { item: 'mozzarella', quantity: 2 },
    ],
  },
  {
    daysAgo: 0,
    time: '20:05',
    paymentMethod: 'upi',
    lines: [{ item: 'classic', quantity: 4 }],
  },
  {
    daysAgo: 0,
    time: '20:40',
    paymentMethod: 'cash',
    lines: [
      { item: 'double', quantity: 3 },
      { item: 'burger', quantity: 2 },
    ],
  },

  // ── Kanchrapara, three days ago ──────────────────────────────────────────
  {
    outletId: OUTLET_KANCHRAPARA_ID,
    daysAgo: 3,
    time: '13:10',
    paymentMethod: 'cash',
    lines: [{ item: 'classic', quantity: 2 }],
  },
  {
    outletId: OUTLET_KANCHRAPARA_ID,
    daysAgo: 3,
    time: '20:00',
    paymentMethod: 'upi',
    lines: [{ item: 'mayo', quantity: 1 }],
  },

  // ── Kanchrapara, two days ago ────────────────────────────────────────────
  {
    outletId: OUTLET_KANCHRAPARA_ID,
    daysAgo: 2,
    time: '12:50',
    paymentMethod: 'cash',
    lines: [
      { item: 'classic', quantity: 1 },
      { item: 'double', quantity: 1 },
    ],
  },
  {
    outletId: OUTLET_KANCHRAPARA_ID,
    daysAgo: 2,
    time: '14:30',
    paymentMethod: 'cash',
    lines: [{ item: 'mayo', quantity: 2 }],
  },
  {
    outletId: OUTLET_KANCHRAPARA_ID,
    daysAgo: 2,
    time: '19:40',
    paymentMethod: 'zomato',
    lines: [{ item: 'mozzarella', quantity: 1 }],
  },

  // ── Kanchrapara, yesterday — quieter, and it balanced ────────────────────
  {
    outletId: OUTLET_KANCHRAPARA_ID,
    daysAgo: 1,
    time: '12:40',
    paymentMethod: 'cash',
    lines: [{ item: 'classic', quantity: 2 }],
  },
  {
    outletId: OUTLET_KANCHRAPARA_ID,
    daysAgo: 1,
    time: '14:15',
    paymentMethod: 'upi',
    lines: [{ item: 'double', quantity: 1 }],
  },
  {
    outletId: OUTLET_KANCHRAPARA_ID,
    daysAgo: 1,
    time: '19:50',
    paymentMethod: 'cash',
    lines: [
      { item: 'classic', quantity: 3 },
      { item: 'mayo', quantity: 1 },
    ],
  },
  {
    outletId: OUTLET_KANCHRAPARA_ID,
    daysAgo: 1,
    time: '20:35',
    paymentMethod: 'swiggy',
    lines: [{ item: 'mozzarella', quantity: 2 }],
  },

  // ── Kanchrapara, today ───────────────────────────────────────────────────
  {
    outletId: OUTLET_KANCHRAPARA_ID,
    daysAgo: 0,
    time: '12:05',
    paymentMethod: 'cash',
    lines: [{ item: 'classic', quantity: 2 }],
  },
  {
    outletId: OUTLET_KANCHRAPARA_ID,
    daysAgo: 0,
    time: '13:20',
    paymentMethod: 'upi',
    lines: [{ item: 'burger', quantity: 1 }],
  },
  {
    outletId: OUTLET_KANCHRAPARA_ID,
    daysAgo: 0,
    time: '19:05',
    paymentMethod: 'cash',
    lines: [{ item: 'mayo', quantity: 3 }],
  },
  {
    outletId: OUTLET_KANCHRAPARA_ID,
    daysAgo: 0,
    time: '20:10',
    paymentMethod: 'cash',
    lines: [{ item: 'classic', quantity: 2 }],
  },
]
