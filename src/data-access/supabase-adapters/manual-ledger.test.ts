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
 * recorded day row still reads those figures through `getDayFigures`, filtered
 * to one channel — the stitch a channel merge will extend.
 */

const DAY_INPUT = {
  outletId: 'o-1',
  businessDate: '2026-08-20',
  openingCashPaise: 100_000,
  cashRevenuePaise: 5_000,
  upiRevenuePaise: 250_000,
  zomatoRevenuePaise: 999_999,
  swiggyRevenuePaise: 123_400,
  cashAddedPaise: 0,
  cashAddedReason: null,
  cashRemovedPaise: 500_000,
  cashRemovedReason: 'Bank deposit',
  countedCashPaise: 850_000,
  zomatoCommissionPaise: 99_999,
  swiggyCommissionPaise: 12_340,
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

describe('the day write carries the typed Swiggy fields and no measured column', () => {
  it('sends swiggy money but never a zomato key', async () => {
    const { adapter, payload } = clientForLedger([])
    await adapter.upsertDay(DAY_INPUT)

    const sent = payload()
    expect(sent).not.toBeNull()
    expect(sent!['swiggy_revenue_paise']).toBe(123_400)
    expect(sent!['swiggy_commission_paise']).toBe(12_340)
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

  it('maps the figures row into the settlement shape', async () => {
    const { adapter } = clientForLedger([FIGURES_ROW])
    const settlement = await adapter.getDayFigures('o-1', '2026-08-20')

    expect(settlement).toMatchObject({
      revenuePaise: 400_000,
      commissionPaise: 80_000,
      state: 'settled',
      origin: 'settlement',
    })
  })

  it('asks the figures table for exactly one channel over the date window', async () => {
    const { adapter, queries } = clientForLedger([])
    await adapter.getDayFigures('o-1', '2026-08-20')

    expect(queries).toContainEqual({
      table: 'aggregator_channel_days',
      filters: expect.arrayContaining([
        'outlet_id=o-1',
        'channel=zomato',
        'business_date>=2026-08-20',
        'business_date<2026-08-21',
      ]),
    })
  })

  it('answers nothing when no figure covers the date', async () => {
    const { adapter } = clientForLedger([])
    expect(await adapter.getDayFigures('o-1', '2026-08-20')).toBeNull()
  })
})
