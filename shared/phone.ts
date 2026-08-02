/**
 * Canonical customer phone — the TypeScript half of one rule.
 *
 * The other half is `public.normalize_indian_phone(text)` in
 * 20260802000002_global_customer_identity.sql, and the two must agree
 * character for character: the database is the one that decides identity, so a
 * client that canonicalised differently would send a number the database then
 * read as a different customer. `src/lib/phone.test.ts` runs the same table of
 * cases the pgTAP suite runs, which is what keeps the pair honest.
 *
 * Lives in `shared/` for the same reason `username.ts` does: forms, adapters,
 * migration tooling and Edge Functions all need it, and a second copy of a
 * normalisation rule is a second answer to "who is this customer".
 */

/**
 * Separators a person may type — space, hyphen, brackets, dot, tab, and the
 * non-breaking space a paste from a contacts app brings with it. Anything else
 * makes the input invalid. Kept as explicit escapes so this list reads against
 * `translate(..., ' -().' || chr(9) || chr(160), '')` in the migration.
 */
const SEPARATORS = /[ \-().\t\u00a0]/g

export type PhoneError = 'required' | 'incomplete'

export interface PhoneValidation {
  /** The canonical `+91XXXXXXXXXX` form, or null when the input is not one. */
  phone: string | null
  error: PhoneError | null
}

/**
 * Three accepted shapes — ten digits, `91` + ten, `+91` + ten — with the
 * separators above allowed anywhere, and a first digit of 6-9 as every Indian
 * mobile has.
 *
 * A leading-zero trunk prefix is deliberately NOT accepted. Refusing an unusual
 * input costs a retype; accepting one the database would read differently would
 * cost a customer their identity.
 */
export function normalizeIndianPhone(input: string | null | undefined): string | null {
  const stripped = (input ?? '').replace(SEPARATORS, '')

  if (/^\+91[6-9][0-9]{9}$/.test(stripped)) return `+91${stripped.slice(-10)}`
  if (/^91[6-9][0-9]{9}$/.test(stripped)) return `+91${stripped.slice(-10)}`
  if (/^[6-9][0-9]{9}$/.test(stripped)) return `+91${stripped}`

  return null
}

/**
 * The same rule, with the one distinction a form needs: nothing typed yet is
 * not the same as typed wrong. Both refuse a lookup; only one of them deserves
 * a red message under the field.
 */
export function validateIndianPhone(input: string | null | undefined): PhoneValidation {
  const stripped = (input ?? '').replace(SEPARATORS, '')
  if (stripped.length === 0) return { phone: null, error: 'required' }

  const phone = normalizeIndianPhone(input)
  return phone === null ? { phone: null, error: 'incomplete' } : { phone, error: null }
}

export function phoneErrorMessage(error: PhoneError): string {
  switch (error) {
    case 'required':
      return 'Enter a phone number.'
    case 'incomplete':
      return 'Enter the complete 10-digit mobile number.'
  }
}

/**
 * `+919876543210` → `98765 43210`. Display only: what is stored, compared and
 * sent is always the canonical form.
 */
export function formatIndianPhone(phone: string): string {
  const canonical = normalizeIndianPhone(phone)
  if (canonical === null) return phone

  const digits = canonical.slice(-10)
  return `${digits.slice(0, 5)} ${digits.slice(5)}`
}
