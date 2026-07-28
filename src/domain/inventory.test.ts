import { describe, expect, it } from 'vitest'

import {
  formatDelta,
  formatQuantity,
  isLowStock,
  movementDelta,
  roundQuantity,
  sumQuantities,
} from './inventory'

describe('roundQuantity', () => {
  it('keeps the binary error out of a figure somebody is asked to trust', () => {
    expect(roundQuantity(0.1 + 0.2)).toBe(0.3)
    expect(sumQuantities([0.1, 0.2])).toBe(0.3)
  })

  it('holds three decimals — grams, millilitres, whole pieces', () => {
    expect(roundQuantity(1.23456)).toBe(1.235)
    expect(roundQuantity(240)).toBe(240)
  })

  it('refuses a value that is not a number at all', () => {
    expect(() => roundQuantity(Number.NaN)).toThrow(TypeError)
    expect(() => roundQuantity(Number.POSITIVE_INFINITY)).toThrow(TypeError)
  })

  it('accumulates a long run without drifting', () => {
    const tenth = Array.from({ length: 10 }, () => 0.1)
    expect(sumQuantities(tenth)).toBe(1)
  })
})

describe('isLowStock', () => {
  it('counts the threshold itself as low', () => {
    expect(isLowStock({ currentQuantity: 10, lowStockThreshold: 10 })).toBe(true)
  })

  it('is low below it and not above it', () => {
    expect(isLowStock({ currentQuantity: 9.5, lowStockThreshold: 10 })).toBe(true)
    expect(isLowStock({ currentQuantity: 10.5, lowStockThreshold: 10 })).toBe(false)
  })
})

describe('movementDelta', () => {
  it('takes the sign from the kind of movement, not from the person', () => {
    expect(movementDelta('added', 20)).toBe(20)
    expect(movementDelta('used', 6.5)).toBe(-6.5)
    expect(movementDelta('wasted', 2)).toBe(-2)
  })

  it('ignores a stray minus on an ordinary movement', () => {
    // Somebody typing "-5 used" means five fewer, not five more.
    expect(movementDelta('used', -5)).toBe(-5)
    expect(movementDelta('added', -5)).toBe(5)
  })

  it('takes a correction exactly as it was given, because direction is the point', () => {
    expect(movementDelta('correction', -0.5)).toBe(-0.5)
    expect(movementDelta('correction', 1.25)).toBe(1.25)
  })

  it('refuses a quantity that is not a number', () => {
    expect(() => movementDelta('added', Number.NaN)).toThrow(TypeError)
  })
})

describe('formatting', () => {
  it('writes a quantity the way a person reads it', () => {
    expect(formatQuantity(12.5, 'kg')).toBe('12.5 kg')
    expect(formatQuantity(0.1 + 0.2, 'litre')).toBe('0.3 litre')
  })

  it('writes a delta with a real minus sign', () => {
    expect(formatDelta(15)).toBe('+15')
    expect(formatDelta(-8.5)).toBe('−8.5')
    expect(formatDelta(0)).toBe('+0')
  })
})
