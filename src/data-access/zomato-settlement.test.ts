import { describe, expect, it } from 'vitest'

import type { Tables } from './database.types'
import { toZomatoSettlement } from './zomato-settlement'

/**
 * The mapper is where a measured figure loses or keeps its provenance, and one
 * column went missing here for long enough to reach production: `as_of_at` was
 * fetched by the read, mapped by nothing, and therefore unshowable on any
 * screen. `aggregator-figures` requires a reading to name its as-of time, so
 * this is the assertion that keeps the requirement reachable.
 *
 * Deliberately at this layer rather than at a surface: a surface test that
 * hands the component a settlement it built itself proves the render and never
 * touches the mapping, which is exactly how the drop survived.
 */
function row(overrides: Partial<Tables<'aggregator_channel_days'>> = {}) {
  return {
    revenue_paise: 941_000,
    commission_paise: 200_000,
    settlement_state: 'provisional',
    origin: 'daily_reader',
    as_of_at: '2026-08-28T17:53:00.000Z',
    superseded_revenue_paise: null,
    superseded_commission_paise: null,
    superseded_at: null,
    provisional_revenue_paise: null,
    provisional_commission_paise: null,
    revised_at: null,
    ...overrides,
  } as unknown as Tables<'aggregator_channel_days'>
}

describe('toZomatoSettlement', () => {
  it('carries the moment the source was current', () => {
    expect(toZomatoSettlement(row())?.asOfAt).toBe('2026-08-28T17:53:00.000Z')
  })

  it('carries a null as-of rather than inventing one', () => {
    // Rows written before sources named their time. A fabricated stamp would be
    // the one wrong answer that looks like a reading.
    expect(toZomatoSettlement(row({ as_of_at: null }))?.asOfAt).toBeNull()
  })
})
