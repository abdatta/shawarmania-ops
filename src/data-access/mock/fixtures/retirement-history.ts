import type { Tables } from '../../database.types'

/**
 * Historical expense and aggregator readings retained after the notebook was
 * retired. They keep the four-role demo's month internally consistent.
 *
 * Thin on purpose. The registry contract requires every surface to have a mock
 * behind it and the four-role walkthrough is a standing gate, so this exists to
 * make the surface render coherently and to exercise every derivation path once.
 * It is not a second demo month competing with `store.ts`'s trading day.
 *
 * Three awkward days rather than three tidy ones, because a screen only seen
 * going well has not been reviewed:
 *
 *  - **the commission rate changes mid-month**, so the month reading proves it
 *    nets each day by that day's own rate rather than by one rate applied to a
 *    total;
 *  - **one drawer comes up short**, with the note that explains it;
 *  - **one day's opening disagrees with the previous count**, so the broken-chain
 *    signal is on screen without anybody staging it.
 *
 * Dates are `daysAgo` offsets materialised by the store, so the demo month is
 * always the month somebody is looking at it in.
 *
 * **These carry no rows for today**, because the staff surface opens on today
 * and yesterday and the rows a reader is meant to study are yesterday's:
 * attributed across all four roles, so the list shows what it is now for — every
 * row at the outlet, with the ones you may still fix legible at a glance.
 *
 * Today is not empty, though, and that is `expenseSeeds`' doing rather than an
 * oversight: three purchases land on the counter's own trading day so the
 * tablet's panel demonstrates a list somebody is adding to, not only the empty
 * state. Before `retire-the-manual-ledger` (#12) the tablet read a different
 * table from the one those rows lived in and showed the empty state instead — a
 * split that also meant the drawer subtracted expenses the tablet could not
 * list. One record ended both.
 */

export interface ManualLedgerDaySeed {
  daysAgo: number
  openingCashPaise: number
  cashRevenuePaise: number
  upiRevenuePaise: number
  zomatoRevenuePaise: number
  cashAddedPaise?: number
  cashAddedReason?: string
  cashRemovedPaise?: number
  cashRemovedReason?: string
  countedCashPaise: number
  zomatoCommissionPaise: number
  note?: string
  /**
   * What this day's drawer is *meant* to be out by, in paise. Zero unless the
   * seed is deliberately awkward.
   *
   * Declared rather than inferred, and checked by the store on construction, so
   * an edit that quietly breaks the arithmetic fails loudly instead of producing
   * a demo whose figures cannot be reproduced by the real system. This is the
   * same guard the inventory fixtures get.
   */
  expectedDifferencePaise?: number
  /**
   * Whether a manager corrected this day after the owner recorded it, so the
   * "recorded by X, last corrected by Y" reading is on screen in the
   * walkthrough rather than only in a test (design D6).
   */
  correctedByManager?: boolean
}

export interface ManualLedgerExpenseSeed {
  daysAgo: number
  category: Tables<'expenses'>['category']
  isCash: boolean
  amountPaise: number
  note?: string
  time: string
  /**
   * Who recorded it. Defaults to the owner, which is who recorded everything
   * before this capability opened up.
   */
  recordedBy?: 'owner' | 'manager' | 'biller' | 'employee'
  /**
   * A supply row read from a statement rather than typed. When set, the row
   * carries this origin and reference and no recorder, and the demo shows a
   * Hyperpure cost that arrived on its own — the state the freeze produces.
   */
  sourceSystem?: string
  sourceRef?: string
  /** A cost drawn on by both kitchens from one inventory, booked once. */
  sharedCost?: boolean
  /**
   * Recorded by somebody holding no assignment at this outlet, which the guard
   * stamps at insert.
   *
   * Declared rather than derived from `recordedBy`, because the **demo** owner
   * persona also holds a Franchise Admin assignment at Kalyani — their writes
   * there come from that row, which is why the drawer opens for them at all —
   * so nothing they record in this demo would ever be away. **Production is the
   * other way round**: neither Super Admin holds an assignment at either outlet,
   * which is the whole situation this change was written for. Declaring it here
   * lets the walkthrough show the state a real owner produces.
   */
  recordedAway?: boolean
  /** Set to withdraw this row. A reason is optional [owner, 2026-08-09]. */
  voidedAtTime?: string
  voidedReason?: string
}

/**
 * Four days back to one day back. Today is left unrecorded on purpose: the
 * surface opens on today, and an owner's first act is to record it — a demo that
 * opened on a finished day would never show the empty form.
 */
export const manualLedgerDaySeeds: ManualLedgerDaySeed[] = [
  // Four days ago. Balanced, at the old Zomato rate.
  //   5,000 + 12,400 + 0 − 2,400 (cash expenses) − 0 = 15,000
  {
    daysAgo: 4,
    openingCashPaise: 500_000,
    cashRevenuePaise: 1_240_000,
    upiRevenuePaise: 386_000,
    zomatoRevenuePaise: 312_000,
    countedCashPaise: 1_500_000,
    zomatoCommissionPaise: 70_200,
  },
  // Three days ago. Banked ₹10,000, and the drawer came up ₹250 short.
  //   15,000 + 11,800 − 1,800 − 10,000 = 15,000, counted 14,750
  {
    daysAgo: 3,
    openingCashPaise: 1_500_000,
    cashRevenuePaise: 1_180_000,
    upiRevenuePaise: 402_000,
    zomatoRevenuePaise: 288_000,
    cashRemovedPaise: 1_000_000,
    cashRemovedReason: 'Banked on the way home',
    countedCashPaise: 1_475_000,
    // 18% where the neighbouring days sit near 22.5%. The take really does move with
    // the mix of distances and discounts, and the month's arithmetic is only worth
    // asserting against fixtures where it visibly does.
    zomatoCommissionPaise: 51_840,
    note: 'Counted twice. Two ₹100 notes and some change unaccounted for.',
    expectedDifferencePaise: -25_000,
    // The short day is the one a manager went back into, which is exactly when a
    // second person touches a row somebody else recorded.
    correctedByManager: true,
  },
  // Two days ago. **The chain break**: opens at ₹15,000 although the previous day
  // counted ₹14,750, because whoever opened the drawer wrote down what they
  // expected rather than what they had. The surface says so and repairs nothing.
  //   15,000 + 9,600 + 2,000 − 900 − 0 = 25,700
  {
    daysAgo: 2,
    openingCashPaise: 1_500_000,
    cashRevenuePaise: 960_000,
    upiRevenuePaise: 355_000,
    zomatoRevenuePaise: 331_000,
    cashAddedPaise: 200_000,
    cashAddedReason: 'Owner topped up the float',
    countedCashPaise: 2_570_000,
    zomatoCommissionPaise: 74_475,
  },
  // Yesterday. **A visibly different Zomato take** — 18% where the other days sit
  // near 22.5%. It is a fixture rather than a special case: the take moves with
  // the mix of order distances and discounts, which is why a stored rate was
  // retired in favour of the amount Zomato actually charged.
  //
  // A fridge was also bought with drawer cash, recorded as cash taken out with
  // its reason and never as an expense. That is what keeps this day reconciling
  // while the month's expenses stay clean, and it is the half of the no-capital
  // decision that would silently break the daily cash check if it were left out
  // (design D8).
  //   25,700 + 8,750 − 14,500 (wages, cash) − 12,000 (fridge) = 7,950
  {
    daysAgo: 1,
    openingCashPaise: 2_570_000,
    cashRevenuePaise: 875_000,
    upiRevenuePaise: 418_000,
    zomatoRevenuePaise: 402_000,
    cashRemovedPaise: 1_200_000,
    cashRemovedReason: 'Second fridge, bought from Kalyani Electronics',
    countedCashPaise: 795_000,
    zomatoCommissionPaise: 72_360,
  },
]

export const manualLedgerExpenseSeeds: ManualLedgerExpenseSeed[] = [
  {
    daysAgo: 4,
    category: 'Chicken',
    isCash: true,
    amountPaise: 240_000,
    note: '10 kg from Nadia Poultry',
    time: '09:15',
  },
  {
    daysAgo: 3,
    category: 'Vegetables and pita',
    isCash: true,
    amountPaise: 180_000,
    note: 'Kalyani market',
    time: '09:05',
    recordedBy: 'biller',
  },
  {
    daysAgo: 3,
    category: 'Electricity',
    isCash: false,
    amountPaise: 320_000,
    note: 'WBSEDCL bill for July, paid by UPI',
    time: '18:40',
  },
  {
    daysAgo: 2,
    category: 'Packaging',
    isCash: true,
    amountPaise: 90_000,
    note: 'Paper bags and foil, 500 each',
    time: '11:20',
    recordedBy: 'employee',
  },
  // Read from Hyperpure's own statement, not typed: one order, booked once as a
  // shared cost because both kitchens draw on one inventory. It is what the freeze
  // produces, and the walkthrough shows a supply cost that arrived on its own.
  {
    daysAgo: 3,
    category: 'Hyperpure',
    isCash: false,
    amountPaise: 931_100,
    note: 'Hyperpure ZHPWB27-OR-DEMO',
    time: '09:58',
    sourceSystem: 'hyperpure',
    sourceRef: 'ZHPWB27-OR-DEMO',
    sharedCost: true,
  },
  // The owner's, from the drawer, and settled without being at the outlet — the
  // one combination that earns a from-away marker. Expected cash moved and
  // nobody standing in the shop spent it, which is what whoever counts tonight
  // needs to know (design D9).
  {
    daysAgo: 1,
    category: 'Staff wages',
    isCash: true,
    amountPaise: 1_450_000,
    note: 'Four staff',
    time: '21:30',
    recordedAway: true,
  },
  {
    daysAgo: 1,
    category: 'Maintenance',
    isCash: false,
    amountPaise: 145_000,
    note: 'Grill serviced, paid by UPI',
    time: '16:00',
    recordedBy: 'manager',
  },
  // Yesterday, withdrawn. Typed twice by whoever was at the counter and caught
  // the same evening, which is the mistake void exists for. It stays on screen,
  // struck through, and counts toward nothing — including the drawer arithmetic
  // the store checks above, which is why this row can sit on a day that
  // reconciles.
  //
  // No reason on it, deliberately [owner, 2026-08-09]: the trace answers who and
  // when, and a demo that showed every withdrawal explained would imply a field
  // that is not required.
  {
    daysAgo: 1,
    category: 'Packaging',
    isCash: true,
    amountPaise: 60_000,
    note: 'Foil rolls — entered twice',
    time: '17:05',
    recordedBy: 'biller',
    voidedAtTime: '17:11',
  },
]
