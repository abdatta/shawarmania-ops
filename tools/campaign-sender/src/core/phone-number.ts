/**
 * Reading a phone number somebody typed, and the only form one is shown in.
 */

export type PhoneResult = { ok: true; digits: string } | { ok: false; problem: string }

/**
 * WhatsApp wants the full number as digits only, country code first.
 *
 * A bare ten-digit number is refused rather than guessed at. Prefixing 91 would
 * be right for this business today and silently wrong the day somebody links a
 * number from anywhere else, and a wrong number here is a message to a
 * stranger.
 */
export function fullPhoneNumber(input: string): PhoneResult {
  const digits = input.replace(/[\s()+\-.]/g, '')
  if (!/^\d+$/.test(digits)) {
    return { ok: false, problem: 'Use digits only, for example 919812345678.' }
  }
  if (digits.length === 10) {
    return {
      ok: false,
      problem: 'Include the country code, for example 91 before an Indian number.',
    }
  }
  if (digits.length < 11 || digits.length > 15 || digits.startsWith('0')) {
    return { ok: false, problem: 'That does not read as a full number with its country code.' }
  }
  return { ok: true, digits }
}

/**
 * The only form in which a phone number is ever printed or stored by the
 * sender. Customer numbers are PII (AGENTS.md); so is the business's own.
 */
export function lastFour(digitsOrJid: string): string {
  const digits = (digitsOrJid.split(/[:@]/)[0] ?? '').replace(/\D/g, '')
  return digits.length >= 4 ? `••••${digits.slice(-4)}` : '••••'
}
