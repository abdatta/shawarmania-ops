import { describe, expect, it } from 'vitest'

import {
  readSignIn,
  signInSteps,
  STAGE_CEILING_MS,
  stepState,
  type SignInRecord,
} from './sign-in-progress'

const now = new Date('2026-11-03T10:00:00Z').getTime()
const ago = (ms: number) => new Date(now - ms).toISOString()
const at = (stage: SignInRecord['stage'], msAgo: number): SignInRecord => ({
  stage,
  at: ago(msAgo),
})

describe('readSignIn', () => {
  it('shows nothing when no sign-in was ever recorded', () => {
    expect(readSignIn(null, now, null)).toEqual({ kind: 'none' })
  })

  it('shows a fresh stage live', () => {
    expect(readSignIn(at('signing_in', 10_000), now, null)).toEqual({
      kind: 'live',
      stage: 'signing_in',
    })
  })

  it('stops claiming a stage once it has stood past its ceiling', () => {
    for (const [stage, ceiling] of Object.entries(STAGE_CEILING_MS)) {
      const step = stage as keyof typeof STAGE_CEILING_MS
      expect(readSignIn(at(step, ceiling - 1_000), now, null).kind).toBe('live')
      expect(readSignIn(at(step, ceiling + 1_000), now, null)).toEqual({
        kind: 'quiet',
        stage: step,
      })
    }
  })

  it('gives the person typing a code longer than any machine step', () => {
    expect(STAGE_CEILING_MS.waiting_for_code).toBeGreaterThan(5 * 60_000)
    for (const [stage, ceiling] of Object.entries(STAGE_CEILING_MS)) {
      if (stage !== 'waiting_for_code')
        expect(ceiling).toBeLessThan(STAGE_CEILING_MS.waiting_for_code)
    }
  })

  it('says a stopped sign-in stopped', () => {
    expect(readSignIn(at('stopped', 60_000), now, null)).toEqual({ kind: 'stopped' })
  })

  it('shows a finished sign-in until a read overtakes it', () => {
    const done = at('done', 60_000)
    expect(readSignIn(done, now, ago(3 * 60 * 60_000))).toEqual({ kind: 'done', at: done.at })
    expect(readSignIn(done, now, null)).toEqual({ kind: 'done', at: done.at })
    expect(readSignIn(done, now, ago(30_000))).toEqual({ kind: 'none' })
  })

  it('lets a read that ran since speak for an ended or quiet sign-in', () => {
    const later = ago(10_000)
    expect(readSignIn(at('stopped', 60_000), now, later)).toEqual({ kind: 'none' })
    expect(readSignIn(at('opening_portal', 5 * 60_000), now, later)).toEqual({ kind: 'none' })
  })

  it('never lets a read running alongside hide a live sign-in', () => {
    expect(readSignIn(at('signing_in', 30_000), now, ago(5_000))).toEqual({
      kind: 'live',
      stage: 'signing_in',
    })
  })

  it('lets a sign-in become history after half an hour, whatever it said', () => {
    for (const stage of ['starting', 'waiting_for_code', 'stopped', 'done'] as const) {
      expect(readSignIn(at(stage, 31 * 60_000), now, null)).toEqual({ kind: 'none' })
    }
  })

  it('ignores a word it does not know rather than guessing', () => {
    expect(readSignIn({ stage: 'nearly' as never, at: ago(1_000) }, now, null)).toEqual({
      kind: 'none',
    })
  })
})

describe('signInSteps', () => {
  it('includes the Hyperpure step only for the channel that tows it', () => {
    expect(signInSteps(true)).toContain('bringing_hyperpure')
    expect(signInSteps(false)).not.toContain('bringing_hyperpure')
    expect(signInSteps(false)).toHaveLength(5)
  })
})

describe('stepState', () => {
  const steps = signInSteps(true)
  it('ticks only what is behind the current step', () => {
    expect(stepState(steps, 'starting', 'waiting_for_code')).toBe('past')
    expect(stepState(steps, 'waiting_for_code', 'waiting_for_code')).toBe('current')
    expect(stepState(steps, 'checking_code', 'waiting_for_code')).toBe('upcoming')
  })

  it('un-ticks checking when a refused code sends the sign-in back to waiting', () => {
    expect(stepState(steps, 'checking_code', 'checking_code')).toBe('current')
    expect(stepState(steps, 'checking_code', 'waiting_for_code')).toBe('upcoming')
  })
})
