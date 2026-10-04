import type { OutletServiceSettings } from '@/domain'

import type { Tables } from './database.types'

/** Service choices (#60) and customer collection (#59) from the outlet row. */
export type OutletServiceColumns = Pick<
  Tables<'outlets'>,
  | 'collect_customer_details'
  | 'dine_in_offered'
  | 'takeaway_offered'
  | 'table_numbers'
  | 'packaging_mode'
  | 'packaging_price_paise'
  | 'packaging_free_for_gold'
>

/**
 * How an outlet serves, read off its row.
 *
 * One mapping for the mock's fixtures and the live adapter alike, so the demo's
 * choices are the database's columns and not a second description of them.
 */
export function serviceSettingsFromRow(row: OutletServiceColumns): OutletServiceSettings {
  return {
    collectCustomerDetails: row.collect_customer_details ?? true,
    dineInOffered: row.dine_in_offered,
    takeawayOffered: row.takeaway_offered,
    tableNumbers: row.table_numbers,
    packagingMode: row.packaging_mode,
    packagingPricePaise: row.packaging_price_paise,
    packagingFreeForGold: row.packaging_free_for_gold,
  }
}
