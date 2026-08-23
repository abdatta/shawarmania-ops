import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'

import type { Database } from '../database.types'
import { createSupabaseAggregatorSyncAdapter } from './aggregator-sync'

/**
 * The real adapter against a stubbed client, testing the seam and nothing else:
 * which failures the page is told are over, and which still stand.
 *
 * The reason this file exists is a bug that shipped. The Needs-you list derived
 * its failure rows with `resolvedAt` hard-coded to null, so every failed run
 * ever kept asking the owner to reconnect long after a later successful run had
 * proved the problem over — measured live 2026-08-23, when production showed
 * "Reconnect Zomato" while both channels' latest runs read ok. The tab's badge
 * counted by newest-run-wins; the page did not, and the two disagreed on the
 * same screen.
 */

/** One failed run, and the success that came after it. */
const LAPSED = {
  id: 11,
  started_at: '2026-08-23T04:34:25.285Z',
  outcome: 'session_lapsed',
  detail: null,
}
/** A success that postdates the failure: the moment every older failure is over. */
const OK = { started_at: '2026-08-23T06:37:14.513Z' }

/**
 * A PostgREST builder that answers by what was asked. The runs table is asked
 * two different questions, told apart by their own filters rather than by call
 * order — the failures query carries the `in` filter, the recovery query the
 * `outcome=ok` one — so reordering the implementation's queries cannot silently
 * flip what the stub answers.
 */
function clientWith(failureRows: unknown[], recovered: unknown) {
  const queries: Array<{ table: string; filters: string[] }> = []
  const client = {
    from(table: string) {
      const filters: string[] = []
      queries.push({ table, filters })
      const answer = (): { data: unknown; error: null } => {
        if (filters.includes('outcome in session_lapsed,shape_changed')) {
          return { data: failureRows, error: null }
        }
        if (filters.includes('outcome=ok')) return { data: recovered, error: null }
        return { data: [], error: null }
      }
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          filters.push(`${column}=${String(value)}`)
          return builder
        },
        in: (column: string, values: readonly unknown[]) => {
          filters.push(`${column} in ${values.join(',')}`)
          return builder
        },
        not: () => builder,
        is: () => builder,
        order: () => builder,
        limit: () => builder,
        maybeSingle: () => Promise.resolve(answer()),
        then: (resolve: (value: unknown) => void) => resolve(answer()),
      }
      return builder
    },
  }
  return {
    adapter: createSupabaseAggregatorSyncAdapter(client as unknown as SupabaseClient<Database>),
    queries,
  }
}

describe('when a failure is over', () => {
  it('resolves a lapse the moment a later run succeeded', async () => {
    const { adapter } = clientWith([LAPSED], OK)
    const [row] = await adapter.listEvents('o-1')

    expect(row!.id).toBe('run-11')
    expect(row!.resolvedAt).toBe(OK.started_at)
  })

  it('ends every failure older than the success, of either kind', async () => {
    const { adapter } = clientWith(
      [
        LAPSED,
        { id: 12, started_at: '2026-08-23T05:56:30.170Z', outcome: 'shape_changed', detail: null },
      ],
      OK,
    )
    const rows = await adapter.listEvents('o-1')

    expect(rows).toHaveLength(2)
    expect(rows.every((row) => row.resolvedAt === OK.started_at)).toBe(true)
  })

  it('leaves a failure that is newer than every success standing', async () => {
    const { adapter } = clientWith([LAPSED], { started_at: '2026-08-23T03:00:00.000Z' })
    const [row] = await adapter.listEvents('o-1')

    expect(row!.resolvedAt).toBeNull()
  })

  it('leaves everything standing when reading has never succeeded', async () => {
    const { adapter } = clientWith([LAPSED], null)
    const [row] = await adapter.listEvents('o-1')

    expect(row!.resolvedAt).toBeNull()
  })

  it('asks the recovery question about real runs only, never a rehearsal', async () => {
    const { adapter, queries } = clientWith([LAPSED], OK)
    await adapter.listEvents('o-1')

    expect(queries).toContainEqual({
      table: 'aggregator_sync_runs',
      filters: expect.arrayContaining(['outcome=ok', 'rehearsal=false']),
    })
  })
})
