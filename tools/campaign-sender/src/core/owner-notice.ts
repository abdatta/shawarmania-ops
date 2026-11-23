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
 *
 * Every notice sent is written to `notices.jsonl` in the same folder (its
 * WhatsApp id, the number, the address and its first line), so it can be
 * deleted for everyone or edited later. Only a notice in that file can be:
 * a campaign message, or anything else, cannot be named.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
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
  | { ok: true; status: 200; message: string; id: string; to: string; address: string }
  | { ok: false; status: 400 | 403 | 503; message: string }

// ── The notice log: what this sender sent, so it can be deleted or edited ──

/**
 * WhatsApp's own limits, kept a little inside them: an edit within 15
 * minutes of sending, a delete for everyone within about two and a half days.
 */
export const NOTICE_EDIT_WINDOW_MS = 15 * 60 * 1000
export const NOTICE_DELETE_WINDOW_MS = 2 * 24 * 60 * 60 * 1000

export function noticeLogPath(folder: string): string {
  return join(folder, 'notices.jsonl')
}

/** One line of `notices.jsonl`. `head` is the notice's first line, for telling them apart. */
export type NoticeLogLine =
  | { kind: 'sent'; at: string; id: string; to: string; address: string; head: string }
  | { kind: 'deleted'; at: string; id: string }
  | { kind: 'edited'; at: string; id: string; head: string }

export interface NoticeRecord {
  id: string
  to: string
  address: string
  sentAt: string
  head: string
  deletedAt?: string
  editedAt?: string
}

export function headOf(text: string): string {
  return (text.split(/\r?\n/)[0] ?? '').slice(0, 80)
}

export function appendNoticeLog(folder: string, line: NoticeLogLine): void {
  appendFileSync(noticeLogPath(folder), `${JSON.stringify(line)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })
}

/** The log folded into one record per message, oldest first. Unreadable lines are skipped. */
export function foldNoticeLog(text: string): NoticeRecord[] {
  const byId = new Map<string, NoticeRecord>()
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue
    let line: NoticeLogLine
    try {
      line = JSON.parse(raw) as NoticeLogLine
    } catch {
      continue
    }
    if (typeof line?.id !== 'string') continue
    if (line.kind === 'sent') {
      byId.set(line.id, {
        id: line.id,
        to: line.to,
        address: line.address,
        sentAt: line.at,
        head: line.head,
      })
    } else {
      const record = byId.get(line.id)
      if (!record) continue
      if (line.kind === 'deleted') record.deletedAt = line.at
      if (line.kind === 'edited') {
        record.editedAt = line.at
        record.head = line.head
      }
    }
  }
  return [...byId.values()]
}

export function readNoticeLog(folder: string): NoticeRecord[] {
  try {
    return foldNoticeLog(readFileSync(noticeLogPath(folder), 'utf8'))
  } catch {
    return []
  }
}

/** `last` is the newest notice still standing; otherwise an id, or a unique start of one. */
export function pickNotice(records: NoticeRecord[], ref: unknown): NoticeRecord | null {
  if (typeof ref !== 'string' || ref.trim().length === 0) return null
  const wanted = ref.trim()
  if (wanted === 'last') {
    return [...records].reverse().find((record) => !record.deletedAt) ?? null
  }
  const exact = records.find((record) => record.id === wanted)
  if (exact) return exact
  if (wanted.length < 6) return null
  const starts = records.filter((record) => record.id.startsWith(wanted))
  return starts.length === 1 ? (starts[0] as NoticeRecord) : null
}

export type NoticeChangeOutcome =
  | { ok: true; status: 200; message: string; id: string }
  | { ok: false; status: 400 | 404 | 409 | 503; message: string }

/** Deletes, for everyone, one notice this sender sent. Nothing else can be named. */
export async function deleteNotice(
  body: unknown,
  records: NoticeRecord[],
  connection: LinkConnection | null,
  now: number,
): Promise<NoticeChangeOutcome> {
  const record = pickNotice(records, (body as { id?: unknown } | null)?.id)
  if (!record) return { ok: false, status: 404, message: 'No notice this sender sent has that id.' }
  if (record.deletedAt)
    return { ok: false, status: 409, message: 'That notice is already deleted.' }
  if (now - Date.parse(record.sentAt) > NOTICE_DELETE_WINDOW_MS) {
    return {
      ok: false,
      status: 409,
      message: 'Too old: WhatsApp deletes for everyone only within about two days.',
    }
  }
  if (!connection?.revoke) {
    return { ok: false, status: 503, message: 'Not connected to WhatsApp right now.' }
  }
  await connection.revoke(record.address, record.id)
  return { ok: true, status: 200, message: 'Deleted for everyone.', id: record.id }
}

/** Replaces the text of one notice this sender sent, within WhatsApp's edit window. */
export async function editNotice(
  body: unknown,
  records: NoticeRecord[],
  connection: LinkConnection | null,
  now: number,
): Promise<NoticeChangeOutcome> {
  const request = body as { id?: unknown; text?: unknown } | null
  const text = typeof request?.text === 'string' ? request.text.trim() : ''
  if (!text) return { ok: false, status: 400, message: 'An edit needs the new text.' }
  if (text.length > NOTICE_MOST_CHARS) {
    return {
      ok: false,
      status: 400,
      message: `A notice is at most ${NOTICE_MOST_CHARS} characters.`,
    }
  }
  const record = pickNotice(records, request?.id)
  if (!record) return { ok: false, status: 404, message: 'No notice this sender sent has that id.' }
  if (record.deletedAt) return { ok: false, status: 409, message: 'That notice is deleted.' }
  if (now - Date.parse(record.sentAt) > NOTICE_EDIT_WINDOW_MS) {
    return {
      ok: false,
      status: 409,
      message: 'Too old: WhatsApp allows an edit only within 15 minutes.',
    }
  }
  if (!connection?.edit) {
    return { ok: false, status: 503, message: 'Not connected to WhatsApp right now.' }
  }
  await connection.edit(record.address, record.id, text)
  return { ok: true, status: 200, message: 'Edited.', id: record.id }
}

/** The newest notices, for the list command: never the address, only the number's last four. */
export function listNotices(records: NoticeRecord[], now: number, most = 30): unknown[] {
  return [...records]
    .reverse()
    .slice(0, most)
    .map((record) => {
      const age = now - Date.parse(record.sentAt)
      return {
        id: record.id,
        sentAt: record.sentAt,
        to: `••••${record.to.slice(-4)}`,
        head: record.head,
        deleted: Boolean(record.deletedAt),
        edited: Boolean(record.editedAt),
        canEdit: !record.deletedAt && age <= NOTICE_EDIT_WINDOW_MS,
        canDelete: !record.deletedAt && age <= NOTICE_DELETE_WINDOW_MS,
      }
    })
}

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
  return { ok: true, status: 200, message: 'Sent.', id, to, address }
}
