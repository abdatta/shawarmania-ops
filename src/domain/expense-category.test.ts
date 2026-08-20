import { describe, expect, it } from 'vitest'

import { normalizeCategory, reservedCategoryConflict } from './expense-category'

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

describe('reservedCategoryConflict', () => {
  const reserved = ['Hyperpure']

  it('catches the exact reserved name', () => {
    expect(reservedCategoryConflict('Hyperpure', reserved)).toBe('Hyperpure')
  })

  it('catches the spellings that must not slip through', () => {
    // The whole reason it is wider than equality: a second spelling would
    // recreate the exact duplicate reserving it exists to prevent.
    for (const spelling of [
      'hyperpure',
      'HYPERPURE',
      'hyper pure',
      'Hyper-Pure',
      'HyperPure Goods',
      ' hyperpure ',
    ]) {
      expect(reservedCategoryConflict(spelling, reserved), spelling).toBe('Hyperpure')
    }
  })

  it('leaves an unrelated category alone', () => {
    expect(reservedCategoryConflict('Chicken', reserved)).toBeNull()
    expect(reservedCategoryConflict('Gas', reserved)).toBeNull()
    expect(reservedCategoryConflict('', reserved)).toBeNull()
  })

  it('names the longest matching reserved category', () => {
    expect(reservedCategoryConflict('Hyperpure Veg Goods', ['Hyperpure', 'Hyperpure Veg'])).toBe(
      'Hyperpure Veg',
    )
  })
})
