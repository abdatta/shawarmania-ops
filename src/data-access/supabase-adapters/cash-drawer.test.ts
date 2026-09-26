import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'

import type { Database } from '../database.types'

import { createSupabaseCashDrawerAdapter } from './cash-drawer'

/**
 * The first page of counts is asked for the way the surface asks for it.
 *
 * `listObservations(outletId)` with no query at all is how the Drawer reads its
 * recent counts since the-ledger-reads-fast-and-keeps-its-place round four. The
 * real adapter's reader once took its query without a default, so that call
 * threw before any request went out and production said "Could not read the
 * recent counts" — while every surface test, run against the demo adapter,
 * passed. This pins the real adapter to the call the surface actually makes.
 */
function emptyClient() {
  const asked: string[] = []
  const query: Record<string, unknown> = {
    select: (columns: string) => {
      asked.push(columns)
      return query
    },
    eq: () => query,
    lt: () => query,
    order: () => query,
    limit: () => query,
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(resolve),
  }
  const client = { from: () => query } as unknown as SupabaseClient<Database>
  return { client, asked }
}

describe('the recent counts are read the way the surface reads them', () => {
  it('answers a first page asked for with no query at all', async () => {
    const { client, asked } = emptyClient()
    const adapter = createSupabaseCashDrawerAdapter(client)

    await expect(adapter.listObservations('outlet-1')).resolves.toEqual({
      observations: [],
      hasMore: false,
    })
    // One request, with everything a row needs embedded in it.
    expect(asked).toHaveLength(1)
    expect(asked[0]).toContain('drawer_cash_out(')
    expect(asked[0]).toContain('drawer_observation_adjustments(')
  })
})
