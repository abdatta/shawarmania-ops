import { describe, expect, it } from 'vitest'

import {
  customerMatchStrength,
  highlightName,
  highlightPhone,
  parseCustomerQuery,
} from './customer-search'

const bold = (segments: { text: string; matched: boolean }[]) =>
  segments
    .filter((segment) => segment.matched)
    .map((segment) => segment.text)
    .join('|')

describe('parseCustomerQuery', () => {
  it('reads digits as a number, taking a pasted +91 off the front', () => {
    expect(parseCustomerQuery(' +91 90000-00104 ')).toEqual({
      kind: 'digits',
      digits: '9000000104',
    })
    expect(parseCustomerQuery('0104')).toEqual({ kind: 'digits', digits: '0104' })
  })

  it('answers from three of either', () => {
    expect(parseCustomerQuery('rit')).toEqual({ kind: 'name', needle: 'rit' })
    expect(parseCustomerQuery('104')).toEqual({ kind: 'digits', digits: '104' })
  })

  it('reads anything with a letter as a name, lower-cased', () => {
    expect(parseCustomerQuery('  GhOsh ')).toEqual({ kind: 'name', needle: 'ghosh' })
  })

  it('refuses to answer below the minimums rather than answering with everybody', () => {
    for (const query of ['', ' ', 'r', 'ri', '9', '90', '+91', '+91 9']) {
      expect(parseCustomerQuery(query)).toEqual({ kind: 'too-short' })
    }
  })
})

describe('customerMatchStrength', () => {
  const moumita = { name: 'Moumta Ghosh', phone: '+919000000104' }

  it('matches a run anywhere in the name, exactly', () => {
    expect(customerMatchStrength(parseCustomerQuery('ghosh'), moumita)).toBe(0)
    expect(customerMatchStrength(parseCustomerQuery('umta'), moumita)).toBe(0)
  })

  it('matches the same letters in order with gaps, loosely', () => {
    expect(customerMatchStrength(parseCustomerQuery('mmta'), moumita)).toBe(1)
    expect(customerMatchStrength(parseCustomerQuery('mghsh'), moumita)).toBe(1)
    expect(customerMatchStrength(parseCustomerQuery('hsohg'), moumita)).toBeNull()
  })

  it('matches digits only as one run, never loosely', () => {
    expect(customerMatchStrength(parseCustomerQuery('0104'), moumita)).toBe(0)
    // 9, 1, 0, 4 appear in that order in the number, but not together.
    expect(customerMatchStrength(parseCustomerQuery('9104'), moumita)).toBeNull()
  })

  it('never matches a customer without a name by name', () => {
    expect(
      customerMatchStrength(parseCustomerQuery('abc'), { name: null, phone: '+919000000102' }),
    ).toBeNull()
  })
})

describe('highlighting', () => {
  it('bolds one run for an exact name match, in the original case', () => {
    expect(bold(highlightName('Moumta Ghosh', parseCustomerQuery('ghosh')))).toBe('Ghosh')
  })

  it('bolds the scattered letters of a loose name match', () => {
    expect(bold(highlightName('Moumta Ghosh', parseCustomerQuery('mmta')))).toBe('M|mta')
  })

  it('bolds the matched digits across the display space as one run', () => {
    const segments = highlightPhone('90000 00104', parseCustomerQuery('000001'))
    expect(bold(segments)).toBe('000 001')
    expect(segments.map((segment) => segment.text).join('')).toBe('90000 00104')
  })

  it('leaves the name plain for a number search, and the number plain for a name search', () => {
    expect(bold(highlightName('Moumta Ghosh', parseCustomerQuery('0104')))).toBe('')
    expect(bold(highlightPhone('90000 00104', parseCustomerQuery('ghosh')))).toBe('')
  })
})
