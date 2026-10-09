import { describe, expect, it } from 'vitest'

import {
  diffKitchenLines,
  formatKitchenWait,
  kitchenCardState,
  kitchenWaitTone,
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
