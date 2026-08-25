import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'

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

/*
 * Characterization pins taken before the sync generalizes from Zomato-only to
 * channel-aware behavior (swiggy-settlement-sync task 1.2). Everything below
 * describes how the Zomato adapter behaves today — the exact bodies owner
 * actions send, the event lines the surface renders, the health shape — so an
 * extraction into shared channel-configured code that quietly changes any of
 * it fails here rather than on the owner's phone.
 */

type TableAnswer = unknown[] | ((filters: string[]) => { data: unknown; error: null })

/**
 * A stub that answers each table by name, and the runs table by its own
 * question, and records every Edge Function invocation. Filters are captured
 * verbatim so a test can pin not only what was returned but what was asked.
 */
function clientForTables(
  tables: Record<string, TableAnswer>,
  invoke: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue({ data: null, error: null }),
) {
  const queries: Array<{ table: string; filters: string[] }> = []
  const client = {
    from(table: string) {
      const filters: string[] = []
      queries.push({ table, filters })
      const answer = (): { data: unknown; error: null } => {
        const spec = tables[table]
        if (Array.isArray(spec) || spec === undefined) return { data: spec ?? [], error: null }
        return spec(filters)
      }
      const builder: Record<string, unknown> = {
        select: () => builder,
        upsert: () => builder,
        eq: (column: string, value: unknown) => {
          filters.push(`${column}=${String(value)}`)
          return builder
        },
        in: (column: string, values: readonly unknown[]) => {
          filters.push(`${column} in ${values.join(',')}`)
          return builder
        },
        not: (column: string, operator: string, value: unknown) => {
          filters.push(`${column} ${operator} ${String(value)}`)
          return builder
        },
        is: (column: string, value: unknown) => {
          filters.push(`${column}=${String(value)}`)
          return builder
        },
        order: () => builder,
        limit: () => builder,
        maybeSingle: () => Promise.resolve(answer()),
        then: (resolve: (value: unknown) => void) => resolve(answer()),
      }
      return builder
    },
    rpc: vi.fn(() => {
      const builder: Record<string, unknown> = {
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        then: (resolve: (value: unknown) => void) => resolve({ data: [], error: null }),
      }
      return builder
    }),
    functions: { invoke },
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u-1' } } }) },
  }
  return {
    client: client as unknown as SupabaseClient<Database>,
    adapter: createSupabaseAggregatorSyncAdapter(client as unknown as SupabaseClient<Database>),
    queries,
    invoke,
  }
}

const RUNS_BY_QUESTION: TableAnswer = (filters) => {
  if (filters.includes('outcome in session_lapsed,shape_changed')) {
    return {
      data: [
        { id: 21, started_at: '2026-08-23T04:34:25.285Z', outcome: 'session_lapsed', detail: null },
      ],
      error: null,
    }
  }
  if (filters.includes('outcome=ok')) {
    return { data: { started_at: '2026-08-23T06:37:14.513Z' }, error: null }
  }
  return { data: null, error: null }
}

/** A reading history with nothing failed in it, for tests asserting on one other line. */
const NO_FAILURES: TableAnswer = (filters) =>
  filters.includes('outcome=ok')
    ? { data: { started_at: '2026-08-23T06:37:14.513Z' }, error: null }
    : { data: [], error: null }

describe('owner actions reach their functions with their exact present-day bodies', () => {
  it('asks a read through the zomato channel in sync mode', async () => {
    const { adapter, invoke } = clientForTables({})
    await adapter.requestRun('o-1')

    expect(invoke).toHaveBeenCalledWith('request-aggregator-sync', {
      body: { outlet_id: 'o-1', channel: 'zomato', mode: 'sync' },
    })
  })

  it('reconnect defaults to the zomato channel and reports still signed in when told', async () => {
    const { adapter, invoke } = clientForTables({})
    invoke.mockResolvedValue({ data: { outcome: 'still_signed_in' }, error: null })

    const result = await adapter.requestReconnect('o-1')

    expect(invoke).toHaveBeenCalledWith('request-aggregator-sync', {
      body: { outlet_id: 'o-1', channel: 'zomato', mode: 'reconnect' },
    })
    expect(result).toEqual({ outcome: 'still_signed_in' })
  })

  it('maps every reconnect answer that is not still_signed_in to dispatched', async () => {
    const { adapter, invoke } = clientForTables({})
    invoke.mockResolvedValue({ data: { outcome: 'dispatched' }, error: null })

    expect(await adapter.requestReconnect('o-1')).toEqual({ outcome: 'dispatched' })
  })

  it('re-check is an ordinary run, not a narrowed one', async () => {
    const { adapter, invoke } = clientForTables({})
    await adapter.recheckWeek('o-1', '2026-08-17', '2026-08-23')

    expect(invoke).toHaveBeenCalledWith('request-aggregator-sync', {
      body: { outlet_id: 'o-1', channel: 'zomato', mode: 'sync' },
    })
  })

  it('accepting a difference names its cycle bounds', async () => {
    const { adapter, invoke } = clientForTables({})
    await adapter.acceptDifference('o-1', '2026-08-17', '2026-08-23')

    expect(invoke).toHaveBeenCalledWith('request-aggregator-sync', {
      body: {
        outlet_id: 'o-1',
        channel: 'zomato',
        mode: 'accept',
        cycle_start: '2026-08-17',
        cycle_end: '2026-08-23',
      },
    })
  })

  it('hands the one-time password to the otp function once, for the zomato channel', async () => {
    const { adapter, invoke } = clientForTables({})
    await adapter.answerOneTimePassword('o-1', '123456')

    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith('answer-aggregator-otp', {
      body: { channel: 'zomato', code: '123456' },
    })
  })

  it('turns any function error into the same did-not-go-through refusal', async () => {
    const { adapter } = clientForTables(
      {},
      vi.fn().mockResolvedValue({ data: null, error: { message: 'nope' } }),
    )

    await expect(adapter.requestRun('o-1')).rejects.toThrow(
      'request-aggregator-sync did not go through',
    )
  })
})

describe('the event lines the surface renders', () => {
  it('carries a disputed week computed-minus-stated difference', async () => {
    const { adapter } = clientForTables({
      aggregator_sync_runs: NO_FAILURES,
      aggregator_cycle_reconciliations: [
        {
          id: 'c1',
          cycle_start: '2026-08-17',
          cycle_end: '2026-08-23',
          computed_paise: 100_000,
          stated_payout_paise: 99_500,
          outcome: 'disputed',
          accepted_at: null,
          updated_at: '2026-08-24T02:00:00.000Z',
        },
      ],
    })
    const [row] = await adapter.listEvents('o-1')

    expect(row!.event).toMatchObject({
      kind: 'week-disputed',
      from: '2026-08-17',
      to: '2026-08-23',
      computedPaise: 100_000,
      statedPayoutPaise: 99_500,
      differencePaise: 500,
    })
    expect(row!.resolvedAt).toBeNull()
  })

  it('resolves a disputed week at its acceptance moment', async () => {
    const { adapter } = clientForTables({
      aggregator_sync_runs: NO_FAILURES,
      aggregator_cycle_reconciliations: [
        {
          id: 'c1',
          cycle_start: '2026-08-17',
          cycle_end: '2026-08-23',
          computed_paise: 100_000,
          stated_payout_paise: 99_500,
          outcome: 'disputed',
          accepted_at: '2026-08-24T09:00:00.000Z',
          updated_at: '2026-08-24T02:00:00.000Z',
        },
      ],
    })
    const [row] = await adapter.listEvents('o-1')

    expect(row!.resolvedAt).toBe('2026-08-24T09:00:00.000Z')
  })

  it('states a settled week by its stated payout', async () => {
    const { adapter } = clientForTables({
      aggregator_sync_runs: NO_FAILURES,
      aggregator_cycle_reconciliations: [
        {
          id: 'c2',
          cycle_start: '2026-08-10',
          cycle_end: '2026-08-16',
          computed_paise: 250_100,
          stated_payout_paise: 250_000,
          outcome: 'reconciled',
          accepted_at: null,
          updated_at: '2026-08-18T02:00:00.000Z',
        },
      ],
    })
    const rows = await adapter.listEvents('o-1')

    expect(rows).toHaveLength(1)
    expect(rows[0]!.event).toMatchObject({
      kind: 'week-settled',
      from: '2026-08-10',
      to: '2026-08-16',
      netPaise: 250_000,
    })
    expect(rows[0]!.resolvedAt).toBeNull()
  })

  it('reads a revised day as its provisional net becoming its current net', async () => {
    const { adapter } = clientForTables({
      aggregator_sync_runs: NO_FAILURES,
      aggregator_channel_days: [
        {
          business_date: '2026-08-20',
          revenue_paise: 90_000,
          commission_paise: 20_000,
          provisional_revenue_paise: 95_000,
          provisional_commission_paise: 15_000,
          revised_at: '2026-08-21T10:00:00.000Z',
        },
      ],
    })
    const rows = await adapter.listEvents('o-1')

    expect(rows).toHaveLength(1)
    expect(rows[0]!.id).toBe('revised-2026-08-20')
    expect(rows[0]!.event).toMatchObject({
      kind: 'day-revised',
      businessDate: '2026-08-20',
      fromNetPaise: 80_000,
      toNetPaise: 70_000,
    })
  })

  it('pairs a typed expense with a sourced twin inside the tolerance window', async () => {
    const { adapter } = clientForTables({
      aggregator_sync_runs: NO_FAILURES,
      manual_ledger_expenses: (filters) =>
        filters.includes('source_system=null')
          ? {
              data: [
                {
                  id: 'e1',
                  business_date: '2026-08-20',
                  amount_paise: 50_000,
                  description: 'Ads',
                },
              ],
              error: null,
            }
          : {
              data: [
                {
                  id: 's1',
                  business_date: '2026-08-22',
                  amount_paise: 50_500,
                  description: 'Zomato Ads',
                  created_at: '2026-08-22T09:00:00.000Z',
                },
              ],
              error: null,
            },
    })
    const rows = await adapter.listEvents('o-1')

    expect(rows).toHaveLength(1)
    // ₹5 apart inside max(₹50, 2%) two days away: paired.
    expect(rows[0]!.id).toBe('duplicate-e1-s1')
    expect(rows[0]!.event).toMatchObject({
      kind: 'possible-duplicate-expense',
      typed: { expenseId: 'e1', amountPaise: 50_000 },
      synced: { expenseId: 's1', amountPaise: 50_500 },
    })
  })

  it('does not pair expenses outside the amount or date windows', async () => {
    const { adapter } = clientForTables({
      aggregator_sync_runs: NO_FAILURES,
      manual_ledger_expenses: (filters) =>
        filters.includes('source_system=null')
          ? {
              data: [
                {
                  id: 'e1',
                  business_date: '2026-08-20',
                  amount_paise: 50_000,
                  description: 'Ads',
                },
              ],
              error: null,
            }
          : {
              data: [
                {
                  id: 's-far',
                  business_date: '2026-08-26',
                  amount_paise: 57_000,
                  description: 'Zomato Ads',
                  created_at: '2026-08-26T09:00:00.000Z',
                },
              ],
              error: null,
            },
    })
    const rows = await adapter.listEvents('o-1')

    // ₹700 beyond the ₹50 floor with four days between them: neither window holds.
    expect(rows.some((row) => row.event.kind === 'possible-duplicate-expense')).toBe(false)
  })

  it('never re-raises a pair the owner dismissed', async () => {
    const { adapter } = clientForTables({
      aggregator_sync_runs: NO_FAILURES,
      manual_ledger_expenses: (filters) =>
        filters.includes('source_system=null')
          ? {
              data: [
                {
                  id: 'e1',
                  business_date: '2026-08-20',
                  amount_paise: 50_000,
                  description: 'Ads',
                },
              ],
              error: null,
            }
          : {
              data: [
                {
                  id: 's1',
                  business_date: '2026-08-22',
                  amount_paise: 50_100,
                  description: 'Zomato Ads',
                  created_at: '2026-08-22T09:00:00.000Z',
                },
              ],
              error: null,
            },
      aggregator_dismissed_duplicates: [{ expense_a: 'e1', expense_b: 's1' }],
    })
    const rows = await adapter.listEvents('o-1')

    expect(rows.some((row) => row.event.kind === 'possible-duplicate-expense')).toBe(false)
  })

  it('sorts the mixed sources newest first', async () => {
    const { adapter } = clientForTables({
      aggregator_sync_runs: RUNS_BY_QUESTION,
      aggregator_cycle_reconciliations: [
        {
          id: 'c1',
          cycle_start: '2026-08-10',
          cycle_end: '2026-08-16',
          computed_paise: 250_100,
          stated_payout_paise: 250_000,
          outcome: 'reconciled',
          accepted_at: null,
          updated_at: '2026-08-24T12:00:00.000Z',
        },
      ],
    })
    const rows = await adapter.listEvents('o-1')

    expect(rows[0]!.at).toBe('2026-08-24T12:00:00.000Z')
    expect(rows[rows.length - 1]!.at).toBe('2026-08-23T04:34:25.285Z')
  })
})

describe('what health says', () => {
  it('answers from the latest real run and never a rehearsal', async () => {
    const { adapter, queries } = clientForTables({
      aggregator_sync_runs: (filters) =>
        filters.includes('channel=zomato') && !filters.includes('rehearsal=false')
          ? { data: null, error: null }
          : {
              data: {
                started_at: '2026-08-23T06:37:14.513Z',
                finished_at: null,
                outcome: 'ok',
                rehearsal: false,
              },
              error: null,
            },
      outlet_channel_sync: () => ({ data: { synced_from: '2026-08-01' }, error: null }),
    })
    const health = await adapter.getHealth('o-1')

    expect(health.running).toBe(true)
    expect(health.lastOutcome).toBe('ok')
    expect(health.hasSession).toBe(false)
    expect(health.syncedFrom).toBe('2026-08-01')
    expect(queries).toContainEqual({
      table: 'aggregator_sync_runs',
      filters: expect.arrayContaining(['channel=zomato', 'rehearsal=false']),
    })
  })

  function clientWithCredential(credential: Record<string, unknown>) {
    const client = {
      from() {
        const builder: Record<string, unknown> = {
          select: () => builder,
          eq: () => builder,
          in: () => builder,
          not: () => builder,
          is: () => builder,
          order: () => builder,
          limit: () => builder,
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
          then: (resolve: (value: unknown) => void) => resolve({ data: [], error: null }),
        }
        return builder
      },
      rpc: vi.fn(() => ({
        maybeSingle: () => Promise.resolve({ data: credential, error: null }),
        then: (resolve: (value: unknown) => void) => resolve({ data: credential, error: null }),
      })),
      functions: { invoke: vi.fn() },
      auth: { getUser: vi.fn() },
    }
    return {
      client: client as unknown as SupabaseClient<Database>,
      adapter: createSupabaseAggregatorSyncAdapter(client as unknown as SupabaseClient<Database>),
    }
  }

  it('carries the open code window while a code is being waited for', async () => {
    const { adapter } = clientWithCredential({
      has_session: true,
      awaiting_code_since: '2026-08-23T06:00:00.000Z',
      awaiting_code_expires_at: '2026-08-23T06:05:00.000Z',
    })
    const health = await adapter.getHealth('o-1')

    expect(health.awaitingOneTimePassword).toEqual({
      requestedAt: '2026-08-23T06:00:00.000Z',
      expiresAt: '2026-08-23T06:05:00.000Z',
    })
  })

  it('waits on nothing when no code window is open', async () => {
    const { adapter } = clientWithCredential({ has_session: false, awaiting_code_since: null })
    const health = await adapter.getHealth('o-1')

    expect(health.awaitingOneTimePassword).toBeNull()
    expect(health.hasSession).toBe(false)
  })
})

describe('upload answers are described for the owner', () => {
  it('counts days of Zomato figures written', async () => {
    const { adapter, invoke } = clientForTables({})
    invoke.mockResolvedValue({
      data: { kind: 'zomato-settlement', results: [{ days_written: 3 }] },
      error: null,
    })

    const result = await adapter.uploadStatement({
      base64: '',
      filename: 'settlement.xlsx',
      confirmed: false,
    })

    expect(result.kind).toBe('zomato-settlement')
    expect(result.wrote).toEqual(['3 days of Zomato figures written'])
  })

  it('counts Hyperpure supply orders written', async () => {
    const { adapter, invoke } = clientForTables({})
    invoke.mockResolvedValue({
      data: { kind: 'hyperpure-statement', results: [{ orders_written: 2 }] },
      error: null,
    })

    const result = await adapter.uploadStatement({
      base64: '',
      filename: 'soa.xlsx',
      confirmed: false,
    })

    expect(result.wrote).toEqual(['2 Hyperpure supply orders written'])
  })

  it('says nothing was overwritten when a week refused to reconcile', async () => {
    const { adapter, invoke } = clientForTables({})
    invoke.mockResolvedValue({
      data: {
        kind: 'zomato-settlement',
        results: [{ outcome: 'reconciliation_failed' }],
      },
      error: null,
    })

    const result = await adapter.uploadStatement({
      base64: '',
      filename: 'settlement.xlsx',
      confirmed: false,
    })

    expect(result.wrote).toEqual([
      'A week did not add up to what Zomato paid — nothing was overwritten',
    ])
  })
})

describe('the Swiggy variant of the sync adapter', () => {
  it('asks a read through the swiggy channel', async () => {
    const { client, invoke } = clientForTables({})
    const { createSupabaseSwiggySyncAdapter } = await import('./aggregator-sync')
    await createSupabaseSwiggySyncAdapter(client).requestRun('o-1')
    expect(invoke).toHaveBeenCalledWith('request-aggregator-sync', {
      body: { outlet_id: 'o-1', channel: 'swiggy', mode: 'sync' },
    })
  })

  it('answers its one-time password against the swiggy mailbox only', async () => {
    const { client, invoke } = clientForTables({})
    const { createSupabaseSwiggySyncAdapter } = await import('./aggregator-sync')
    invoke.mockResolvedValue({ data: null, error: null })
    await createSupabaseSwiggySyncAdapter(client).answerOneTimePassword('o-1', '123456')
    expect(invoke).toHaveBeenCalledWith('answer-aggregator-otp', {
      body: expect.objectContaining({ channel: 'swiggy' }),
    })
  })

  it('reads runs scoped to the swiggy channel and never zomato', async () => {
    const { client, queries } = clientForTables({})
    const { createSupabaseSwiggySyncAdapter } = await import('./aggregator-sync')
    const health = await createSupabaseSwiggySyncAdapter(client).getHealth('o-1')
    void health
    const runQueries = queries.filter((q) => q.table === 'aggregator_sync_runs')
    expect(runQueries.length).toBeGreaterThan(0)
    for (const query of runQueries) {
      expect(query.filters).toContain('channel=swiggy')
      expect(query.filters).not.toContain('channel=zomato')
    }
  })
})
