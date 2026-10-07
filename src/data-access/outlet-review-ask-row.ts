import type { OutletReviewAsk } from '@/domain'

import type { Tables } from './database.types'

/** The three columns of an outlet row that hold its Google review ask. */
export type OutletReviewAskColumns = Pick<
  Tables<'outlets'>,
  'review_ask_enabled' | 'review_ask_url' | 'review_ask_percent'
>

/** The same three, as a select list, so every read asks for exactly these. */
export const OUTLET_REVIEW_ASK_COLUMNS = 'review_ask_enabled, review_ask_url, review_ask_percent'

/** An outlet's review ask, read off its row — one mapping for the mock and the live adapter. */
export function reviewAskFromRow(row: OutletReviewAskColumns): OutletReviewAsk {
  return {
    enabled: row.review_ask_enabled,
    url: row.review_ask_url,
    percent: row.review_ask_percent,
  }
}
