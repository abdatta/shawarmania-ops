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
    updated_at: '2026-08-29T11:16:59.070Z',
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

  /**
   * **The production shape, and the one this test exists for.**
   *
   * Every row in production carries a null `as_of_at` — the live runner does
   * not send it — while `updated_at` moves on every run that re-reads the day.
   * Mapping `as_of_at` alone shipped a stamp that showed on the demo, where the
   * mock seeds the column, and on nothing real. Asserted against the real row
   * shape rather than the fixture's, because the fixture is what hid it.
   */
  it('falls back to when the row was last written, which is all production has', () => {
    const settlement = toZomatoSettlement(
      row({ as_of_at: null, updated_at: '2026-08-29T11:16:59.070Z' }),
    )
    expect(settlement?.asOfAt).toBe('2026-08-29T11:16:59.070Z')
  })

  it('prefers the source’s own moment where one was recorded', () => {
    // `as_of_at` is how current the operator's data was; `updated_at` is when we
    // wrote it. The first is the better answer whenever the runner supplies it.
    const settlement = toZomatoSettlement(
      row({ as_of_at: '2026-08-28T17:53:00.000Z', updated_at: '2026-08-29T11:16:59.070Z' }),
    )
    expect(settlement?.asOfAt).toBe('2026-08-28T17:53:00.000Z')
  })
})
