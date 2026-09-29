/**
 * Points and gold, as an outlet chooses them (a-regular-earns-points-and-gold,
 * #62).
 *
 * **Every rule here is one outlet's choice**, like `./service`. An outlet
 * starts with all of it off and bills exactly as it did before points existed,
 * so every function below answers the all-off outlet with nothing: no points
 * earned, none usable, nobody gold, nobody eligible.
 *
 * **Points and gold are two switches** [owner, 2026-09-29]. An outlet may run
 * points with no gold members at all; with gold off it has no gold, so nothing
 * about gold — a cap, a multiplier, a grant — applies there.
 *
 * Pure functions over plain values. The counter, the mock adapter and the live
 * one read the same rules from here, so the demo cannot teach a behaviour the
 * database will not keep. Integer arithmetic only: a point is a whole rupee,
 * and nothing here ever holds a fraction of one.
 */

/** One point is one rupee off, and is not configurable (design D12). */
export const POINT_VALUE_PAISE = 100

/**
 * Gold is earned by what was paid here in the last thirty days, and the window
 * is not a setting [owner, 2026-09-29]: a monthly spend is the whole idea.
 */
export const GOLD_WINDOW_DAYS = 30

/**
 * An outlet's loyalty rules — the columns design D12 puts on `outlets`.
 *
 * The earn pair and the cap are set exactly while points are on. The gold cap
 * is set exactly while points **and** gold are on, and is never below the
 * cap for everybody. The multiplier and the duration always have a value, so a
 * switch turned on starts somewhere sensible. The threshold is set exactly
 * while billers may upgrade to Gold, which needs gold.
 */
export interface OutletLoyaltySettings {
  pointsEnabled: boolean
  /** Points earned per block. */
  earnPoints: number | null
  /** The block, in paise: whole rupees. */
  earnBlockPaise: number | null
  /** The most of a bill (after other discounts) points may pay, in basis points. */
  useCapBp: number | null
  /** Whether this outlet has gold members at all. */
  goldEnabled: boolean
  /**
   * How much faster a gold member earns, in hundredths: 100 is 1×, the same
   * rate as everybody; 150 is 1.5× [owner, 2026-09-29]. Never below 100.
   */
  goldEarnMultiplierX100: number
  /** The most of a gold member's bill points may pay. At least `useCapBp`. */
  goldUseCapBp: number | null
  /** How long a grant of gold lasts, in whole months. */
  goldDurationMonths: number
  /** Whether a biller may make an eligible customer gold at the counter. */
  goldCounterGrant: boolean
  /** Paid at this outlet in the last `GOLD_WINDOW_DAYS`, in paise: whole rupees. */
  goldThresholdPaise: number | null
}

/** Six months unless the outlet changes it [owner, 2026-09-28]. */
export const DEFAULT_GOLD_DURATION_MONTHS = 6

/** 1×: a gold member earns at everybody's rate unless the outlet says otherwise. */
export const SAME_RATE_X100 = 100

/** A gold member earns at most ten times as fast. A typo past that is refused. */
export const MAX_GOLD_MULTIPLIER_X100 = 1_000

/** What every outlet starts with, and what bills exactly as before points existed. */
export const ALL_OFF_LOYALTY_SETTINGS: Readonly<OutletLoyaltySettings> = Object.freeze({
  pointsEnabled: false,
  earnPoints: null,
  earnBlockPaise: null,
  useCapBp: null,
  goldEnabled: false,
  goldEarnMultiplierX100: SAME_RATE_X100,
  goldUseCapBp: null,
  goldDurationMonths: DEFAULT_GOLD_DURATION_MONTHS,
  goldCounterGrant: false,
  goldThresholdPaise: null,
})

/** What the Points switch starts on: 5 points per ₹200, and 10% [owner, 2026-09-28]. */
export const DEFAULT_POINTS_RULES = Object.freeze({
  earnPoints: 5,
  earnBlockPaise: 20_000,
  useCapBp: 1_000,
})

/** The gold cap a switch starts on: 50% [owner, 2026-09-28]. */
export const DEFAULT_GOLD_USE_CAP_BP = 5_000

/** What Allow billers to upgrade to Gold starts on: ₹2,000 a month [owner, 2026-09-28]. */
export const DEFAULT_GOLD_THRESHOLD_PAISE = 200_000

export const MAX_GOLD_DURATION_MONTHS = 60

/**
 * Why a combination is refused, named so a caller can word it. Each is a check
 * the database will carry, so a hand-crafted request meets it too.
 */
export type LoyaltySettingsProblem =
  | 'earn_rate_required'
  | 'earn_rate_invalid'
  | 'cap_required'
  | 'cap_out_of_range'
  | 'gold_cap_required'
  | 'gold_cap_below_cap'
  | 'multiplier_out_of_range'
  | 'points_rules_while_off'
  | 'gold_cap_while_off'
  | 'duration_out_of_range'
  | 'counter_gold_without_gold'
  | 'threshold_required'
  | 'threshold_invalid'
  | 'threshold_while_off'

export const LOYALTY_SETTINGS_PROBLEM_MESSAGES: Record<LoyaltySettingsProblem, string> = {
  earn_rate_required: 'Type how many points a bill earns, and for how many rupees.',
  earn_rate_invalid: 'Points are earned in whole points, for a whole number of rupees.',
  cap_required: 'Type the most of a bill points may pay.',
  cap_out_of_range: 'The points discount is a percentage from 1 to 100.',
  gold_cap_required: 'Type the most of a gold member’s bill points may pay.',
  gold_cap_below_cap: 'Gold members’ points discount cannot be less than everybody’s.',
  multiplier_out_of_range: 'The gold points multiplier is between 1× and 10×.',
  points_rules_while_off: 'Points rules need points to be turned on.',
  gold_cap_while_off: 'A gold points discount needs both points and gold to be on.',
  duration_out_of_range: `Gold is valid for between 1 and ${MAX_GOLD_DURATION_MONTHS} months.`,
  counter_gold_without_gold: 'Billers can upgrade to Gold only while gold members are on.',
  threshold_required: 'Type the least a customer spends in a month to upgrade to Gold.',
  threshold_invalid: 'The monthly spend is a whole number of rupees, at least ₹1.',
  threshold_while_off: 'A monthly spend needs Allow billers to upgrade to Gold to be on.',
}

const isWholeRupees = (paise: number) => Number.isInteger(paise) && paise > 0 && paise % 100 === 0
const isPositiveInteger = (value: number) => Number.isInteger(value) && value > 0
const isCap = (bp: number) => Number.isInteger(bp) && bp >= 1 && bp <= 10_000

/** The first thing wrong with a combination, or null when it may be stored. */
export function loyaltySettingsProblem(
  settings: OutletLoyaltySettings,
): LoyaltySettingsProblem | null {
  const s = settings
  if (s.pointsEnabled) {
    if (s.earnPoints === null || s.earnBlockPaise === null) return 'earn_rate_required'
    if (!isPositiveInteger(s.earnPoints) || !isWholeRupees(s.earnBlockPaise)) {
      return 'earn_rate_invalid'
    }
    if (s.useCapBp === null) return 'cap_required'
    if (!isCap(s.useCapBp)) return 'cap_out_of_range'
  } else if (s.earnPoints !== null || s.earnBlockPaise !== null || s.useCapBp !== null) {
    return 'points_rules_while_off'
  }
  if (s.pointsEnabled && s.goldEnabled) {
    if (s.goldUseCapBp === null) return 'gold_cap_required'
    if (!isCap(s.goldUseCapBp)) return 'cap_out_of_range'
    if (s.goldUseCapBp < (s.useCapBp ?? 0)) return 'gold_cap_below_cap'
  } else if (s.goldUseCapBp !== null) {
    return 'gold_cap_while_off'
  }
  if (
    !Number.isInteger(s.goldEarnMultiplierX100) ||
    s.goldEarnMultiplierX100 < SAME_RATE_X100 ||
    s.goldEarnMultiplierX100 > MAX_GOLD_MULTIPLIER_X100
  ) {
    return 'multiplier_out_of_range'
  }
  if (
    !Number.isInteger(s.goldDurationMonths) ||
    s.goldDurationMonths < 1 ||
    s.goldDurationMonths > MAX_GOLD_DURATION_MONTHS
  ) {
    return 'duration_out_of_range'
  }
  if (s.goldCounterGrant) {
    if (!s.goldEnabled) return 'counter_gold_without_gold'
    if (s.goldThresholdPaise === null) return 'threshold_required'
    if (!isWholeRupees(s.goldThresholdPaise)) return 'threshold_invalid'
  } else if (s.goldThresholdPaise !== null) {
    return 'threshold_while_off'
  }
  return null
}

/**
 * The combination made whole after a switch: every value a switch that is off
 * cannot hold is cleared, and every value a switch that is on needs starts on
 * the owner's numbers. One place, so the three switches cannot disagree.
 */
function settle(s: OutletLoyaltySettings): OutletLoyaltySettings {
  const points = s.pointsEnabled
  const gold = s.goldEnabled
  const counter = gold && s.goldCounterGrant
  return {
    ...s,
    earnPoints: points ? (s.earnPoints ?? DEFAULT_POINTS_RULES.earnPoints) : null,
    earnBlockPaise: points ? (s.earnBlockPaise ?? DEFAULT_POINTS_RULES.earnBlockPaise) : null,
    useCapBp: points ? (s.useCapBp ?? DEFAULT_POINTS_RULES.useCapBp) : null,
    goldUseCapBp: points && gold ? (s.goldUseCapBp ?? DEFAULT_GOLD_USE_CAP_BP) : null,
    goldCounterGrant: counter,
    goldThresholdPaise: counter ? (s.goldThresholdPaise ?? DEFAULT_GOLD_THRESHOLD_PAISE) : null,
  }
}

/** The Points switch. On starts on the owner's numbers; off clears every points rule. */
export function withPointsSwitched(
  settings: OutletLoyaltySettings,
  on: boolean,
): OutletLoyaltySettings {
  return settle({
    ...settings,
    pointsEnabled: on,
    ...(on ? {} : { earnPoints: null, earnBlockPaise: null, useCapBp: null, goldUseCapBp: null }),
  })
}

/** The Gold members switch. Off takes billers' grants with it, since they need gold. */
export function withGoldSwitched(
  settings: OutletLoyaltySettings,
  on: boolean,
): OutletLoyaltySettings {
  return settle({
    ...settings,
    goldEnabled: on,
    ...(on ? {} : { goldUseCapBp: null, goldCounterGrant: false, goldThresholdPaise: null }),
  })
}

/** Allow billers to upgrade to Gold. On starts on ₹2,000 a month. */
export function withCounterGoldSwitched(
  settings: OutletLoyaltySettings,
  on: boolean,
): OutletLoyaltySettings {
  return settle({
    ...settings,
    goldCounterGrant: on,
    ...(on ? {} : { goldThresholdPaise: null }),
  })
}

/**
 * What a bill earns on (design D6): its subtotal less every discount **except
 * points**, and not its rounding. A ₹200 bill paid as ₹180 and 20 points earns
 * on the ₹200 [owner, 2026-09-28].
 */
export function earnBasisPaise(bill: {
  subtotalPaise: number
  /** Every discount on the bill, points included. */
  discountPaise: number
  /** The part of `discountPaise` that was points. */
  pointsDiscountPaise: number
}): number {
  return Math.max(0, bill.subtotalPaise - (bill.discountPaise - bill.pointsDiscountPaise))
}

/** The rule a bill earns by. */
export interface EarnRate {
  points: number
  blockPaise: number
  /** 100 for everybody; the outlet's multiplier for a gold bill where gold is on. */
  multiplierX100: number
}

/** The rate a bill earns at: the gold multiplier for a gold bill at an outlet with gold on. */
export function earnRate(settings: OutletLoyaltySettings, gold: boolean): EarnRate | null {
  if (!settings.pointsEnabled) return null
  if (settings.earnPoints === null || settings.earnBlockPaise === null) return null
  return {
    points: settings.earnPoints,
    blockPaise: settings.earnBlockPaise,
    multiplierX100: gold && settings.goldEnabled ? settings.goldEarnMultiplierX100 : SAME_RATE_X100,
  }
}

/**
 * What a bill earns: in proportion, rounded down per bill [owner, 2026-09-28].
 * A ₹399 bill at 5 per ₹200 earns 9, not 5; at 1.5× a gold member earns 14.
 * Integers only: the multiplier is held in hundredths.
 */
export function pointsEarned(basisPaise: number, rate: EarnRate | null): number {
  if (rate === null || basisPaise <= 0) return 0
  return Math.floor((basisPaise * rate.points * rate.multiplierX100) / (rate.blockPaise * 100))
}

/**
 * The most points the counter offers on this order (design D7): the least of
 * the balance just read, the outlet's cap over the order after every other
 * discount (the gold cap for a customer the tablet knows is gold here, where
 * gold is on), and that same amount less ₹1, so points never buy the ₹1 floor
 * the rounding line would put back. Whole points; nought when nothing may be used.
 */
export function pointsUsableMax(input: {
  settings: OutletLoyaltySettings
  balance: number
  gold: boolean
  /** The order after every discount except points. */
  netPaise: number
}): number {
  const { settings, balance, gold, netPaise } = input
  if (!settings.pointsEnabled || balance <= 0 || netPaise <= POINT_VALUE_PAISE) return 0
  const capBp = gold && settings.goldEnabled ? settings.goldUseCapBp : settings.useCapBp
  if (capBp === null) return 0
  const byCap = Math.floor((netPaise * capBp) / 10_000 / POINT_VALUE_PAISE)
  const byFloor = Math.floor((netPaise - POINT_VALUE_PAISE) / POINT_VALUE_PAISE)
  return Math.max(0, Math.min(balance, byCap, byFloor))
}

/**
 * When a grant of gold ends: its own instant plus the outlet's duration, read
 * **at the grant** (design D2). A later change to the duration moves nothing
 * already granted. Calendar months; a day the month does not have falls back
 * to that month's last day, so 31 August plus six months is 28 February.
 */
export function goldEndsAt(grantedAt: string, months: number): string {
  const start = new Date(grantedAt)
  const target = new Date(start)
  const day = start.getUTCDate()
  target.setUTCDate(1)
  target.setUTCMonth(start.getUTCMonth() + months)
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate()
  target.setUTCDate(Math.min(day, lastDay))
  return target.toISOString()
}

/** Whether a spell of gold is in force at an instant: granted, not revoked, not yet ended. */
export function goldInForce(
  spell: { grantedAt: string; revokedAt: string | null; expiresAt: string },
  at: string,
): boolean {
  return (
    spell.grantedAt <= at &&
    (spell.revokedAt === null || spell.revokedAt > at) &&
    spell.expiresAt > at
  )
}

/**
 * Whether a customer may be upgraded to Gold at the counter (design D3): the outlet
 * has gold and lets billers grant it, they are not gold here now, and what they
 * paid here in the last `GOLD_WINDOW_DAYS` is **at least** the threshold
 * [owner, 2026-09-28].
 */
export function goldEligible(input: {
  settings: OutletLoyaltySettings
  isGold: boolean
  /** Paid at this outlet within the window: settled bills' totals, voids excluded. */
  spendInWindowPaise: number
}): boolean {
  const { settings } = input
  if (!settings.goldEnabled || !settings.goldCounterGrant || input.isGold) return false
  if (settings.goldThresholdPaise === null) return false
  return input.spendInWindowPaise >= settings.goldThresholdPaise
}

/** `1×`, `1.2×`, `1.5×`: a multiplier in hundredths, as the owner types it. */
export function multiplierLabel(x100: number): string {
  return `${Number((x100 / 100).toFixed(2))}×`
}

/** The words for a points row: `Points (20)`. */
export function pointsRowTitle(points: number): string {
  return `Points (${points})`
}

/** `1 point`, `20 points`. */
export function pointsLabel(points: number): string {
  return `${points} ${Math.abs(points) === 1 ? 'point' : 'points'}`
}
