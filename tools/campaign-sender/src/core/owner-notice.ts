/**
 * Owner notices: a short WhatsApp from the business account to the owner's
 * own phone, asked for by another program on this laptop (the daily Google
 * review task is the first). It rides the sender's one connection, because a
 * second connection on the same login would push the sender off WhatsApp.
 *
 * It is not a way to message customers, and three things keep it that way:
 *
 * - a notice goes only to a number written in `notice-recipients.txt` in the
 *   sender's folder, by a person, one per line. No file, no notices;
 * - a caller needs the token in `notice-token` in the same folder, which only
 *   someone who can already read the WhatsApp login can read;
 * - it answers on `127.0.0.1` only, through the control page's server.
 *
 * Numbers are never printed whole; the text of a notice is never logged.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { LinkConnection, WhatsAppLink } from './contracts.ts'
import { fullPhoneNumber } from './phone-number.ts'

/** Longer than any report needs, short enough that nothing bulk fits. */
export const NOTICE_MOST_CHARS = 4000

export function noticeRecipientsPath(folder: string): string {
  return join(folder, 'notice-recipients.txt')
}

export function noticeTokenPath(folder: string): string {
  return join(folder, 'notice-token')
}

/** The allowed numbers, as digits. Blank lines and `#` comments are skipped. */
export function parseNoticeRecipients(text: string): string[] {
  const out: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim()
    if (!line) continue
    const phone = fullPhoneNumber(line)
    if (phone.ok && !out.includes(phone.digits)) out.push(phone.digits)
  }
  return out
}

export function readNoticeRecipients(folder: string): string[] {
  try {
    return parseNoticeRecipients(readFileSync(noticeRecipientsPath(folder), 'utf8'))
  } catch {
    return []
  }
}

/** The token callers send; made once and kept, so a caller survives a restart. */
export function noticeToken(folder: string): string {
  try {
    const kept = readFileSync(noticeTokenPath(folder), 'utf8').trim()
    if (kept.length >= 32) return kept
  } catch {
    // Not made yet.
  }
  const made = randomBytes(32).toString('base64url')
  writeFileSync(noticeTokenPath(folder), made, { encoding: 'utf8', mode: 0o600 })
  return made
}

export function tokenMatches(given: unknown, expected: string): boolean {
  if (typeof given !== 'string') return false
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export interface NoticeRequest {
  /** One of the allowed numbers; the first one when left out. */
  to?: string
  text: string
}

export type NoticeOutcome =
  | { ok: true; status: 200; message: string; id: string }
  | { ok: false; status: 400 | 403 | 503; message: string }

/** Keeps the connection the sender is holding, for a notice to use. */
export function tappedLink(link: WhatsAppLink): {
  link: WhatsAppLink
  current: () => LinkConnection | null
} {
  let current: LinkConnection | null = null
  return {
    current: () => current,
    link: {
      hold: (handlers, signal) =>
        link.hold(
          {
            onOpen: (connection) => {
              current = connection
              handlers.onOpen(connection)
            },
            onClose: () => {
              current = null
              handlers.onClose()
            },
          },
          signal,
        ),
    },
  }
}

/** Checks a notice and, if it may go, sends it on the connection held now. */
export async function sendNotice(
  body: unknown,
  allowed: string[],
  connection: LinkConnection | null,
): Promise<NoticeOutcome> {
  const request = body as Partial<NoticeRequest> | null
  const text = typeof request?.text === 'string' ? request.text.trim() : ''
  if (!text) return { ok: false, status: 400, message: 'A notice needs text.' }
  if (text.length > NOTICE_MOST_CHARS) {
    return {
      ok: false,
      status: 400,
      message: `A notice is at most ${NOTICE_MOST_CHARS} characters.`,
    }
  }
  if (allowed.length === 0) {
    return { ok: false, status: 403, message: 'No notice recipients are set on this laptop.' }
  }
  let to = allowed[0] as string
  if (request?.to !== undefined) {
    const phone = typeof request.to === 'string' ? fullPhoneNumber(request.to) : null
    if (!phone?.ok || !allowed.includes(phone.digits)) {
      return { ok: false, status: 403, message: 'That number is not a notice recipient.' }
    }
    to = phone.digits
  }
  if (!connection) {
    return { ok: false, status: 503, message: 'Not connected to WhatsApp right now.' }
  }
  const address = await connection.resolve(to)
  if (!address) return { ok: false, status: 400, message: 'That number is not on WhatsApp.' }
  const id = await connection.send(address, { text })
  return { ok: true, status: 200, message: 'Sent.', id }
}
