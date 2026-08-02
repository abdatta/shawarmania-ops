import { describe, expect, it } from 'vitest'

import {
  formatIndianPhone,
  normalizeIndianPhone,
  phoneErrorMessage,
  validateIndianPhone,
} from '../../shared/phone'

/**
 * The cases below are the SAME table asserted in
 * `supabase/tests/20_global_customer_identity.sql` against
 * `public.normalize_indian_phone`. Two implementations of one rule are only
 * safe while something checks they still agree; this is that something, and a
 * case added here belongs there too.
 */
const CANONICAL = '+919876543210'

describe('normalizeIndianPhone', () => {
  it.each([
    ['9876543210', 'bare ten digits'],
    ['98765 43210', 'the way it is read out loud'],
    ['98765-43210', 'hyphenated'],
    ['919876543210', 'country code, no plus'],
    ['+919876543210', 'already canonical'],
    ['+91-98765-43210', 'plus, country code and separators'],
    ['+91 (98765) 43210', 'brackets'],
    ['  9876543210  ', 'surrounding whitespace'],
    ['98765.43210', 'dots'],
    ['+91' + String.fromCharCode(0xa0) + '9876543210', 'a non-breaking space from a paste'],
  ])('%s → the one identity (%s)', (input) => {
    expect(normalizeIndianPhone(input)).toBe(CANONICAL)
  })

  it.each([
    ['', 'nothing typed'],
    ['98765', 'half a number'],
    ['987654321', 'nine digits'],
    ['98765432101', 'eleven digits'],
    ['1234567890', 'does not start 6-9'],
    ['5876543210', 'landline-shaped'],
    ['09876543210', 'a leading zero trunk prefix, deliberately refused'],
    ['+449876543210', 'another country'],
    ['+91987654321a', 'a letter'],
    ['abcdefghij', 'not a number at all'],
  ])('%s matches and creates nothing (%s)', (input) => {
    expect(normalizeIndianPhone(input)).toBeNull()
  })

  it('accepts null and undefined without throwing', () => {
    expect(normalizeIndianPhone(null)).toBeNull()
    expect(normalizeIndianPhone(undefined)).toBeNull()
  })
})

describe('validateIndianPhone', () => {
  it('separates nothing typed from typed wrong', () => {
    expect(validateIndianPhone('')).toEqual({ phone: null, error: 'required' })
    expect(validateIndianPhone('   ')).toEqual({ phone: null, error: 'required' })
    expect(validateIndianPhone('98765')).toEqual({ phone: null, error: 'incomplete' })
  })

  it('returns the canonical form when the number is complete', () => {
    expect(validateIndianPhone('98765 43210')).toEqual({ phone: CANONICAL, error: null })
  })

  it('names the problem rather than describing it in code', () => {
    expect(phoneErrorMessage('required')).toBe('Enter a phone number.')
    expect(phoneErrorMessage('incomplete')).toBe('Enter the complete 10-digit mobile number.')
  })
})

describe('formatIndianPhone', () => {
  it('shows the number the way it is said', () => {
    expect(formatIndianPhone(CANONICAL)).toBe('98765 43210')
  })

  it('leaves anything it does not recognise exactly as it found it', () => {
    expect(formatIndianPhone('not a phone')).toBe('not a phone')
  })
})
