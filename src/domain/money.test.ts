import { describe, expect, it } from 'vitest'

import {
  compactNumber,
  compactPaise,
  formatPaise,
  NotPaiseError,
  paiseToRupees,
  rupeesToPaise,
} from './money'

describe('compactPaise', () => {
  it('keeps three significant digits in Indian units, trailing zeros dropped', () => {
    expect(compactPaise(0)).toBe('₹0')
    expect(compactPaise(95000)).toBe('₹950')
    expect(compactPaise(211400)).toBe('₹2.11K')
    expect(compactPaise(110000)).toBe('₹1.1K')
    expect(compactPaise(1253000)).toBe('₹12.5K')
    expect(compactPaise(12530000)).toBe('₹1.25L')
    expect(compactPaise(105014100)).toBe('₹10.5L')
    expect(compactPaise(250000000)).toBe('₹25L')
    expect(compactPaise(2500000000)).toBe('₹2.5Cr')
    expect(compactPaise(-211400)).toBe('-₹2.11K')
  })

  it('moves to the next unit when rounding reaches the limit, never ₹100K', () => {
    expect(compactPaise(99960)).toBe('₹1K')
    expect(compactPaise(9999000)).toBe('₹1L')
    expect(compactPaise(999600000)).toBe('₹1Cr')
  })

  it('throws on a non-integer', () => {
    expect(() => compactPaise(1.5)).toThrow(NotPaiseError)
  })
})

describe('compactNumber', () => {
  it('shortens a count the same way, without a rupee sign', () => {
    expect(compactNumber(42)).toBe('42')
    expect(compactNumber(2.5)).toBe('2.5')
    expect(compactNumber(1234)).toBe('1.23K')
  })
})

describe('formatPaise', () => {
  it('groups in the Indian style', () => {
    expect(formatPaise(12345600)).toBe('₹1,23,456')
    expect(formatPaise(100000000)).toBe('₹10,00,000')
    expect(formatPaise(123400)).toBe('₹1,234')
  })

  it('formats small and zero amounts', () => {
    expect(formatPaise(0)).toBe('₹0')
    expect(formatPaise(100)).toBe('₹1')
    expect(formatPaise(12000)).toBe('₹120')
  })

  it('keeps the paise part when it is non-zero', () => {
    expect(formatPaise(12050)).toBe('₹120.50')
    expect(formatPaise(1)).toBe('₹0.01')
    expect(formatPaise(12345699)).toBe('₹1,23,456.99')
  })

  it('signs negatives, which cash differences produce when the drawer is short', () => {
    expect(formatPaise(-12000)).toBe('-₹120')
    expect(formatPaise(-12345650)).toBe('-₹1,23,456.50')
    expect(formatPaise(-1)).toBe('-₹0.01')
  })

  it('throws on a non-integer rather than rounding a leaked float', () => {
    expect(() => formatPaise(120.5)).toThrow(NotPaiseError)
    expect(() => formatPaise(0.1 + 0.2)).toThrow(NotPaiseError)
    expect(() => formatPaise(Number.NaN)).toThrow(NotPaiseError)
  })
})

describe('rupee conversion', () => {
  it('round-trips whole and fractional rupees', () => {
    expect(paiseToRupees(12050)).toBe(120.5)
    expect(rupeesToPaise(120.5)).toBe(12050)
    expect(rupeesToPaise(paiseToRupees(999999))).toBe(999999)
  })

  it('rounds away float noise from the input layer', () => {
    expect(rupeesToPaise(0.1 + 0.2)).toBe(30)
    expect(rupeesToPaise(0.07 * 3)).toBe(21)
    expect(rupeesToPaise(0.615 * 100)).toBe(6150)
  })

  it('rejects non-finite input', () => {
    expect(() => rupeesToPaise(Number.POSITIVE_INFINITY)).toThrow(TypeError)
    expect(() => paiseToRupees(12.5)).toThrow(NotPaiseError)
  })
})
