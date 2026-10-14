import { describe, expect, it } from 'vitest'
import type { DishLineFacts } from './dish-workflow'
import type { DishKitchenLineFacts } from './dish-workflow'
import {
  addDish,
  dishRounds,
  dishRows,
  dishAge,
  diffDishKitchenLines,
  dishKitchenCardState,
  dishLineKey,
  dishLocked,
  dishOwed,
  dishWaitTone,
  DISH_WAIT_CRITICAL_MINUTES,
  noteDish,
  rankedNotes,
  sameDishLines,
  NOTE_SEEDS,
} from './dish-workflow'
import { kitchenCardState, kitchenWaitTone, diffKitchenLines, sameLines } from './kitchen'
import { lineKey } from './service'

const dish = (changes: Partial<DishLineFacts> = {}): DishLineFacts => ({
  workflowLineId: 'old',
  menuItemId: 'shawarma',
  itemName: 'Shawarma',
  unitPricePaise: 12000,
  quantity: 2,
  ...changes,
})

describe('dish workflow', () => {
  it('grows only the newest plain unlocked line, retaining its captured price', () => {
    const lines = [
      dish({ workflowLineId: 'noted', note: 'No sauce' }),
      dish({ workflowLineId: 'first' }),
      dish({ workflowLineId: 'last', unitPricePaise: 13000 }),
      dish({ workflowLineId: 'ready', readyQuantity: 1 }),
    ]
    const added = addDish(
      lines,
      dish({ workflowLineId: 'new', unitPricePaise: 15000, quantity: 1 }),
    )
    expect(added.map((line) => line.quantity)).toEqual([2, 2, 3, 2])
    expect(added[2]?.unitPricePaise).toBe(13000)
    expect(
      addDish(
        [dish({ preparedQuantity: 2 })],
        dish({ workflowLineId: 'new', unitPricePaise: 15000, quantity: 1 }),
      ),
    ).toHaveLength(2)
  })
  it('splits Only 1 at the current price and leaves locked notes alone', () => {
    const fresh = dish({ workflowLineId: 'fresh', unitPricePaise: 15000 })
    expect(noteDish([dish()], 'old', 'No sauce', true, fresh)).toEqual([
      dish({ quantity: 1 }),
      { ...fresh, note: 'No sauce', quantity: 1 },
    ])
    const locked = dish({ note: 'No onion', readyQuantity: 1 })
    expect(noteDish([locked], 'old', 'Extra spicy', false, fresh)).toEqual([locked])
  })
  it('takes the larger readiness or handover quantity and never invents food', () => {
    expect(dishOwed(3, 2, 1)).toBe(1)
    expect(dishOwed(2, 3, 0)).toBe(0)
    expect(dishOwed(3, 1, 3)).toBe(0)
  })
  it('ranks the tablet notes by use, with seed chips only before any use', () => {
    expect(rankedNotes({})).toEqual(NOTE_SEEDS)
    expect(rankedNotes({ 'No sauce': 2, 'No onion': 4, invalid: 0 })).toEqual([
      'No onion',
      'No sauce',
    ])
  })
})

const minutesAgo = (minutes: number, now: Date) =>
  new Date(now.getTime() - minutes * 60_000).toISOString()

const kitchenLine = (changes: Partial<DishKitchenLineFacts> = {}): DishKitchenLineFacts => ({
  menuItemId: 'shawarma',
  itemName: 'Shawarma',
  quantity: 2,
  ...changes,
})

describe('dishLineKey', () => {
  it('names a line by its own identity, so two lines of one dish stay two lines', () => {
    expect(dishLineKey({ menuItemId: 'shawarma', workflowLineId: 'a' })).toBe('a')
    expect(dishLineKey({ menuItemId: 'shawarma', orderLineId: 'b' })).toBe('b')
    expect(dishLineKey({ menuItemId: 'shawarma', workflowLineId: 'a', orderLineId: 'b' })).toBe('a')
    expect(dishLineKey({ menuItemId: 'shawarma' })).toBe('shawarma')
  })

  it('keeps packaging as one line, however it is identified', () => {
    expect(dishLineKey({ kind: 'packaging', menuItemId: 'x', workflowLineId: 'a' })).toBe(
      'packaging',
    )
  })

  it('is not the off path: the counter keys by menu item and ignores line identity', () => {
    const line = { menuItemId: 'shawarma', workflowLineId: 'a', orderLineId: 'b' }
    expect(lineKey(line)).toBe('shawarma')
    expect(dishLineKey(line)).not.toBe(lineKey(line))
  })
})

describe('dishLocked', () => {
  it('locks a line once any of it is ticked or Ready', () => {
    expect(dishLocked(dish())).toBe(false)
    expect(dishLocked(dish({ preparedQuantity: 1 }))).toBe(true)
    expect(dishLocked(dish({ readyQuantity: 1 }))).toBe(true)
  })
})

describe('dishWaitTone', () => {
  const now = new Date('2026-10-14T12:00:00.000Z')

  it('turns critical at forty minutes, a darker red than danger', () => {
    expect(DISH_WAIT_CRITICAL_MINUTES).toBe(40)
    expect(dishWaitTone(minutesAgo(39, now), now)).toBe('danger')
    expect(dishWaitTone(minutesAgo(40, now), now)).toBe('critical')
    expect(dishWaitTone(minutesAgo(90, now), now)).toBe('critical')
  })

  it('shares the kitchen thresholds below that: warning at ten, danger at twenty', () => {
    expect(dishWaitTone(minutesAgo(9, now), now)).toBe('normal')
    expect(dishWaitTone(minutesAgo(10, now), now)).toBe('warning')
    expect(dishWaitTone(minutesAgo(19, now), now)).toBe('warning')
    expect(dishWaitTone(minutesAgo(20, now), now)).toBe('danger')
  })

  it('is not the off path: the kitchen never has a critical tone', () => {
    expect(kitchenWaitTone(minutesAgo(90, now), now)).toBe('danger')
  })
})

describe('sameDishLines', () => {
  it('counts a dish and its note as one dish', () => {
    const plain = kitchenLine()
    const noted = kitchenLine({ note: 'No sauce' })
    expect(sameDishLines([plain], [plain])).toBe(true)
    expect(sameDishLines([plain], [noted])).toBe(false)
    expect(sameDishLines([noted], [kitchenLine({ note: 'No onion' })])).toBe(false)
  })

  it('adds the quantities of a dish and note split over several lines', () => {
    const half = kitchenLine({ quantity: 1, note: 'No sauce' })
    expect(sameDishLines([half, half], [kitchenLine({ quantity: 2, note: 'No sauce' })])).toBe(true)
    expect(sameDishLines([half], [kitchenLine({ quantity: 2, note: 'No sauce' })])).toBe(false)
  })

  it('treats an absent and a null note as the same, and a missing menu item by name', () => {
    expect(sameDishLines([kitchenLine({ note: null })], [kitchenLine()])).toBe(true)
    const named = kitchenLine({ menuItemId: null, itemName: 'Special' })
    expect(sameDishLines([named], [{ ...named }])).toBe(true)
    expect(sameDishLines([named], [{ ...named, itemName: 'Other' }])).toBe(false)
  })

  it('is not the off path: the old comparison ignores a note', () => {
    expect(
      sameLines([kitchenLine({ note: 'No sauce' })], [kitchenLine({ note: 'No onion' })]),
    ).toBe(true)
  })
})

describe('dishKitchenCardState', () => {
  const base = {
    status: 'open' as const,
    lines: [kitchenLine({ note: 'No sauce' })],
    acknowledged: true,
    latestAck: { kind: 'new' as const, lines: [kitchenLine({ note: 'No sauce' })] },
  }

  it('is new until acknowledged, quiet after, and edited when food or its note changes', () => {
    expect(dishKitchenCardState({ ...base, acknowledged: false, latestAck: null })).toBe('new')
    expect(dishKitchenCardState(base)).toBe('quiet')
    expect(
      dishKitchenCardState({ ...base, lines: [kitchenLine({ note: 'No sauce', quantity: 3 })] }),
    ).toBe('edited')
    expect(dishKitchenCardState({ ...base, lines: [kitchenLine({ note: 'No onion' })] })).toBe(
      'edited',
    )
  })

  it('is cancelled for a cancelled order or a card with no food left', () => {
    expect(dishKitchenCardState({ ...base, status: 'cancelled' })).toBe('cancelled')
    expect(dishKitchenCardState({ ...base, lines: [] })).toBe('cancelled')
  })

  it('differs from the off path only on a note', () => {
    const changed = { ...base, lines: [kitchenLine({ note: 'No onion' })] }
    expect(dishKitchenCardState(changed)).toBe('edited')
    expect(kitchenCardState(changed)).toBe('quiet')
  })
})

describe('diffDishKitchenLines', () => {
  it('reports a changed note as the old dish removed and the new one added', () => {
    const rows = diffDishKitchenLines(
      [kitchenLine({ note: 'No onion' })],
      [kitchenLine({ note: 'No sauce' })],
    )
    expect(rows.map((row) => [row.note, row.change])).toEqual([
      ['No onion', 'added'],
      ['No sauce', 'removed'],
    ])
    expect(rows[1]).toMatchObject({ quantity: 0, previousQuantity: 2 })
  })

  it('reports a changed quantity with the quantity it was, and an unchanged dish as same', () => {
    const rows = diffDishKitchenLines(
      [kitchenLine({ quantity: 3 }), kitchenLine({ menuItemId: 'fries', itemName: 'Fries' })],
      [kitchenLine({ quantity: 2 }), kitchenLine({ menuItemId: 'fries', itemName: 'Fries' })],
    )
    expect(rows[0]).toMatchObject({ change: 'changed', quantity: 3, previousQuantity: 2 })
    expect(rows[1]).toMatchObject({ change: 'same', previousQuantity: null })
  })

  it('shows one row for a dish split over several lines', () => {
    const rows = diffDishKitchenLines(
      [kitchenLine({ quantity: 1 }), kitchenLine({ quantity: 1 })],
      [kitchenLine({ quantity: 2 })],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ change: 'same', quantity: 2 })
  })

  it('is not the off path: the old diff has no notes', () => {
    const rows = diffKitchenLines(
      [kitchenLine({ note: 'No onion' })],
      [kitchenLine({ note: 'No sauce' })],
    )
    expect(rows.every((row) => row.change === 'same')).toBe(true)
  })
})

describe('dishAge', () => {
  const at = '2026-10-14T10:00:00.000Z'
  const after = (minutes: number) => new Date(Date.parse(at) + minutes * 60_000)

  it('says how long ago an order was placed, lightly', () => {
    expect(dishAge(at, after(0.5))).toBe('just now')
    expect(dishAge(at, after(1))).toBe('1m ago')
    expect(dishAge(at, after(21))).toBe('21m ago')
    expect(dishAge(at, after(60))).toBe('1h ago')
    expect(dishAge(at, after(84))).toBe('1h 24m ago')
  })

  it('never says an order is from the future', () => {
    expect(dishAge(at, after(-3))).toBe('just now')
  })
})

describe('dishRows', () => {
  const line = (id: string, quantity: number, facts: Partial<DishLineFacts> = {}) => ({
    workflowLineId: id,
    menuItemId: 'paneer',
    itemName: 'Paneer Shawarma',
    unitPricePaise: 15000,
    quantity,
    ...facts,
  })

  it('joins a made line and the food added since into one row with the true total', () => {
    const rows = dishRows([
      line('made', 1, { preparedQuantity: 1 }),
      line('mojito', 1, { menuItemId: 'mojito', itemName: 'Virgin Mojito' }),
      line('added', 2),
    ])
    expect(rows.map((row) => [row.key, row.quantity, row.made])).toEqual([
      ['made', 3, 1],
      ['mojito', 1, 0],
    ])
    expect(rows[0]!.growing?.workflowLineId).toBe('added')
  })

  it('counts Ready food as made, and a row all made has nothing to grow', () => {
    const [row] = dishRows([line('ready', 2, { readyQuantity: 2 })])
    expect(row).toMatchObject({ quantity: 2, made: 2, growing: null })
  })

  it('keeps another note or an older price on its own row', () => {
    const rows = dishRows([
      line('plain', 1),
      line('noted', 1, { note: 'No onion' }),
      line('older', 1, { unitPricePaise: 14000 }),
    ])
    expect(rows.map((row) => row.key)).toEqual(['plain', 'noted', 'older'])
  })
})

describe('dishRounds', () => {
  it('keeps the first lines first, then each edit in the order made, each line once', () => {
    const lines = [
      { id: 'a' },
      { id: 'c', addedAt: '2026-10-14T10:20:00Z' },
      { id: 'b' },
      { id: 'd', addedAt: '2026-10-14T10:05:00Z' },
      { id: 'e', addedAt: '2026-10-14T10:20:00Z' },
    ]
    expect(dishRounds(lines).map((round) => round.map(({ line }) => line.id))).toEqual([
      ['a', 'b'],
      ['d'],
      ['c', 'e'],
    ])
  })

  it('draws one round when nothing was added', () => {
    const plain: { id: string; addedAt?: string }[] = [{ id: 'a' }, { id: 'b' }]
    expect(dishRounds(plain)).toHaveLength(1)
  })
})
