// @vitest-environment node
import { describe, expect, it } from 'vitest'

import {
  KEEPER_STEPS_MS,
  SETTLED_RUN_MS,
  afterExit,
  stopRequestText,
  readStopRequest,
} from './keep-running.ts'

const MIN = 60_000

describe('after the sender exits, the keeper', () => {
  it('starts it again soon when it had been running a while', () => {
    expect(
      afterExit({ code: 1, ranMs: 3 * 60 * MIN, stopAsked: false, quickExitsBefore: 4 }),
    ).toEqual({
      kind: 'restart',
      afterMs: KEEPER_STEPS_MS[0],
      quickExits: 0,
    })
  })

  it('starts it again after a clean exit nobody asked for, or a kill', () => {
    // A clean exit with no stop asked for is a window closed or a process
    // ended from outside: nobody chose it.
    expect(
      afterExit({ code: 0, ranMs: 2 * SETTLED_RUN_MS, stopAsked: false, quickExitsBefore: 0 }).kind,
    ).toBe('restart')
    expect(afterExit({ code: null, ranMs: 1000, stopAsked: false, quickExitsBefore: 0 }).kind).toBe(
      'restart',
    )
  })

  it('waits longer after each quick failure, up to five minutes, and no longer', () => {
    let quickExits = 0
    const waits: number[] = []
    for (let i = 0; i < 8; i += 1) {
      const verdict = afterExit({
        code: 1,
        ranMs: 2000,
        stopAsked: false,
        quickExitsBefore: quickExits,
      })
      if (verdict.kind !== 'restart') throw new Error('expected a restart')
      waits.push(verdict.afterMs)
      quickExits = verdict.quickExits
    }
    expect(waits).toEqual([5_000, 15_000, 60_000, 120_000, 300_000, 300_000, 300_000, 300_000])
    expect(Math.max(...KEEPER_STEPS_MS)).toBe(5 * MIN)
  })

  it('stays stopped when the owner asked, whatever the exit said', () => {
    for (const code of [0, 1, 2, null]) {
      expect(afterExit({ code, ranMs: 1000, stopAsked: true, quickExitsBefore: 0 })).toEqual({
        kind: 'stay_stopped',
        why: 'owner',
      })
    }
  })

  it('stays stopped after a halt: WhatsApp ended the session, and only a person may clear it', () => {
    expect(afterExit({ code: 2, ranMs: 5 * MIN, stopAsked: false, quickExitsBefore: 0 })).toEqual({
      kind: 'stay_stopped',
      why: 'halted',
    })
  })
})

describe('the owner’s stop request', () => {
  it('says who asked and when, and reads back the same', () => {
    const text = stopRequestText('the tray icon', new Date('2026-11-21T07:00:00Z'))
    expect(readStopRequest(text)).toEqual({ by: 'the tray icon', at: '2026-11-21T07:00:00.000Z' })
  })

  it('is a stop request even when its text is unreadable', () => {
    expect(readStopRequest('')).toEqual({ by: 'unknown', at: null })
    expect(readStopRequest('not json')).toEqual({ by: 'unknown', at: null })
  })
})
