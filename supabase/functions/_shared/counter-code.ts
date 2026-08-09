/**
 * The two secrets the counter handshake uses, and the machine credential behind
 * a tablet.
 *
 * The setup code reuses the invite alphabet and length from
 * `_shared/invite-code.ts`, because it does the same job: it travels from an
 * admin's phone to a piece of hardware by being read out or typed, and it is the
 * only thing standing between a stranger and a tablet at your counter.
 *
 * The confirmation code does NOT do that job, and this file is where the
 * difference is written down.
 */

/**
 * The four-digit confirmation code.
 *
 * Four digits is a decision, not an oversight (design: "The code is four digits,
 * and that is not an oversight"). It does no work against guessing, because
 * entering it at all requires an authenticated session belonging to the named
 * person on their own device, and the request it belongs to dies after three
 * wrong entries and after two minutes. Its only job is to prove the person can
 * SEE the tablet. Length therefore buys nothing but slower typing during a rush.
 *
 * Rejection sampling rather than a modulo: 10000 does not divide 65536, so
 * `% 10000` would make the low codes very slightly likelier. That bias is
 * harmless here for the reason above, and it is cheaper to not have it than to
 * explain every time somebody reads this.
 */
export function generateShiftCode(): string {
  const buffer = new Uint16Array(1)
  let value = 65536
  while (value >= 60000) {
    crypto.getRandomValues(buffer)
    value = buffer[0]
  }
  return String(value % 10000).padStart(4, '0')
}

/** Digits only, so a space or a stray character never refuses a correct code. */
export function normaliseShiftCode(raw: string): string {
  return raw.replace(/\D/g, '')
}

/** A shift request lives two minutes. Long enough to walk round a counter. */
export const SHIFT_REQUEST_VALID_FOR = '2 minutes'

/**
 * A setup code lives fifteen minutes. Far shorter than an invite's seven days,
 * because an invite travels to a person who may be asleep and this travels
 * across a shop to a tablet the admin is walking towards.
 */
export const SETUP_CODE_VALID_FOR = '15 minutes'

/**
 * The reserved domain for machine Auth identities.
 *
 * Deliberately NOT `@login.shawarmania.invalid`, which is the person alias
 * domain. `request_counter_shift` resolves a typed username against the login
 * domain alone, so a tablet in this domain can never be named as the operator of
 * a shift — the separation is a fact about the address rather than a check
 * somebody remembered to write.
 */
export const DEVICE_EMAIL_DOMAIN = 'device.shawarmania.invalid'

export function deviceEmail(deviceId: string): string {
  return `tablet-${deviceId}@${DEVICE_EMAIL_DOMAIN}`
}

/**
 * The password a tablet signs in with, which no human ever sees or types.
 *
 * It exists because a Supabase session is minted by signing in and there is
 * exactly one way that happens (redeem-invite's design D5, and the same rule
 * here). It is handed to the tablet once, in the response that sets it up, and
 * the tablet keeps only the session that came from it.
 */
export function generateDevicePassword(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}
