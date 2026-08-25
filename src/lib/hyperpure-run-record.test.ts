import { describe, expect, it } from 'vitest'

import { parseHyperpureRunRecord } from '../../supabase/functions/_shared/hyperpure-run-record'

describe('Hyperpure run-record boundary', () => {
  const permitted = ['outlet-delivery']

  it('admits one allowlisted supplier-health outcome without opening the payout contract', () => {
    expect(
      parseHyperpureRunRecord(
        {
          outlet_id: 'outlet-delivery',
          started_at: '2026-08-25T06:00:00.000Z',
          outcome: 'shape_changed',
          detail: 'statement parser could not read the outlet map',
        },
        permitted,
      ),
    ).toEqual({
      value: {
        outletId: 'outlet-delivery',
        startedAt: '2026-08-25T06:00:00.000Z',
        outcome: 'shape_changed',
        detail: 'statement parser could not read the outlet map',
      },
    })
  })

  it('refuses a foreign outlet, an invented outcome, and an invalid start time', () => {
    expect(
      parseHyperpureRunRecord(
        { outlet_id: 'another-outlet', started_at: '2026-08-25T06:00:00.000Z', outcome: 'ok' },
        permitted,
      ),
    ).toEqual({ error: 'outlet_not_permitted' })
    expect(
      parseHyperpureRunRecord(
        {
          outlet_id: 'outlet-delivery',
          started_at: '2026-08-25T06:00:00.000Z',
          outcome: 'reconciliation_failed',
        },
        permitted,
      ),
    ).toEqual({ error: 'unknown_outcome' })
    expect(
      parseHyperpureRunRecord(
        { outlet_id: 'outlet-delivery', started_at: 'not-a-date', outcome: 'ok' },
        permitted,
      ),
    ).toEqual({ error: 'started_at_required' })
  })
})
