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
        // A reader that said nothing about how it began is recorded as having
        // said nothing, not guessed at (#48). Same for its cadence: the app
        // falls back to its own constant rather than a number nobody reported.
        startedBy: null,
        readsPerDay: null,
        summary: {
          version: 1,
          // A statement is not a window of business days, so this reader has no
          // range to report and says so rather than leaving the key out.
          read: null,
          days: [],
          cycles_settled: [],
          supply_orders: { added: 0, amended: 0 },
          dates_without_a_recorded_day: [],
        },
      },
    })
  })

  it('takes a cadence the runner parsed, and drops one that cannot be right', () => {
    const record = (readsPerDay: unknown) =>
      parseHyperpureRunRecord(
        {
          outlet_id: 'outlet-delivery',
          started_at: '2026-08-25T06:00:00.000Z',
          outcome: 'ok',
          reads_per_day: readsPerDay,
        },
        permitted,
      )

    // The runner parses its own workflow cron, because it is the only thing that
    // knows: it runs under that schedule and the file is in its checkout.
    expect(record(4)).toMatchObject({ value: { readsPerDay: 4 } })

    /*
     * And a parse that went wrong is dropped rather than refused.
     *
     * Deliberately unlike `started_by`, where a third word means somebody
     * invented one and earns a 400. This is arithmetic on a cron, so a bad value
     * means the parser slipped — and failing the whole run over a caption would
     * trade a wrong number for no run record at all. The app then shows its own
     * constant, which is the same thing it does for a runner that said nothing.
     */
    for (const nonsense of [0, -4, 1441, 2.5, '4', null]) {
      expect(record(nonsense), String(nonsense)).toMatchObject({ value: { readsPerDay: null } })
    }
  })

  it('carries how the read began and what it moved, and invents neither', () => {
    expect(
      parseHyperpureRunRecord(
        {
          outlet_id: 'outlet-delivery',
          started_at: '2026-08-25T06:00:00.000Z',
          outcome: 'ok',
          started_by: 'owner',
          supply_orders: { added: 3, amended: 1 },
        },
        permitted,
      ),
    ).toMatchObject({
      value: {
        startedBy: 'owner',
        summary: { supply_orders: { added: 3, amended: 1 } },
      },
    })

    // An explicit null is "the runner did not say", exactly like an absent key.
    // A serialiser that writes nulls for undefined would otherwise turn every
    // run into a 400 and stop the sync recording itself at all.
    expect(
      parseHyperpureRunRecord(
        {
          outlet_id: 'outlet-delivery',
          started_at: '2026-08-25T06:00:00.000Z',
          outcome: 'ok',
          started_by: null,
        },
        permitted,
      ),
    ).toMatchObject({ value: { startedBy: null } })

    // A word the vocabulary does not have is refused here rather than sent on
    // to be refused by a check constraint the caller never sees.
    expect(
      parseHyperpureRunRecord(
        {
          outlet_id: 'outlet-delivery',
          started_at: '2026-08-25T06:00:00.000Z',
          outcome: 'ok',
          started_by: 'a cron job probably',
        },
        permitted,
      ),
    ).toEqual({ error: 'unknown_started_by' })

    // Nothing but the counts is taken from the body: a caller cannot post
    // movements the ledger never saw and have them rendered as history.
    expect(
      parseHyperpureRunRecord(
        {
          outlet_id: 'outlet-delivery',
          started_at: '2026-08-25T06:00:00.000Z',
          outcome: 'ok',
          days: [{ business_date: '2026-08-12', movement: 'revised' }],
          supply_orders: { added: -4, amended: 'many' },
        },
        permitted,
      ),
    ).toMatchObject({
      value: { summary: { days: [], supply_orders: { added: 0, amended: 0 } } },
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
