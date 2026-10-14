import { describe, expect, it, vi } from 'vitest'

import { BURST_S, createReadyRinger, HANDBELL, SWING_S, type HandbellPlayer } from './handbell'

/** A clock the test drives: timers fire only when `advance` passes them. */
function clock() {
  let now = 0
  let next = 0
  const timers = new Map<number, { at: number; run: () => void }>()
  return {
    setTimer: (run: () => void, ms: number) => {
      const handle = ++next
      timers.set(handle, { at: now + ms, run })
      return handle
    },
    clearTimer: (handle: unknown) => void timers.delete(handle as number),
    advance(ms: number) {
      const until = now + ms
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= until)
          .sort((a, b) => a[1].at - b[1].at)[0]
        if (!due) break
        timers.delete(due[0])
        now = due[1].at
        due[1].run()
      }
      now = until
    },
  }
}

function setup() {
  const time = clock()
  const player: HandbellPlayer & { plays: number } = {
    plays: 0,
    play: vi.fn(() => {
      player.plays += 1
      return BURST_S * 1000
    }),
    stop: vi.fn(),
  }
  const ringer = createReadyRinger(player, time)
  return { time, player, ringer }
}

const dish = (ready: number, prepared = 0) => ({ ready, prepared })

describe('the handbell', () => {
  it('rings the four-strike figure twice, done well inside the swing', () => {
    expect(HANDBELL.strikes).toHaveLength(4)
    expect(BURST_S).toBe(3)
    expect(SWING_S).toBeGreaterThanOrEqual(BURST_S * 2)
  })
})

describe('createReadyRinger', () => {
  it('rings nothing for what the first read finds', () => {
    const { player, ringer } = setup()
    ringer.absorb({ a: { l1: dish(1) } })
    expect(player.plays).toBe(0)
    expect(ringer.swinging().size).toBe(0)
  })

  it('rings once when the kitchen marks food Ready, and swings longer than it sounds', () => {
    const { time, player, ringer } = setup()
    ringer.absorb({ a: { l1: dish(0) } })
    ringer.absorb({ a: { l1: dish(1) } })
    expect(player.plays).toBe(1)
    expect([...ringer.swinging()]).toEqual(['a'])
    time.advance(BURST_S * 1000)
    expect(player.plays).toBe(1)
    expect([...ringer.swinging()]).toEqual(['a'])
    time.advance(SWING_S * 1000 - BURST_S * 1000)
    expect(ringer.swinging().size).toBe(0)
  })

  it('stops the sound and the swing when the Ready food is ticked', () => {
    const { player, ringer } = setup()
    ringer.absorb({ a: { l1: dish(0) } })
    ringer.absorb({ a: { l1: dish(1) } })
    const listener = vi.fn()
    ringer.subscribe(listener)
    ringer.absorb({ a: { l1: dish(1, 1) } })
    expect(player.stop).toHaveBeenCalled()
    expect(ringer.swinging().size).toBe(0)
    expect(listener).toHaveBeenCalled()
  })

  it('keeps ringing while another dish of the order is still Ready', () => {
    const { player, ringer } = setup()
    ringer.absorb({ a: { l1: dish(0), l2: dish(0) } })
    ringer.absorb({ a: { l1: dish(1), l2: dish(1) } })
    ringer.absorb({ a: { l1: dish(1, 1), l2: dish(1) } })
    expect(player.stop).not.toHaveBeenCalled()
    expect([...ringer.swinging()]).toEqual(['a'])
  })

  it('stops only the ticked order while another still swings', () => {
    const { player, ringer } = setup()
    ringer.absorb({ a: { l1: dish(0) }, b: { l1: dish(0) } })
    ringer.absorb({ a: { l1: dish(1) }, b: { l1: dish(1) } })
    ringer.absorb({ a: { l1: dish(1, 1) }, b: { l1: dish(1) } })
    expect(player.stop).not.toHaveBeenCalled()
    expect([...ringer.swinging()]).toEqual(['b'])
  })

  it('rings nothing when the biller unticks', () => {
    const { player, ringer } = setup()
    ringer.absorb({ a: { l1: dish(1, 1) } })
    ringer.absorb({ a: { l1: dish(1, 0) } })
    expect(player.plays).toBe(0)
    expect(ringer.swinging().size).toBe(0)
  })

  it('rings nothing for food the counter ticked before the kitchen pressed Done', () => {
    const { player, ringer } = setup()
    ringer.absorb({ a: { l1: dish(0, 1) } })
    ringer.absorb({ a: { l1: dish(1, 1) } })
    expect(player.plays).toBe(0)
  })

  it('rings nothing for an Undo, and stops the swing it leaves nothing for', () => {
    const { player, ringer } = setup()
    ringer.absorb({ a: { l1: dish(0) } })
    ringer.absorb({ a: { l1: dish(1) } })
    ringer.absorb({ a: { l1: dish(0) } })
    expect(player.plays).toBe(1)
    expect(ringer.swinging().size).toBe(0)
  })

  it('queues one more burst for a Ready arriving mid-burst, and swings its bell at once', () => {
    const { time, player, ringer } = setup()
    ringer.absorb({ a: { l1: dish(0) }, b: { l1: dish(0) }, c: { l1: dish(0) } })
    ringer.absorb({ a: { l1: dish(1) }, b: { l1: dish(0) }, c: { l1: dish(0) } })
    ringer.absorb({ a: { l1: dish(1) }, b: { l1: dish(1) }, c: { l1: dish(0) } })
    ringer.absorb({ a: { l1: dish(1) }, b: { l1: dish(1) }, c: { l1: dish(1) } })
    expect(player.plays).toBe(1)
    expect([...ringer.swinging()].sort()).toEqual(['a', 'b', 'c'])
    time.advance(BURST_S * 1000)
    expect(player.plays).toBe(2)
    time.advance(BURST_S * 1000)
    expect(player.plays).toBe(2)
  })

  it('drops a queued burst once its food is handed over', () => {
    const { time, player, ringer } = setup()
    ringer.absorb({ a: { l1: dish(0) }, b: { l1: dish(0) } })
    ringer.absorb({ a: { l1: dish(1) }, b: { l1: dish(0) } })
    ringer.absorb({ a: { l1: dish(1) }, b: { l1: dish(1) } })
    ringer.absorb({ a: { l1: dish(1) }, b: { l1: dish(1, 1) } })
    time.advance(BURST_S * 1000)
    expect(player.plays).toBe(1)
  })

  it('treats an order gone from the rail as handed over', () => {
    const { player, ringer } = setup()
    ringer.absorb({ a: { l1: dish(0) } })
    ringer.absorb({ a: { l1: dish(1) } })
    ringer.absorb({})
    expect(player.stop).toHaveBeenCalled()
    expect(ringer.swinging().size).toBe(0)
  })

  it('goes quiet when disposed', () => {
    const { time, player, ringer } = setup()
    ringer.absorb({ a: { l1: dish(0) } })
    ringer.absorb({ a: { l1: dish(1) } })
    ringer.dispose()
    expect(player.stop).toHaveBeenCalled()
    time.advance(SWING_S * 1000)
    ringer.absorb({ a: { l1: dish(2) } })
    expect(player.plays).toBe(1)
  })
})
