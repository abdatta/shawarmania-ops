import { describe, expect, it } from 'vitest'

import {
  AUTH_ALIAS_SUFFIX,
  authAliasToUsername,
  canonicalUsername,
  normalizeUsername,
  usernameToAuthAlias,
  validateUsername,
} from '../../shared/username'

describe('canonical usernames', () => {
  it.each([
    ['rahul.k_2', 'rahul.k_2'],
    ['  Rahul.K_2  ', 'rahul.k_2'],
    ['abc', 'abc'],
    ['a'.repeat(30), 'a'.repeat(30)],
    ['staff_2026', 'staff_2026'],
  ])('accepts %j as %j', (input, expected) => {
    expect(canonicalUsername(input)).toBe(expected)
  })

  it.each([
    ['', 'required'],
    ['ab', 'too_short'],
    ['a'.repeat(31), 'too_long'],
    ['@rahul', 'at_not_allowed'],
    ['rahul k', 'invalid_characters'],
    ['rahul-k', 'invalid_characters'],
    ['rāhul', 'invalid_characters'],
    ['.rahul', 'period_position'],
    ['rahul.', 'period_position'],
    ['rahul..k', 'consecutive_periods'],
  ] as const)('refuses %j with %s', (input, error) => {
    expect(validateUsername(input)).toEqual({
      username: normalizeUsername(input),
      error,
    })
  })

  it('normalizes case before a business-wide collision check', () => {
    expect(canonicalUsername('Rahul.K')).toBe(canonicalUsername('rahul.k'))
  })

  it('round-trips only the reserved non-deliverable Auth alias', () => {
    const alias = usernameToAuthAlias('Rahul.K')
    expect(alias).toBe(`rahul.k${AUTH_ALIAS_SUFFIX}`)
    expect(authAliasToUsername(alias)).toBe('rahul.k')
    expect(authAliasToUsername('rahul.k@example.com')).toBeNull()
    expect(authAliasToUsername(`bad..name${AUTH_ALIAS_SUFFIX}`)).toBeNull()
  })
})
