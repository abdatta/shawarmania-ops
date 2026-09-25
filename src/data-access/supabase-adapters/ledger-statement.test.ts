import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'

import { LedgerReadAborted, LedgerStatementActionError } from '../adapters'
import type { Database } from '../database.types'

import { createSupabaseLedgerStatementAdapter } from './ledger-statement'

/**
 * A ledger reading completes or it throws — never part of one.
 *
 * Before `the-ledger-reads-fast-and-keeps-its-place`, only bills and expenses
 * were checked: a failed channel read rendered the day without its channels, a
 * failed count read turned *counted* into *carried*, and nothing said so. These
 * tests fail each read in turn, so a read added later without a check is caught
 * by the test that already exists rather than by an owner reading a nought.
 */

const OBSERVATION = {
  id: 'obs-1',
  outlet_id: 'outlet-1',
  counted_at: '2026-09-20T16:30:00+00:00',
  recorded_at: '2026-09-20T16:31:00+00:00',
  is_anchor: false,
  opening_paise: 0,
  expected_paise: 0,
  difference_paise: 0,
  counted_total_paise: 0,
  is_legacy_imprecise: false,
  is_approximate: false,
  tolerance_minutes: 15,
  recorded_by: 'person-1',
  corrected_by: null,
  recorded_on_site: true,
  away_reason: null,
  note: null,
  updated_at: '2026-09-20T16:31:00+00:00',
}

/** Enough rows that every read of both waves is made. */
function rowsFor(table: string): unknown {
  switch (table) {
    case 'bills':
      return [{ id: 'bill-1', discount_paise: 0 }]
    case 'drawer_observations':
      return [OBSERVATION]
    case 'effective_expenses':
      return [{ id: 'x-1', recorded_by: 'person-1', amount_paise: 100, category: 'Gas' }]
    case 'outlet_channel_restaurants':
      return [{ channel: 'zomato', state: 'enabled' }]
    case 'drawer_cash_out':
      return [{ id: 'c-1', recorded_by: 'person-1', kind: 'spend', amount_paise: 100 }]
    case 'rpc:ledger_month_inputs':
      return []
    case 'rpc:ledger_drawer_balance_at':
      return 0
    default:
      return []
  }
}

/**
 * A client whose every query resolves to canned rows, except the `failing`th,
 * which resolves to an error. Reads are numbered in the order they are made.
 */
function fakeClient(failing: number | null = null) {
  const made: string[] = []

  function builder(name: string) {
    const index = made.length
    made.push(name)
    const response =
      index === failing
        ? { data: null, error: { message: `read ${index} (${name}) failed` } }
        : { data: rowsFor(name), error: null }
    const chain: Record<string, unknown> = new Proxy(
      {},
      {
        get(_target, property) {
          if (property === 'then') {
            return (resolve: (value: unknown) => unknown) => resolve(response)
          }
          return () => chain
        },
      },
    )
    return chain
  }

  const client = {
    from: (table: string) => builder(table),
    rpc: (name: string) => builder(`rpc:${name}`),
  } as unknown as SupabaseClient<Database>

  return { client, made }
}

describe('a ledger day completes or throws', () => {
  const { client, made } = fakeClient()
  const reads = createSupabaseLedgerStatementAdapter(client)
    .getDay('outlet-1', '2026-09-20')
    .then(() => [...made])

  it('makes every read in two waves when nothing fails', async () => {
    // Eleven in the first wave, three in the second.
    expect(await reads).toHaveLength(14)
  })

  it.each(Array.from({ length: 14 }, (_, index) => index))(
    'rejects the whole day when read %i fails',
    async (failing) => {
      const { client: failingClient, made: failingMade } = fakeClient(failing)
      const day = createSupabaseLedgerStatementAdapter(failingClient).getDay(
        'outlet-1',
        '2026-09-20',
      )
      await expect(day, `read ${failing} (${failingMade[failing] ?? '?'})`).rejects.toBeInstanceOf(
        LedgerStatementActionError,
      )
    },
  )
})

describe('a ledger month completes or throws', () => {
  it('makes one server read and two others, then names the spends', async () => {
    const { client, made } = fakeClient()
    await createSupabaseLedgerStatementAdapter(client).getMonth('outlet-1', '2026-09')
    expect(made).toEqual([
      'rpc:ledger_month_inputs',
      'outlet_channel_restaurants',
      'drawer_cash_out',
      'profiles',
    ])
  })

  it.each([0, 1, 2, 3])('rejects the whole month when read %i fails', async (failing) => {
    const { client } = fakeClient(failing)
    await expect(
      createSupabaseLedgerStatementAdapter(client).getMonth('outlet-1', '2026-09'),
    ).rejects.toBeInstanceOf(LedgerStatementActionError)
  })
})

describe('an abandoned read is not a failure', () => {
  it('rejects a day as abandoned, not failed, even when its reads report errors', async () => {
    const controller = new AbortController()
    controller.abort()
    const { client } = fakeClient(0)
    await expect(
      createSupabaseLedgerStatementAdapter(client).getDay('outlet-1', '2026-09-20', {
        signal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(LedgerReadAborted)
  })

  it('rejects a month as abandoned too', async () => {
    const controller = new AbortController()
    controller.abort()
    const { client } = fakeClient(0)
    await expect(
      createSupabaseLedgerStatementAdapter(client).getMonth('outlet-1', '2026-09', {
        signal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(LedgerReadAborted)
  })
})
