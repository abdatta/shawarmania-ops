import { describe, expect, it } from 'vitest'

import {
  checkTestNumber,
  formatTestNumber,
  testNumberProblem,
} from '../../shared/campaign-test-number'

/**
 * A campaign's test numbers: the owners' own, so not held to the customer
 * directory's Indian-mobiles-only rule. `set_campaign_test_numbers` keeps the
 * same rule in the database.
 */
describe('checkTestNumber', () => {
  it('reads a ten-digit Indian mobile, however it was spaced', () => {
    expect(checkTestNumber('90000 00901')).toEqual({ phone: '+919000000901', error: null })
    expect(checkTestNumber('(900) 000-0901')).toEqual({ phone: '+919000000901', error: null })
  })

  it('reads the same number given with its country code, with or without the plus', () => {
    for (const typed of ['+91 90000 00901', '919000000901', '0091 9000000901']) {
      expect(checkTestNumber(typed)).toEqual({ phone: '+919000000901', error: null })
    }
  })

  it('takes a number from abroad with its plus and country code', () => {
    expect(checkTestNumber('+1 (202) 555-0142')).toEqual({ phone: '+12025550142', error: null })
    expect(checkTestNumber('+44 20 7946 0958')).toEqual({ phone: '+442079460958', error: null })
  })

  it('refuses what it would have to guess', () => {
    // Ten digits not starting 6 to 9 could be anywhere: it needs its country code.
    expect(checkTestNumber('2025550142').error).toBe('incomplete')
    expect(checkTestNumber('98765').error).toBe('incomplete')
    expect(checkTestNumber('+91 12345 67890').error).toBe('incomplete')
    expect(checkTestNumber('+0 1234 5678').error).toBe('incomplete')
    expect(checkTestNumber('+1234567').error).toBe('incomplete')
    expect(checkTestNumber('+1234567890123456').error).toBe('incomplete')
    expect(checkTestNumber('ninety').error).toBe('incomplete')
    expect(checkTestNumber('  ').error).toBe('required')
  })

  it('says what to type', () => {
    expect(testNumberProblem('incomplete')).toMatch(/country code/)
    expect(testNumberProblem('required')).toBe('Type a number.')
  })
})

describe('formatTestNumber', () => {
  it('spaces an Indian and an American number, and leaves others whole', () => {
    expect(formatTestNumber('+919000000901')).toBe('+91 90000 00901')
    expect(formatTestNumber('+12025550142')).toBe('+1 202 555 0142')
    expect(formatTestNumber('+442079460958')).toBe('+442079460958')
  })
})
