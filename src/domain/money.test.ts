import { describe, expect, it } from 'vitest'

import { formatPaise, NotPaiseError, paiseToRupees, rupeesToPaise } from './money'

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
