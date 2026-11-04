import { describe, expect, it, vi } from 'vitest'

import {
  judgeRunnerStage,
  LOGIN_STAGES,
  recordLoginStage,
  stageAfterSignedIn,
} from '../../supabase/functions/_shared/login-stage'
import { SIGN_IN_STAGES } from '../domain/sign-in-progress'

/**
 * The door a runner narrates through (#46), and the words both sides share.
 *
 * What these protect: a runner may say only what the server cannot see for
 * itself, only while a sign-in is under way, and a stage write can never fail
 * the sign-in it rides on.
 */

const now = new Date('2026-11-03T10:00:00Z')
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString()

describe('judgeRunnerStage', () => {
  const live = { channel: 'zomato', current: 'starting', currentAt: minutesAgo(1), now }

  it('accepts the runner’s own words while a sign-in is under way', () => {
    for (const stage of ['opening_portal', 'signing_in', 'done', 'stopped']) {
      expect(judgeRunnerStage({ ...live, stage })).toEqual({ ok: true, stage })
    }
  })

  it('refuses a word outside the vocabulary, so nothing free-text is stored', () => {
    expect(judgeRunnerStage({ ...live, stage: 'nearly there' })).toEqual({
      ok: false,
      error: 'unknown_stage',
    })
    expect(judgeRunnerStage({ ...live, stage: 42 })).toEqual({ ok: false, error: 'unknown_stage' })
  })

  it('refuses the stages only the server may record', () => {
    for (const stage of ['starting', 'waiting_for_code', 'checking_code', 'bringing_hyperpure']) {
      expect(judgeRunnerStage({ ...live, stage })).toEqual({ ok: false, error: 'unknown_stage' })
    }
  })

  it('takes done from Zomato only — Swiggy’s comes from finish_login', () => {
    expect(judgeRunnerStage({ ...live, channel: 'swiggy', stage: 'done' })).toEqual({
      ok: false,
      error: 'unknown_stage',
    })
  })

  it('refuses a report when no sign-in is under way', () => {
    expect(
      judgeRunnerStage({ ...live, current: null, currentAt: null, stage: 'signing_in' }),
    ).toEqual({ ok: false, error: 'no_sign_in' })
    for (const ended of ['done', 'stopped']) {
      expect(judgeRunnerStage({ ...live, current: ended, stage: 'signing_in' })).toEqual({
        ok: false,
        error: 'no_sign_in',
      })
    }
  })

  it('refuses a late report that would wake a sign-in long over', () => {
    expect(judgeRunnerStage({ ...live, currentAt: minutesAgo(31), stage: 'signing_in' })).toEqual({
      ok: false,
      error: 'no_sign_in',
    })
    expect(judgeRunnerStage({ ...live, currentAt: minutesAgo(29), stage: 'signing_in' }).ok).toBe(
      true,
    )
  })
})

describe('stageAfterSignedIn', () => {
  it('leaves Zomato one stage short of done, for the Hyperpure hop', () => {
    expect(stageAfterSignedIn('zomato')).toBe('bringing_hyperpure')
    expect(stageAfterSignedIn('swiggy')).toBe('done')
  })
})

describe('recordLoginStage', () => {
  function writer(result: { error: { code?: string } | null } | Error) {
    const eq = vi.fn(() =>
      result instanceof Error ? Promise.reject(result) : Promise.resolve(result),
    )
    const update = vi.fn(() => ({ eq }))
    return { client: { from: vi.fn(() => ({ update })) }, update, eq }
  }

  it('writes the stage and its time on the channel’s row', async () => {
    const { client, update, eq } = writer({ error: null })
    await expect(recordLoginStage(client, 'swiggy', 'signing_in', now)).resolves.toBe(true)
    expect(update).toHaveBeenCalledWith({
      login_stage: 'signing_in',
      login_stage_at: now.toISOString(),
    })
    expect(eq).toHaveBeenCalledWith('channel', 'swiggy')
  })

  it('never throws, because a sign-in is worth more than its narration', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await expect(
      recordLoginStage(writer({ error: { code: '23514' } }).client, 'zomato', 'done'),
    ).resolves.toBe(false)
    await expect(
      recordLoginStage(writer(new Error('socket')).client, 'zomato', 'done'),
    ).resolves.toBe(false)
    quiet.mockRestore()
  })
})

describe('the vocabulary is one list on both sides', () => {
  it('the app names every stage the server can record, in the same order', () => {
    expect(SIGN_IN_STAGES).toEqual(LOGIN_STAGES)
  })
})
