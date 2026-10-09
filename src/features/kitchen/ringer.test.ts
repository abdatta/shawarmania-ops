import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { KitchenAlertKind } from '@/data-access/adapters'

import { createRinger, type TunePlayer } from './ringer'

const TUNE_MS = 1000
const GAP_MS = 500

function fakePlayer() {
  const played: KitchenAlertKind[] = []
  let stops = 0
  const player: TunePlayer = {
    play(kind) {
      played.push(kind)
      return TUNE_MS
    },
    stop() {
      stops += 1
    },
  }
  return { player, played, stops: () => stops }
}

describe('the kitchen ringer', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const ring = (ms = TUNE_MS + GAP_MS) => vi.advanceTimersByTime(ms)

  it('rings a new order three times and then falls silent', () => {
    const { player, played } = fakePlayer()
    const ringer = createRinger(player, { gapMs: GAP_MS })
    ringer.raise('o1', 'new')
    ring()
    ring()
    ring()
    ring()
    expect(played).toEqual(['new', 'new', 'new'])
  })

  it('shares rings between orders that arrive together: three orders, three rings', () => {
    const { player, played } = fakePlayer()
    const ringer = createRinger(player, { gapMs: GAP_MS })
    ringer.raiseAll([
      { key: 'o1', kind: 'new' },
      { key: 'o2', kind: 'new' },
      { key: 'o3', kind: 'new' },
    ])
    for (let i = 0; i < 6; i++) ring()
    expect(played).toEqual(['new', 'new', 'new'])
  })

  it('plays one sound at a time and puts a cancellation first', () => {
    const { player, played } = fakePlayer()
    const ringer = createRinger(player, { gapMs: GAP_MS })
    ringer.raise('o1', 'new')
    ring() // first new ring done
    vi.advanceTimersByTime(TUNE_MS / 2) // mid second ring
    ringer.raise('o2', 'cancel')
    for (let i = 0; i < 8; i++) ring()
    expect(played).toEqual(['new', 'new', 'cancel', 'cancel', 'cancel', 'new'])
  })

  it('stops at once when the only alerting card is acknowledged mid-ring', () => {
    const { player, played, stops } = fakePlayer()
    const ringer = createRinger(player, { gapMs: GAP_MS })
    ringer.raise('o1', 'new')
    ring()
    vi.advanceTimersByTime(TUNE_MS / 2)
    ringer.settle('o1')
    expect(stops()).toBe(1)
    for (let i = 0; i < 4; i++) ring()
    expect(played).toEqual(['new', 'new'])
  })

  it('keeps ringing for the others when one of several is acknowledged', () => {
    const { player, played, stops } = fakePlayer()
    const ringer = createRinger(player, { gapMs: GAP_MS })
    ringer.raise('o1', 'new')
    ringer.raise('o2', 'edit')
    ringer.settle('o1')
    expect(stops()).toBe(0)
    for (let i = 0; i < 6; i++) ring()
    expect(played).toEqual(['new', 'edit', 'edit', 'edit'])
  })

  it('owes three rings again when a card changes while it is alerting', () => {
    const { player, played } = fakePlayer()
    const ringer = createRinger(player, { gapMs: GAP_MS })
    ringer.raise('o1', 'new')
    ring()
    ring()
    ringer.raise('o1', 'new')
    for (let i = 0; i < 6; i++) ring()
    // Three rings had started before the change; three more follow it.
    expect(played).toEqual(['new', 'new', 'new', 'new', 'new', 'new'])
  })

  it('stops ringing for an order that left the board', () => {
    const { player, played } = fakePlayer()
    const ringer = createRinger(player, { gapMs: GAP_MS })
    ringer.raise('o1', 'new')
    ringer.keepOnly(new Set())
    for (let i = 0; i < 4; i++) ring()
    expect(played).toEqual(['new'])
  })
  it('counts each alert down ring by ring, and announces every change', () => {
    const { player } = fakePlayer()
    const ringer = createRinger(player, { gapMs: GAP_MS })
    const heard = vi.fn()
    ringer.subscribe(heard)
    ringer.raise('o1', 'new')
    expect(ringer.snapshot()).toEqual({ o1: { left: 2, sounding: true } })
    ring()
    expect(ringer.snapshot()).toEqual({ o1: { left: 1, sounding: true } })
    ring()
    ring()
    // Spent: silent, though the card still waits for its ACK.
    expect(ringer.snapshot()).toEqual({})
    expect(heard).toHaveBeenCalled()

    ringer.raise('o2', 'edit')
    ringer.settle('o2')
    expect(ringer.snapshot()).toEqual({})
  })
})
