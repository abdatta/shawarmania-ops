import { describe, expect, it, vi } from 'vitest'

/**
 * The dataset must fail loudly rather than render a figure it cannot justify.
 *
 * Its own file, because these tests replace a fixture module for the whole
 * module graph and a mock that leaked into the scenario tests would make them
 * assert against a dataset nobody ships.
 */

vi.mock('./fixtures/operations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./fixtures/operations')>()
  return {
    ...actual,
    inventoryItemFixtures: actual.inventoryItemFixtures.map((item, index) =>
      // One item now claims a quantity its own movements do not produce — the
      // exact drift that makes "why does it say 4 kg?" unanswerable.
      index === 0 ? { ...item, current_quantity: item.current_quantity + 1 } : item,
    ),
  }
})

describe('a demo fixture that contradicts its own ledger', () => {
  it('throws at construction, naming what disagreed', async () => {
    const { createDemoStore } = await import('./store')

    expect(() => createDemoStore()).toThrowError(/movements sum to/)
  })
})
