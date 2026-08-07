import type { Tables } from '../../database.types'

/**
 * The manual ledger's demo month (#36) — **temporary, and deleted with the
 * capability**.
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
 */

export interface ManualLedgerDaySeed {
  daysAgo: number
  openingCashPaise: number
  cashRevenuePaise: number
  upiRevenuePaise: number
  zomatoRevenuePaise: number
  swiggyRevenuePaise: number
  cashAddedPaise?: number
  cashAddedReason?: string
  cashRemovedPaise?: number
  cashRemovedReason?: string
  countedCashPaise: number
  zomatoCommissionBp: number
  swiggyCommissionBp: number
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
}

export interface ManualLedgerExpenseSeed {
  daysAgo: number
  category: Tables<'manual_ledger_expenses'>['category']
  isCash: boolean
  amountPaise: number
  note?: string
  time: string
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
    swiggyRevenuePaise: 248_000,
    countedCashPaise: 1_500_000,
    zomatoCommissionBp: 2250,
    swiggyCommissionBp: 2100,
  },
  // Three days ago. Banked ₹10,000, and the drawer came up ₹250 short.
  //   15,000 + 11,800 − 1,800 − 10,000 = 15,000, counted 14,750
  {
    daysAgo: 3,
    openingCashPaise: 1_500_000,
    cashRevenuePaise: 1_180_000,
    upiRevenuePaise: 402_000,
    zomatoRevenuePaise: 288_000,
    swiggyRevenuePaise: 194_000,
    cashRemovedPaise: 1_000_000,
    cashRemovedReason: 'Banked on the way home',
    countedCashPaise: 1_475_000,
    zomatoCommissionBp: 2250,
    swiggyCommissionBp: 2100,
    note: 'Counted twice. Two ₹100 notes and some change unaccounted for.',
    expectedDifferencePaise: -25_000,
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
    swiggyRevenuePaise: 226_000,
    cashAddedPaise: 200_000,
    cashAddedReason: 'Owner topped up the float',
    countedCashPaise: 2_570_000,
    zomatoCommissionBp: 2250,
    swiggyCommissionBp: 2100,
  },
  // Yesterday. **The renegotiated Zomato rate**, from this day onward — which is
  // the case the whole per-day-rate design exists for.
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
    swiggyRevenuePaise: 233_000,
    cashRemovedPaise: 1_200_000,
    cashRemovedReason: 'Second fridge, bought from Kalyani Electronics',
    countedCashPaise: 795_000,
    zomatoCommissionBp: 1800,
    swiggyCommissionBp: 2100,
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
  },
  {
    daysAgo: 1,
    category: 'Staff wages',
    isCash: true,
    amountPaise: 1_450_000,
    note: 'Four staff',
    time: '21:30',
  },
  {
    daysAgo: 1,
    category: 'Maintenance',
    isCash: false,
    amountPaise: 145_000,
    note: 'Grill serviced, paid by UPI',
    time: '16:00',
  },
]
