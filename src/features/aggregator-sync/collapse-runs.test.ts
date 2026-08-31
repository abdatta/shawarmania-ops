import { describe, expect, it } from 'vitest'

import type { AggregatorRunSummary, AggregatorSyncRunRow } from '@/data-access/adapters'

import { collapseRuns } from './collapse-runs'

/**
 * The collapse rule, on its own.
 *
 * A pure function over the accumulated list, so the cases that matter are cheap
 * to state: the quiet majority becoming one line, and every place the
 * collapsing has to stop because merging would claim a continuity that did not
 * happen.
 */

const EMPTY: AggregatorRunSummary = {
  read: { from: '2026-08-20', to: '2026-08-26', days: 7 },
  days: [],
  cyclesSettled: [],
  supplyOrders: { added: 0, amended: 0 },
  datesWithoutARecordedDay: [],
}

const MOVED: AggregatorRunSummary = {
  ...EMPTY,
  days: [
    {
      businessDate: '2026-08-12',
      movement: 'revised',
      from: { revenuePaise: 941_000, commissionPaise: null, netPaise: null },
      to: { revenuePaise: 928_650, commissionPaise: null, netPaise: null },
    },
  ],
}

/** A run at a given hour on 26 Aug, Kolkata time, with sensible defaults. */
function run(hour: number, over: Partial<AggregatorSyncRunRow> = {}): AggregatorSyncRunRow {
  const at = `2026-08-26T${String(hour).padStart(2, '0')}:00:00+05:30`
  return {
    id: `run-${hour}-${over.outcome ?? 'ok'}-${over.startedBy ?? 'schedule'}`,
    outletId: 'outlet-1',
    channel: 'zomato',
    startedAt: at,
    finishedAt: at,
    outcome: 'ok',
    detail: null,
    startedBy: 'schedule',
    summary: EMPTY,
    readsPerDay: 4,
    ...over,
  }
}

describe('collapsing consecutive runs that tell the same story', () => {
  it('turns a quiet week into one line carrying its count', () => {
    const runs = [6, 5, 4, 3, 2, 1].map((hour) => run(hour))
    const groups = collapseRuns(runs)

    expect(groups).toHaveLength(1)
    expect(groups[0]?.runs).toHaveLength(6)
    // The lead is the newest, because that is the run the line speaks for and
    // the one a reader is orienting from.
    expect(groups[0]?.lead.startedAt).toBe(runs[0]?.startedAt)
  })

  it('collapses a failure storm, which is the case nobody asked for and needs most', () => {
    const storm = [9, 8, 7, 6, 5, 4, 3, 2, 1].map((hour) =>
      run(hour, { outcome: 'session_lapsed', detail: 'Zomato signed this account out.' }),
    )
    const groups = collapseRuns(storm)

    expect(groups).toHaveLength(1)
    expect(groups[0]?.runs).toHaveLength(9)
  })

  it('never merges a quiet run either side of a failure', () => {
    const groups = collapseRuns([
      run(3),
      run(2, { outcome: 'session_lapsed', detail: 'signed out' }),
      run(1),
    ])

    // Three lines, none of them merged. A collapsed line spanning the failure
    // would claim a continuity that did not happen.
    expect(groups).toHaveLength(3)
  })

  it('gives a run that moved a figure its own line — it is why the list exists', () => {
    const groups = collapseRuns([run(3), run(2, { summary: MOVED }), run(1)])

    expect(groups).toHaveLength(3)
    expect(groups[1]?.runs).toHaveLength(1)
  })

  it('gives four reads the owner asked for four lines, however identical', () => {
    const groups = collapseRuns([4, 3, 2, 1].map((hour) => run(hour, { startedBy: 'owner' })))

    // The owner tapped Read now four times and will look for each by its time.
    expect(groups).toHaveLength(4)
  })

  it('does not collapse across a channel', () => {
    const groups = collapseRuns([run(2), run(1, { channel: 'swiggy' })])
    expect(groups).toHaveLength(2)
  })

  it('does not collapse across a day, in the outlet’s own timezone', () => {
    // 00:30 and 23:30 Kolkata are different days there and the same UTC day.
    // The rail the reader sees is Kolkata's, so the break has to be too.
    const groups = collapseRuns([
      run(0, { startedAt: '2026-08-26T00:30:00+05:30', finishedAt: '2026-08-26T00:31:00+05:30' }),
      run(0, { startedAt: '2026-08-25T23:30:00+05:30', finishedAt: '2026-08-25T23:31:00+05:30' }),
    ])

    expect(groups).toHaveLength(2)
    expect(groups[0]?.day).toBe('2026-08-26')
    expect(groups[1]?.day).toBe('2026-08-25')
  })

  it('leaves a run still under way on its own', () => {
    const groups = collapseRuns([run(3, { finishedAt: null }), run(2), run(1)])

    expect(groups[0]?.runs).toHaveLength(1)
    expect(groups[1]?.runs).toHaveLength(2)
  })

  it('separates a coarse pre-summary run from a quiet one that recorded nothing', () => {
    // They are different sentences: one changed nothing, the other cannot say.
    const groups = collapseRuns([run(2), run(1, { summary: null })])
    expect(groups).toHaveLength(2)
  })

  it('merges a group across a page boundary once the second page arrives', () => {
    // The case the rule exists to survive, and the reason grouping happens over
    // the accumulated list rather than inside the query: the first page cannot
    // know that the run just past its edge belongs to the group it just closed.
    const all = [7, 6, 5, 4, 3, 2, 1].map((hour) => run(hour))
    const firstPage = all.slice(0, 3)
    const secondPage = all.slice(3)

    expect(collapseRuns(firstPage)).toHaveLength(1)
    expect(collapseRuns(firstPage)[0]?.runs).toHaveLength(3)

    const merged = collapseRuns([...firstPage, ...secondPage])
    expect(merged).toHaveLength(1)
    expect(merged[0]?.runs).toHaveLength(7)
  })
})
