/**
 * The one-time code (design D4).
 *
 * Crockford base32: the digits and letters minus I, L, O and U, so nothing in
 * a code can be misread as something else when it is typed out of a WhatsApp
 * message. Ten characters is 50 bits — far past guessable, and still short
 * enough to retype without resentment.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const CODE_LENGTH = 10

/** A fresh code, grouped as XXXXX-XXXXX for legibility. */
export function generateCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH)
  crypto.getRandomValues(bytes)
  // 32 divides 256 exactly, so the modulo carries no bias.
  const chars = Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length])
  return `${chars.slice(0, 5).join('')}-${chars.slice(5).join('')}`
}

/**
 * What a person typed, reduced to what was meant: upper-cased, grouping and
 * spaces dropped, and Crockford's confusable substitutions applied (I and L
 * are 1, O is zero) so a correct code is never rejected over a glyph.
 */
export function normaliseCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0')
    .replace(/[^0-9A-Z]/g, '')
}

/** SHA-256 hex of a normalised code — the only form that reaches the database. */
export async function hashCode(normalised: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalised))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** How long a freshly issued code stays redeemable. */
export const INVITE_VALID_FOR = '7 days'

/** Refusing anything shorter is the one password rule this app has. */
export const MIN_PASSWORD_LENGTH = 10
