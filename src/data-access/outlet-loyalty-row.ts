import type { OutletLoyaltySettings } from '@/domain'

import type { Tables } from './database.types'

/** The ten columns of an outlet row that hold its points and gold rules (#62, design D12). */
export type OutletLoyaltyColumns = Pick<
  Tables<'outlets'>,
  | 'points_enabled'
  | 'points_earn_per_block'
  | 'points_earn_block_paise'
  | 'points_use_cap_bp'
  | 'gold_enabled'
  | 'gold_earn_multiplier_x100'
  | 'points_gold_use_cap_bp'
  | 'gold_duration_months'
  | 'gold_counter_grant'
  | 'gold_threshold_paise'
>

/** The same ten, as a select list, so every read asks for exactly these. */
export const OUTLET_LOYALTY_COLUMNS =
  'points_enabled, points_earn_per_block, points_earn_block_paise, points_use_cap_bp, gold_enabled, gold_earn_multiplier_x100, points_gold_use_cap_bp, gold_duration_months, gold_counter_grant, gold_threshold_paise'

/**
 * An outlet's points and gold rules, read off its row.
 *
 * One mapping for the mock's fixtures and the live adapter alike, as
 * `serviceSettingsFromRow` is, so the demo's rules are the database's columns
 * and not a second description of them.
 */
export function loyaltySettingsFromRow(row: OutletLoyaltyColumns): OutletLoyaltySettings {
  return {
    pointsEnabled: row.points_enabled,
    earnPoints: row.points_earn_per_block,
    earnBlockPaise: row.points_earn_block_paise,
    useCapBp: row.points_use_cap_bp,
    goldEnabled: row.gold_enabled,
    goldEarnMultiplierX100: row.gold_earn_multiplier_x100,
    goldUseCapBp: row.points_gold_use_cap_bp,
    goldDurationMonths: row.gold_duration_months,
    goldCounterGrant: row.gold_counter_grant,
    goldThresholdPaise: row.gold_threshold_paise,
  }
}

/** The columns an outlet starts with: all off, which bills exactly as before points. */
export const ALL_OFF_LOYALTY_COLUMNS: Readonly<OutletLoyaltyColumns> = Object.freeze({
  points_enabled: false,
  points_earn_per_block: null,
  points_earn_block_paise: null,
  points_use_cap_bp: null,
  gold_enabled: false,
  gold_earn_multiplier_x100: 100,
  points_gold_use_cap_bp: null,
  gold_duration_months: 6,
  gold_counter_grant: false,
  gold_threshold_paise: null,
})
