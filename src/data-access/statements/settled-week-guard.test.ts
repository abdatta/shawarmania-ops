import { describe, expect, it } from 'vitest'

import {
  contractRefusal,
  settledAlready,
} from '../../../supabase/functions/_shared/settled-week-guard'

// Design D5 and D7 of `zomato-upload-settles-like-the-sync`: an upload leaves a
// settled week alone, and a write-contract refusal reaches the uploader.

const week = { cycle_start: '2026-09-14', cycle_end: '2026-09-20', stated_payout_paise: 846710 }

describe('an uploaded week the ledger already holds', () => {
  it('is left alone when reconciled, and agrees within the gate’s rupee', () => {
    expect(
      settledAlready(
        { outcome: 'reconciled', stated_payout_paise: '846709', accepted_at: null },
        week,
      ),
    ).toEqual({
      already_settled: true,
      cycle_start: '2026-09-14',
      cycle_end: '2026-09-20',
      held_payout_paise: 846709,
      file_payout_paise: 846710,
      agrees: true,
    })
  })

  it('says so when the file disagrees with the payout held', () => {
    const answer = settledAlready(
      { outcome: 'reconciled', stated_payout_paise: 846709, accepted_at: null },
      { ...week, stated_payout_paise: 846709 + 101 },
    )
    expect(answer?.agrees).toBe(false)
  })

  it('treats an accepted difference as settled', () => {
    expect(
      settledAlready(
        { outcome: 'disputed', stated_payout_paise: 846709, accepted_at: '2026-09-25T10:00:00Z' },
        week,
      )?.already_settled,
    ).toBe(true)
  })

  it('lets the upload proceed for a dispute nobody accepted, or a week never seen', () => {
    expect(
      settledAlready({ outcome: 'disputed', stated_payout_paise: 944352, accepted_at: null }, week),
    ).toBeNull()
    expect(settledAlready(null, week)).toBeNull()
  })
})

describe('a write-contract refusal', () => {
  it('reaches the uploader when it is the contract speaking', () => {
    expect(
      contractRefusal({
        code: '22023',
        message: 'restaurant 21917311 is dormant for channel zomato',
      }),
    ).toBe('restaurant 21917311 is dormant for channel zomato')
    expect(
      contractRefusal({
        code: '42501',
        message: 'this credential may not write settlement for outlet x',
      }),
    ).toBe('this credential may not write settlement for outlet x')
  })

  it('stays opaque when it is anything else', () => {
    expect(contractRefusal({ code: '23505', message: 'duplicate key value' })).toBeNull()
    expect(contractRefusal(new Error('socket hang up'))).toBeNull()
    expect(contractRefusal(null)).toBeNull()
  })
})
