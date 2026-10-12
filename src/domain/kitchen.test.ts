import { describe, expect, it } from 'vitest'

import {
  diffKitchenLines,
  formatKitchenWait,
  kitchenBell,
  kitchenCardState,
  kitchenAlertShouldRing,
  kitchenWaitTone,
  sameLines,
  type KitchenCardFacts,
  type KitchenLineFacts,
} from './kitchen'

const shawarma = (quantity: number): KitchenLineFacts => ({
  menuItemId: 'shawarma',
  itemName: 'Classic Chicken Shawarma',
  quantity,
})
const fries = (quantity: number): KitchenLineFacts => ({
  menuItemId: 'fries',
  itemName: 'Fries',
  quantity,
})

describe('kitchenAlertShouldRing', () => {
  const previous = '2026-10-10T10:00:00Z'
  const filter = '2026-10-10T10:00:01Z'
  it.each([
    [null, null, filter, false, 'first read'],
    [previous, null, previous, true, 'no filter save ever'],
    [previous, previous, previous, true, 'filter time equals previous read'],
    [previous, filter, previous, false, 'old food newly shown'],
    [previous, filter, filter, false, 'order time equals filter time'],
    [previous, filter, '2026-10-10T10:00:02Z', true, 'counter write after filter'],
    [filter, previous, previous, true, 'category move without filter save'],
    [null, filter, filter, false, 'first read with saved filter'],
    [
      previous,
      '2026-10-10T10:00:00.000001Z',
      previous,
      false,
      'filter save one microsecond after read',
    ],
    [previous, filter, '2026-10-10T10:00:01.000001Z', true, 'write one microsecond after save'],
  ])('%s / %s / %s: %s (%s)', (readAt, changedAt, version, expected, _description) => {
    expect(kitchenAlertShouldRing(readAt, changedAt, version)).toBe(expected)
  })
})

function card(overrides: Partial<KitchenCardFacts>): KitchenCardFacts {
  return {
    status: 'open',
    lines: [shawarma(2)],
    acknowledged: false,
    latestAck: null,
    ...overrides,
  }
}

describe('kitchenCardState', () => {
  it('is new until this tablet acknowledges it', () => {
    expect(kitchenCardState(card({}))).toBe('new')
  })

  it('stays new when edited before the first acknowledgement', () => {
    expect(kitchenCardState(card({ lines: [shawarma(3), fries(1)] }))).toBe('new')
  })

  it('is quiet once acknowledged with the lines it still has', () => {
    expect(
      kitchenCardState(
        card({ acknowledged: true, latestAck: { kind: 'new', lines: [shawarma(2)] } }),
      ),
    ).toBe('quiet')
  })

  it('is edited when its lines here moved since the acknowledgement', () => {
    expect(
      kitchenCardState(
        card({
          lines: [shawarma(2), fries(1)],
          acknowledged: true,
          latestAck: { kind: 'new', lines: [shawarma(2)] },
        }),
      ),
    ).toBe('edited')
  })

  it('stays quiet when an edit touched only another kitchen', () => {
    // The board returns only this kitchen's lines, so an edit elsewhere leaves
    // them equal to what was acknowledged.
    expect(
      kitchenCardState(
        card({ acknowledged: true, latestAck: { kind: 'edit', lines: [shawarma(2)] } }),
      ),
    ).toBe('quiet')
  })

  it('reads as cancelled when it lost every line here after being acknowledged', () => {
    expect(
      kitchenCardState(
        card({ lines: [], acknowledged: true, latestAck: { kind: 'new', lines: [shawarma(2)] } }),
      ),
    ).toBe('cancelled')
  })

  it('is cancelled when the counter cancelled it', () => {
    expect(kitchenCardState(card({ status: 'cancelled', acknowledged: true }))).toBe('cancelled')
  })

  it('compares quantities by dish, not by line', () => {
    expect(
      kitchenCardState(
        card({
          lines: [shawarma(1), shawarma(1)],
          acknowledged: true,
          latestAck: { kind: 'new', lines: [shawarma(2)] },
        }),
      ),
    ).toBe('quiet')
  })
})

describe('diffKitchenLines', () => {
  it('marks added, struck and changed lines since the acknowledgement', () => {
    const rows = diffKitchenLines(
      [shawarma(3), fries(1)],
      [shawarma(2), { ...fries(0), menuItemId: 'lassi', itemName: 'Lassi', quantity: 1 }],
    )
    expect(rows).toEqual([
      {
        key: 'shawarma',
        itemName: 'Classic Chicken Shawarma',
        quantity: 3,
        previousQuantity: 2,
        change: 'changed',
      },
      { key: 'fries', itemName: 'Fries', quantity: 1, previousQuantity: null, change: 'added' },
      { key: 'lassi', itemName: 'Lassi', quantity: 0, previousQuantity: 1, change: 'removed' },
    ])
  })

  it('leaves an untouched line as the same', () => {
    expect(diffKitchenLines([shawarma(2)], [shawarma(2)])[0]?.change).toBe('same')
  })
})

describe('waiting time', () => {
  const orderedAt = '2026-10-08T08:00:00.000Z'
  const at = (minutes: number) => new Date(Date.parse(orderedAt) + minutes * 60_000)

  it('turns warning at ten minutes and danger at twenty', () => {
    expect(kitchenWaitTone(orderedAt, at(9))).toBe('normal')
    expect(kitchenWaitTone(orderedAt, at(10))).toBe('warning')
    expect(kitchenWaitTone(orderedAt, at(20))).toBe('danger')
  })

  it('reads in minutes, then hours, then days for an order left overnight', () => {
    expect(formatKitchenWait(orderedAt, at(0))).toBe('0 m')
    expect(formatKitchenWait(orderedAt, at(14))).toBe('14 m')
    expect(formatKitchenWait(orderedAt, at(130))).toBe('2 h')
    expect(formatKitchenWait(orderedAt, at(2 * 24 * 60 + 5))).toBe('2 d')
  })
})

describe('sameLines, the pairs the database pins too (#72)', () => {
  // supabase/tests/84_the_counter_sees_the_kitchen.sql asserts the same pairs
  // against kitchen_same_lines(), so the counter's answer and the kitchen's
  // card cannot disagree about what "the same dishes" means.
  const line = (menuItemId: string | null, itemName: string, quantity: number) => ({
    menuItemId,
    itemName,
    quantity,
  })
  it('agrees with kitchen_same_lines on every pinned pair', () => {
    expect(sameLines([line('a', 'A', 2)], [line('a', 'A', 1), line('a', 'A', 1)])).toBe(true)
    expect(sameLines([line('a', 'A', 2)], [line('a', 'A', 3)])).toBe(false)
    expect(sameLines([line('a', 'A', 1)], [line('a', 'A', 1), line('b', 'B', 1)])).toBe(false)
    expect(sameLines([line(null, 'Off menu', 1)], [line(null, 'Off menu', 1)])).toBe(true)
    expect(sameLines([], [])).toBe(true)
  })
})

describe("kitchenBell, the counter card's bell (#72)", () => {
  const one = [{ label: 'Kitchen 1' }]
  const two = [{ label: 'Kitchen 1' }, { label: 'Kitchen 2' }]

  it('is absent when no kitchen on shift carries the order', () => {
    expect(kitchenBell([], [])).toBeNull()
    expect(kitchenBell([null, null], two)).toBeNull()
  })

  it('rings for one kitchen still to press ACK, with its one dot', () => {
    expect(kitchenBell(['waiting'], one)).toEqual({
      ringing: true,
      dots: ['waiting'],
      label: 'Kitchen 1 has not pressed ACK yet',
    })
  })

  it('is still once that kitchen has pressed ACK', () => {
    expect(kitchenBell(['seen'], one)).toMatchObject({ ringing: false, dots: null })
  })

  it('shows a dot per kitchen, in kitchen order, while any of them waits', () => {
    const bell = kitchenBell(['seen', 'waiting'], two)
    expect(bell).toMatchObject({ ringing: true, dots: ['seen', 'waiting'] })
    expect(bell?.label).toBe('Kitchen 1 has pressed ACK. Kitchen 2 has not pressed ACK yet')
  })

  it('keeps an empty place for a kitchen on shift that does not carry the order', () => {
    const three = [...two, { label: 'Kitchen 3' }]
    expect(kitchenBell(['waiting', null, 'seen'], three)?.dots).toEqual(['waiting', null, 'seen'])
  })

  it("keeps every kitchen's place when only one of them carries the order", () => {
    expect(kitchenBell([null, 'waiting'], two)).toMatchObject({
      ringing: true,
      dots: [null, 'waiting'],
    })
  })

  it('hides the dots once every kitchen has pressed ACK', () => {
    expect(kitchenBell(['seen', 'seen'], two)).toMatchObject({ ringing: false, dots: null })
  })
})
