import { describe, expect, it } from 'vitest'

import { normalizeCategory } from './expense-category'

describe('normalizeCategory', () => {
  it.each([
    ['  Chicken', 'Chicken'],
    ['Chicken  ', 'Chicken'],
    ['Staff   Food', 'Staff Food'],
    ['Staff\tFood', 'Staff Food'],
    ['Staff\u00a0Food', 'Staff Food'],
    ['Hyperpure', 'Hyperpure'],
  ])('normalises %j to %j', (input, expected) => {
    expect(normalizeCategory(input)).toBe(expected)
  })

  it('preserves the case that was typed', () => {
    expect(normalizeCategory('  HyperPure  Goods ')).toBe('HyperPure Goods')
  })
})
