/**
 * A campaign's test numbers (a-campaign-goes-out-on-whatsapp, owner request
 * 2026-11-18): numbers the owners type themselves (their own, a co-owner's,
 * a friend's), sent each campaign's message ahead of any customer, with no
 * press on the laptop.
 *
 * **Not customers' numbers**, so they are not held to the customer
 * directory's rule of Indian mobiles only: a friend abroad must work. A number
 * is stored as `+` and its digits, and the database's
 * `set_campaign_test_numbers` keeps the same rule.
 *
 * - Ten digits starting 6 to 9 is an Indian mobile: `+91` goes in front.
 * - Twelve digits starting 91 and then 6 to 9 is the same, typed with the
 *   country code and no plus.
 * - Anything else needs the plus and the country code (`+1 202 555 0142`),
 *   8 to 15 digits after it, not starting 0. `00` in front reads as the plus.
 *   An Indian number given with `+91` must still be ten digits starting 6–9.
 *
 * Spaces, dashes, dots and brackets are dropped. Nothing else is guessed: a
 * ten-digit number not starting 6 to 9 could be anywhere, so it is refused
 * and the field says to type the country code.
 */

/** At most this many test numbers on one campaign. */
export const MAX_TEST_NUMBERS = 5

/** At most this many numbers used before are suggested. */
export const TEST_NUMBER_SUGGESTIONS = 10

export type TestNumberCheck =
  { phone: string; error: null } | { phone: null; error: 'required' | 'incomplete' }

export function checkTestNumber(input: string | null | undefined): TestNumberCheck {
  const typed = (input ?? '').replace(/[\s\-().]/g, '')
  if (typed === '') return { phone: null, error: 'required' }
  const plussed = typed.startsWith('00') ? `+${typed.slice(2)}` : typed
  if (plussed.startsWith('+')) {
    const digits = plussed.slice(1)
    if (!/^[1-9][0-9]{7,14}$/.test(digits)) return { phone: null, error: 'incomplete' }
    if (digits.startsWith('91') && !/^91[6-9][0-9]{9}$/.test(digits)) {
      return { phone: null, error: 'incomplete' }
    }
    return { phone: `+${digits}`, error: null }
  }
  if (/^[6-9][0-9]{9}$/.test(plussed)) return { phone: `+91${plussed}`, error: null }
  if (/^91[6-9][0-9]{9}$/.test(plussed)) return { phone: `+${plussed}`, error: null }
  return { phone: null, error: 'incomplete' }
}

export function testNumberProblem(error: 'required' | 'incomplete'): string {
  return error === 'required'
    ? 'Type a number.'
    : 'Type a 10-digit mobile, or the whole number with + and the country code.'
}

/**
 * `+919000000901` → `+91 90000 00901`, `+12025550142` → `+1 202 555 0142`.
 * Display only, and the whole number: these are the owners' own, and showing
 * them in full is the point.
 */
export function formatTestNumber(phone: string): string {
  const india = /^\+91([6-9][0-9]{4})([0-9]{5})$/.exec(phone)
  if (india) return `+91 ${india[1]} ${india[2]}`
  const nanp = /^\+1([0-9]{3})([0-9]{3})([0-9]{4})$/.exec(phone)
  if (nanp) return `+1 ${nanp[1]} ${nanp[2]} ${nanp[3]}`
  return phone
}
