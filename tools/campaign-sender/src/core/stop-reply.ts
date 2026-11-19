/**
 * A customer's reply of STOP (design D11, task 4.2a).
 *
 * WhatsApp hands a linked device every message the account receives. The
 * sender looks at an incoming message for one thing only: is it, whole, the
 * word STOP? Anything else is dropped unread, and nothing is ever kept. Only
 * for a STOP does it work out the sender's phone number, which it passes to
 * the database (`campaign_record_stop`), and the database decides whether that
 * number is a customer who was sent a campaign in the last thirty days.
 *
 * Version 7 of Baileys names a sender by phone number or by LID, with the
 * phone-number form in an alternate field when the first is a LID (design,
 * *Baileys as found*). The database takes a phone number, never a LID.
 *
 * Text in, text out: nothing here reads a socket or a file.
 */

/** The whole message, trimmed, in any letter case. "Stop please" is not a stop. */
export function isStopReply(text: string | null | undefined): boolean {
  return typeof text === 'string' && text.trim().toLowerCase() === 'stop'
}

/** `919812345678@s.whatsapp.net` or `919812345678:3@s.whatsapp.net` → `919812345678`. */
export function phoneOfJid(jid: string | null | undefined): string | null {
  const match = /^(\d{8,15})(?::\d+)?@s\.whatsapp\.net$/.exec(jid ?? '')
  return match?.[1] ?? null
}

export function isLidJid(jid: string | null | undefined): boolean {
  return typeof jid === 'string' && jid.endsWith('@lid')
}

export interface IncomingKey {
  remoteJid?: string | null
  remoteJidAlt?: string | null
  fromMe?: boolean | null
}

/**
 * Whose message it is, as a phone number, when the message says so itself: a
 * one-to-one chat named by number, or by LID with the number beside it. Null
 * for the account's own messages, groups, broadcasts, and a LID with no number
 * beside it, which the caller may still look up in Baileys' mapping.
 */
export function senderPhone(key: IncomingKey): string | null {
  if (key.fromMe) return null
  return (
    phoneOfJid(key.remoteJid) ?? (isLidJid(key.remoteJid) ? phoneOfJid(key.remoteJidAlt) : null)
  )
}
