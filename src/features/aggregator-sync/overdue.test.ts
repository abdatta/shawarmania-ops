import { describe, expect, it } from 'vitest'

import type { AggregatorSyncHealth, HyperpureHealth } from '@/data-access/adapters'

import { channelHealthWord, hyperpureHealthWord } from './aggregator-sync-surface'
import { hasGoneQuiet, READS_PER_DAY_FALLBACK } from './when'

/**
 * A successful run does not stay true, and until 2026-09-01 this surface behaved
 * as though it did.
 *
 * `All quiet` was the word for every `ok`, however old. Swiggy's readers died at
 * 11:08 UTC on 2026-08-31 and the app called the channel healthy for the next
 * eighteen hours — correctly reporting the newest thing anybody had said about
 * it, which was the last success before the break. Every failure mode that posts
 * nothing at all lands there: a disabled workflow, a job that dies before it can
 * report, a cold Vault, a repository out of Actions minutes.
 */

const HOUR = 3_600_000
const NOW = Date.UTC(2026, 8, 1, 12, 0, 0)
const agesAgo = (hours: number) => new Date(NOW - hours * HOUR).toISOString()

const healthy = (over: Partial<AggregatorSyncHealth> = {}): AggregatorSyncHealth => ({
  outletId: 'outlet-1',
  lastRunAt: agesAgo(1),
  lastOutcome: 'ok',
  running: false,
  awaitingOneTimePassword: null,
  hasSession: true,
  syncedFrom: '2026-08-01',
  readsPerDay: 4,
  ...over,
})

const hyperpure = (over: Partial<HyperpureHealth> = {}): HyperpureHealth => ({
  lastRunAt: agesAgo(1),
  lastOutcome: 'ok',
  running: false,
  hasSession: true,
  sessionExpiresAt: null,
  readsPerDay: 4,
  ...over,
})

describe('when a channel has gone quiet', () => {
  it('measures against the cadence the runner reported, not a constant', () => {
    // Four reads a day is a six-hour interval, so the threshold is nine hours.
    expect(hasGoneQuiet(agesAgo(8), 4, NOW)).toBe(false)
    expect(hasGoneQuiet(agesAgo(10), 4, NOW)).toBe(true)

    // Twenty-four reads a day is one hour, so the same ten-hour-old run is very
    // late indeed. A constant threshold could not tell these two apart, and a
    // constant is what went stale for weeks before #48.
    expect(hasGoneQuiet(agesAgo(10), 24, NOW)).toBe(true)
    expect(hasGoneQuiet(agesAgo(1), 24, NOW)).toBe(false)
  })

  it('sits at one and a half intervals, either side of the boundary', () => {
    // Exactly on the boundary is not yet overdue: the comparison is strict, so a
    // run arriving precisely on its grace period is on time.
    expect(hasGoneQuiet(agesAgo(9), 4, NOW)).toBe(false)
    expect(hasGoneQuiet(agesAgo(9.01), 4, NOW)).toBe(true)
  })

  it('tolerates a late scheduler without crying wolf', () => {
    // GitHub's cron runs late, by ten or fifteen minutes per the sync
    // repository's own workflow comments and further under load. One whole
    // interval plus a quarter must still read as fine.
    expect(hasGoneQuiet(agesAgo(6.25), 4, NOW)).toBe(false)
  })

  it('falls back to the app constant when nothing has reported a cadence', () => {
    const threshold = (24 / READS_PER_DAY_FALLBACK) * 1.5
    expect(hasGoneQuiet(agesAgo(threshold - 0.5), null, NOW)).toBe(false)
    expect(hasGoneQuiet(agesAgo(threshold + 0.5), null, NOW)).toBe(true)
  })

  it('is not overdue when it has never run', () => {
    // `Never run` is a truer sentence about such a channel, and it is not a
    // fault. A channel with no run has no schedule to have missed.
    expect(hasGoneQuiet(null, 4, NOW)).toBe(false)
  })

  it('is not overdue on a timestamp it cannot read', () => {
    expect(hasGoneQuiet('not a date', 4, NOW)).toBe(false)
  })
})

describe('the word a channel health line shows', () => {
  it('is All quiet for a recent success', () => {
    expect(channelHealthWord(healthy(), NOW)).toEqual(['All quiet', false])
  })

  it('is Overdue, and a fault, for a stale success', () => {
    // The regression test for the outage. Before this change the word here was
    // `All quiet` and the colour was not the fault colour.
    expect(channelHealthWord(healthy({ lastRunAt: agesAgo(10) }), NOW)).toEqual(['Overdue', true])
  })

  it('lets a recorded failure outrank being overdue', () => {
    // A channel that is stuck is also, eventually, overdue. Saying it is overdue
    // would replace the sentence naming the actual fault with one that merely
    // notes its consequence.
    expect(
      channelHealthWord(healthy({ lastRunAt: agesAgo(48), lastOutcome: 'shape_changed' }), NOW),
    ).toEqual(['Stuck', true])
  })

  it('lets a run under way outrank being overdue', () => {
    // The read that will clear it is happening. Calling that overdue would be
    // out of date at the moment it rendered.
    expect(channelHealthWord(healthy({ lastRunAt: agesAgo(48), running: true }), NOW)).toEqual([
      'Reading',
      false,
    ])
  })

  it('never calls a channel overdue when it has never run', () => {
    expect(channelHealthWord(healthy({ lastRunAt: null, lastOutcome: null }), NOW)).toEqual([
      'Never run',
      false,
    ])
  })

  it('never calls a channel overdue where it is not switched on', () => {
    // No schedule applies to an outlet the channel does not read, so there is
    // nothing for it to be late against.
    expect(channelHealthWord(healthy({ lastRunAt: agesAgo(200), syncedFrom: null }), NOW)).toEqual([
      'All quiet',
      false,
    ])
  })
})

describe('the word Hyperpure shows', () => {
  it('is All quiet for a recent success', () => {
    expect(hyperpureHealthWord(hyperpure(), NOW)).toEqual(['All quiet', false])
  })

  it('is Overdue for a stale success, because it files its own runs', () => {
    // Hyperpure rides Zomato's login but records its own runs, so it can fall
    // silent on its own and cannot inherit Zomato's verdict.
    expect(hyperpureHealthWord(hyperpure({ lastRunAt: agesAgo(10) }), NOW)).toEqual([
      'Overdue',
      true,
    ])
  })

  it('lets a lapsed session outrank being overdue', () => {
    // The one state on this line the owner can fix themselves keeps the word.
    expect(
      hyperpureHealthWord(hyperpure({ lastRunAt: agesAgo(48), hasSession: false }), NOW),
    ).toEqual(['Session ended', true])
  })

  it('lets a changed shape outrank being overdue', () => {
    expect(
      hyperpureHealthWord(hyperpure({ lastRunAt: agesAgo(48), lastOutcome: 'shape_changed' }), NOW),
    ).toEqual(['Stuck', true])
  })
})
