export const USERNAME_MIN_LENGTH = 3
export const USERNAME_MAX_LENGTH = 30
export const AUTH_ALIAS_SUFFIX = '@login.shawarmania.invalid'

export type UsernameError =
  | 'required'
  | 'too_short'
  | 'too_long'
  | 'at_not_allowed'
  | 'invalid_characters'
  | 'period_position'
  | 'consecutive_periods'

export interface UsernameValidation {
  username: string
  error: UsernameError | null
}

/**
 * The one canonicalisation rule used by forms, adapters, Edge Functions, and
 * migration tooling. Canonicalisation is deliberately small: surrounding
 * whitespace is discarded and ASCII letters are lowercased. Internal
 * whitespace and every non-ASCII lookalike remain visible to validation and
 * are refused rather than silently rewritten.
 */
export function normalizeUsername(input: string): string {
  return input.trim().toLowerCase()
}

export function validateUsername(input: string): UsernameValidation {
  const username = normalizeUsername(input)

  if (username.length === 0) return { username, error: 'required' }
  if (username.startsWith('@')) return { username, error: 'at_not_allowed' }
  if (username.length < USERNAME_MIN_LENGTH) return { username, error: 'too_short' }
  if (username.length > USERNAME_MAX_LENGTH) return { username, error: 'too_long' }
  if (!/^[a-z0-9._]+$/.test(username)) {
    return { username, error: 'invalid_characters' }
  }
  if (username.startsWith('.') || username.endsWith('.')) {
    return { username, error: 'period_position' }
  }
  if (username.includes('..')) return { username, error: 'consecutive_periods' }

  return { username, error: null }
}

export function canonicalUsername(input: string): string | null {
  const result = validateUsername(input)
  return result.error === null ? result.username : null
}

/** Provider plumbing only. Product UI must never render the returned value. */
export function usernameToAuthAlias(input: string): string | null {
  const username = canonicalUsername(input)
  return username === null ? null : `${username}${AUTH_ALIAS_SUFFIX}`
}

/**
 * Parse only the reserved alias format. A malformed or legacy Auth identifier
 * is an integrity error and never becomes product-visible username text.
 */
export function authAliasToUsername(authAlias: string | null | undefined): string | null {
  if (!authAlias) return null
  const normalizedAlias = authAlias.trim().toLowerCase()
  if (!normalizedAlias.endsWith(AUTH_ALIAS_SUFFIX)) return null

  const username = normalizedAlias.slice(0, -AUTH_ALIAS_SUFFIX.length)
  return canonicalUsername(username)
}

export function usernameErrorMessage(error: UsernameError): string {
  switch (error) {
    case 'required':
      return 'Enter a username.'
    case 'too_short':
      return `Use at least ${USERNAME_MIN_LENGTH} characters.`
    case 'too_long':
      return `Use no more than ${USERNAME_MAX_LENGTH} characters.`
    case 'at_not_allowed':
      return 'Type the username without the @ sign.'
    case 'invalid_characters':
      return 'Use only lowercase letters, numbers, periods, and underscores.'
    case 'period_position':
      return 'A username cannot begin or end with a period.'
    case 'consecutive_periods':
      return 'A username cannot contain consecutive periods.'
  }
}
