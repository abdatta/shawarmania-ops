import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'

import type { Database } from '../database.types'
import { createSupabaseManualLedgerAdapter } from './manual-ledger'

/**
 * Pins taken before Swiggy generalization touches this adapter
 * (swiggy-settlement-sync task 1.2).
 *
 * Two facts are load-bearing for what follows. First, `upsertDay` sends the
 * typed Swiggy columns and **no Zomato column at all** — the Zomato freeze is
 * "there is nothing to write", and when Swiggy's fields are removed the same
 * must become true of them. Second, a date carrying measured figures but no
 * recorded day row still reads both channel figures through `getDayFigures` —
 * the stitch must not let the presence of one channel hide the other.
 */

const DAY_INPUT = {
  outletId: 'o-1',
  businessDate: '2026-08-20',
  openingCashPaise: 100_000,
  cashRevenuePaise: 5_000,
  upiRevenuePaise: 250_000,
  zomatoRevenuePaise: 999_999,
  cashAddedPaise: 0,
  cashAddedReason: null,
  cashRemovedPaise: 500_000,
  cashRemovedReason: 'Bank deposit',
  countedCashPaise: 850_000,
  zomatoCommissionPaise: 99_999,
  note: null,
}

function clientForLedger(figureRows: unknown[]) {
  const queries: Array<{ table: string; filters: string[] }> = []
  let upsertPayload: Record<string, unknown> | null = null
  const client = {
    from(table: string) {
      const filters: string[] = []
      queries.push({ table, filters })
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          filters.push(`${column}=${String(value)}`)
          return builder
        },
        gte: (column: string, value: unknown) => {
          filters.push(`${column}>=${String(value)}`)
          return builder
        },
        lt: (column: string, value: unknown) => {
          filters.push(`${column}<${String(value)}`)
          return builder
        },
        is: (column: string, value: unknown) => {
          filters.push(`${column}=${String(value)}`)
          return builder
        },
        order: () => builder,
        limit: () => builder,
        maybeSingle: () =>
          Promise.resolve(
            table === 'outlets'
              ? { data: { billing_live_from: null }, error: null }
              : { data: null, error: null },
          ),
        single: () =>
          Promise.resolve({
            data: { outlet_id: 'o-1', business_date: '2026-08-20', note: null },
            error: null,
          }),
        upsert: (payload: Record<string, unknown>) => {
          upsertPayload = payload
          return builder
        },
        then: (resolve: (value: unknown) => void) =>
          resolve({ data: table === 'aggregator_channel_days' ? figureRows : [], error: null }),
      }
      return builder
    },
    rpc: vi.fn(() => ({
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      then: (resolve: (value: unknown) => void) => resolve({ data: [], error: null }),
    })),
  }
  return {
    adapter: createSupabaseManualLedgerAdapter(client as unknown as SupabaseClient<Database>),
    queries,
    payload: () => upsertPayload,
  }
}

describe('the day write carries no channel figures at all', () => {
  it('sends neither channel’s money, measured or typed', async () => {
    const { adapter, payload } = clientForLedger([])
    await adapter.upsertDay(DAY_INPUT)

    const sent = payload()
    expect(sent).not.toBeNull()
    expect(Object.keys(sent!).filter((key) => /swiggy/.test(key))).toEqual([])
    expect(Object.keys(sent!).filter((key) => key.startsWith('zomato'))).toEqual([])
  })
})

describe('a measured day with no recorded day still reads its figures', () => {
  const FIGURES_ROW = {
    outlet_id: 'o-1',
    channel: 'zomato',
    business_date: '2026-08-20',
    revenue_paise: 400_000,
    commission_paise: 80_000,
    settlement_state: 'settled',
    origin: 'settlement',
    superseded_at: null,
    superseded_revenue_paise: null,
    superseded_commission_paise: null,
    revised_at: null,
    provisional_revenue_paise: null,
    provisional_commission_paise: null,
  }

  const SWIGGY_FIGURES_ROW = {
    ...FIGURES_ROW,
    channel: 'swiggy',
    revenue_paise: 178_900,
    commission_paise: null,
    settlement_state: 'provisional',
    origin: 'daily_reader',
  }

  it('maps both channel rows into the virtual-day settlement shape', async () => {
    const { adapter } = clientForLedger([FIGURES_ROW, SWIGGY_FIGURES_ROW])
    const figures = await adapter.getDayFigures('o-1', '2026-08-20')

    expect(figures?.zomato).toMatchObject({
      revenuePaise: 400_000,
      commissionPaise: 80_000,
      state: 'settled',
      origin: 'settlement',
    })
    expect(figures?.swiggy).toMatchObject({
      revenuePaise: 178_900,
      commissionPaise: null,
      state: 'provisional',
      origin: 'daily_reader',
    })
  })

  it('asks the figures table over the date window without naming a channel', async () => {
    // One query covers every channel and the stitch partitions the rows in
    // memory, so a Swiggy-only date joins a month exactly as a Zomato-only
    // one does — which is why no channel filter may appear here.
    const { adapter, queries } = clientForLedger([])
    await adapter.getDayFigures('o-1', '2026-08-20')

    expect(queries).toContainEqual({
      table: 'aggregator_channel_days',
      filters: expect.arrayContaining([
        'outlet_id=o-1',
        'business_date>=2026-08-20',
        'business_date<2026-08-21',
      ]),
    })
    for (const query of queries) {
      if (query.table !== 'aggregator_channel_days') continue
      expect(query.filters).not.toContain('channel=zomato')
      expect(query.filters).not.toContain('channel=swiggy')
    }
  })

  it('answers nothing when no figure covers the date', async () => {
    const { adapter } = clientForLedger([])
    expect(await adapter.getDayFigures('o-1', '2026-08-20')).toBeNull()
  })
})
