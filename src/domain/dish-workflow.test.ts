import { describe, expect, it } from 'vitest'
import type { DishLineFacts } from './dish-workflow'
import { addDish, dishOwed, noteDish, rankedNotes, NOTE_SEEDS } from './dish-workflow'

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
