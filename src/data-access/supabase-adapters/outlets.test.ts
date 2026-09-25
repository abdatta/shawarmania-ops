import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'

import type { Database, Tables } from '../database.types'

import { createSupabaseOutletsAdapter } from './outlets'

/**
 * Outlet rows are remembered for the person signed in, answered at once and
 * refreshed behind (the-ledger-reads-fast-and-keeps-its-place, design D9).
 *
 * The case worth the file is the last: the adapter outlives a sign-out, so a
 * row remembered for one person must never answer the next.
 */

function outletRow(id: string, cutover: string): Tables<'outlets'> {
  return { id, name: `Outlet ${id}`, business_day_cutover: cutover } as Tables<'outlets'>
}

/**
 * A client whose `outlets` reads resolve only when the test says so, and whose
 * signed-in user the test can change.
 */
function fakeClient() {
  const state = {
    userId: 'person-1' as string | null,
    rows: new Map<string, Tables<'outlets'>>(),
    pending: [] as (() => void)[],
    reads: 0,
  }

  function outletsQuery() {
    let wanted: string | null = null
    const query: Record<string, unknown> = {
      select: () => query,
      order: () => query,
      eq: (column: string, value: unknown) => {
        if (column === 'id') wanted = value as string
        return query
      },
      maybeSingle: () => query,
      then: (resolve: (value: unknown) => unknown) => {
        state.reads += 1
        state.pending.push(() =>
          resolve({
            data: wanted ? (state.rows.get(wanted) ?? null) : [...state.rows.values()],
            error: null,
          }),
        )
      },
    }
    return query
  }

  const client = {
    from: () => outletsQuery(),
    auth: {
      getSession: async () => ({
        data: { session: state.userId ? { user: { id: state.userId } } : null },
      }),
    },
  } as unknown as SupabaseClient<Database>

  /** Let every read in flight answer. */
  async function answer() {
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
    const waiting = state.pending.splice(0)
    for (const settle of waiting) settle()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  return { client, state, answer }
}

describe('outlet rows are remembered for the person signed in', () => {
  it('asks the network the first time', async () => {
    const { client, state, answer } = fakeClient()
    state.rows.set('kal', outletRow('kal', '04:00:00'))
    const adapter = createSupabaseOutletsAdapter(client)

    const first = adapter.getOutlet('kal')
    await answer()
    expect((await first)?.business_day_cutover).toBe('04:00:00')
  })

  it('answers a second read at once, without waiting for the network', async () => {
    const { client, state, answer } = fakeClient()
    state.rows.set('kal', outletRow('kal', '04:00:00'))
    const adapter = createSupabaseOutletsAdapter(client)
    const first = adapter.getOutlet('kal')
    await answer()
    await first

    // Nothing is answered by the network this time, and the read still lands.
    const second = await adapter.getOutlet('kal')
    expect(second?.business_day_cutover).toBe('04:00:00')
    expect(state.pending).toHaveLength(1)
  })

  it('refreshes behind, so a cutover changed elsewhere reaches the read after next', async () => {
    const { client, state, answer } = fakeClient()
    state.rows.set('kal', outletRow('kal', '04:00:00'))
    const adapter = createSupabaseOutletsAdapter(client)
    const first = adapter.getOutlet('kal')
    await answer()
    await first

    state.rows.set('kal', outletRow('kal', '03:00:00'))
    expect((await adapter.getOutlet('kal'))?.business_day_cutover).toBe('04:00:00')
    await answer()
    expect((await adapter.getOutlet('kal'))?.business_day_cutover).toBe('03:00:00')
  })

  it('remembers what the outlet list read', async () => {
    const { client, state, answer } = fakeClient()
    state.rows.set('kal', outletRow('kal', '04:00:00'))
    const adapter = createSupabaseOutletsAdapter(client)
    const list = adapter.listOutlets()
    await answer()
    await list

    expect((await adapter.getOutlet('kal'))?.business_day_cutover).toBe('04:00:00')
  })

  it('never answers one person with what was remembered for another', async () => {
    const { client, state, answer } = fakeClient()
    state.rows.set('kal', outletRow('kal', '04:00:00'))
    const adapter = createSupabaseOutletsAdapter(client)
    const first = adapter.getOutlet('kal')
    await answer()
    await first

    // Signed out, and somebody else signed in on the same phone, who may not
    // see this outlet at all: the database now says there is no such row.
    state.userId = 'person-2'
    state.rows.delete('kal')
    let settled = false
    const theirs = adapter.getOutlet('kal').then((row) => {
      settled = true
      return row
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(settled).toBe(false)
    await answer()
    expect(await theirs).toBeNull()
  })
})
