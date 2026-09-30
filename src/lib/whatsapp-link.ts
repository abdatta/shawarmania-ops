import { formatPaise } from '@/domain'

/**
 * A WhatsApp click-to-chat link: the bill's own number, the message typed.
 *
 * `https://wa.me/<number>?text=<message>` opens WhatsApp in a chat with any
 * number, saved to the phone or not, with the message in the compose field.
 * **It sends nothing.** The person still taps Send in WhatsApp, which is the
 * point: they see whose chat it is before anything leaves.
 *
 * `wa.me` rather than `whatsapp://send`, because the scheme fails silently on a
 * laptop or a tablet without the app, where `wa.me` falls back to WhatsApp Web
 * (a-receipt-goes-out-on-whatsapp, design D2).
 */

/** The canonical form `normalizeIndianPhone` produces, and nothing else. */
const CANONICAL_PHONE = /^\+91[6-9][0-9]{9}$/

/**
 * Takes the canonical `+91XXXXXXXXXX` only, and throws on anything else.
 *
 * `wa.me` wants the international number with no `+`, which is the canonical
 * form less its first character. Accepting a raw bill value here and cleaning
 * it up would be a guess, and a guessed digit sends a stranger somebody's bill,
 * so normalising is the caller's job and a raw value is a programming error.
 */
export function whatsappChatLink(canonicalPhone: string, message: string): string {
  if (!CANONICAL_PHONE.test(canonicalPhone)) {
    throw new Error('whatsappChatLink needs a canonical +91 mobile number')
  }
  return `https://wa.me/${canonicalPhone.slice(1)}?text=${encodeURIComponent(message)}`
}

/**
 * What the customer reads. Transactional only: no offer, no points prompt, and
 * no name, because bills rung before customer identification carry placeholder
 * names a biller typed to get past a rule. The link goes last, on its own line,
 * so WhatsApp builds its preview card from it.
 *
 * One function, so the owner's wording changes in one place.
 */
export function receiptMessage({
  billNumber,
  totalPaise,
  receiptUrl,
}: {
  billNumber: number
  totalPaise: number
  receiptUrl: string
}): string {
  return [
    'Thanks for visiting Shawarmania!',
    `Your bill ${billNumber} for ${formatPaise(totalPaise)}:`,
    receiptUrl,
  ].join('\n')
}
