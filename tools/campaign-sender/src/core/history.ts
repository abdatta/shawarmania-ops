/**
 * The sender's history page, made ready to show
 * (a-campaign-goes-out-on-whatsapp, design *The sender's history*).
 *
 * The owner asked, on 2026-11-21, to see on the laptop what has gone through
 * the sender, tests included, and what is still to come. Three lists:
 *
 * - **Coming up**: tests still to go, then every batch not yet done of a
 *   campaign still going, saying what each waits for.
 * - **Sent**: every message the laptop picked up, newest first, with the
 *   customer's saved name and **whole number** [owner, decision 17], and how
 *   it ended, the receipts included.
 * - **Diary**: what happened to the sender itself (`diary.ts`).
 *
 * The first two are read from the database (`campaign_sender_history`), so they
 * are complete and agree with the app; only the diary is the laptop's own.
 * This turns that answer into rows of plain sentences, so the page does no
 * more than place text. A row it cannot make sense of is left out rather than
 * shown wrong.
 */

import type { DiaryEntry, DiaryTone } from './diary.ts'

export interface HistoryRowComing {
  title: string
  detail: string
}

export interface HistoryRowSent {
  when: string
  who: string
  what: string
  outcome: string
  tone: DiaryTone
}

export interface HistoryRowDiary {
  when: string
  text: string
  tone: DiaryTone
}

export interface HistoryView {
  comingUp: HistoryRowComing[]
  sent: HistoryRowSent[]
  diary: HistoryRowDiary[]
}

export interface HistoryContext {
  now: number
  /** An instant as the owner reads a time: the time today, the date as well before today. */
  clockText: (ms: number) => string
}

type Row = Record<string, unknown>

function rows(value: unknown): Row[] {
  return Array.isArray(value)
    ? value.filter((row): row is Row => typeof row === 'object' && row !== null)
    : []
}

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null)
const count = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
const instant = (value: unknown): number | null => {
  const ms = typeof value === 'string' ? Date.parse(value) : Number.NaN
  return Number.isNaN(ms) ? null : ms
}

/** `+91 90000 00901` for an Indian mobile, `+1 2135550142` for a US one, anything else as stored. */
export function phoneForPeople(phone: string): string {
  const india = /^\+91([6-9]\d{4})(\d{5})$/.exec(phone)
  if (india) return `+91 ${india[1]} ${india[2]}`
  const us = /^\+1(\d{10})$/.exec(phone)
  if (us) return `+1 ${us[1]}`
  return phone
}

const quoted = (name: string) => `“${name}”`

function comingUp(raw: Row): HistoryRowComing[] {
  const tests = rows(raw['tests_waiting']).flatMap((row) => {
    const campaign = text(row['campaign_name'])
    const phone = text(row['phone'])
    if (!campaign || !phone) return []
    return [
      {
        title: `Test to ${phoneForPeople(phone)}`,
        detail: `${quoted(campaign)} · goes by itself, no press needed`,
      },
    ]
  })
  const batches = rows(raw['batches_ahead']).flatMap((row) => {
    const campaign = text(row['campaign_name'])
    const batchNo = count(row['batch_no'])
    const recipients = count(row['recipients'])
    const toGo = count(row['to_go'])
    if (!campaign || batchNo === null || recipients === null || toGo === null) return []
    const paused = row['campaign_state'] === 'paused'
    const released = row['state'] === 'released'
    const size = released ? `${toGo} of ${recipients} still to go` : `${recipients} people`
    const waitsFor = paused ? 'campaign paused' : released ? 'released' : 'waiting for Send batch'
    return [{ title: `Batch ${batchNo} of ${quoted(campaign)}`, detail: `${size} · ${waitsFor}` }]
  })
  return [...tests, ...batches]
}

function outcomeOf(row: Row): { outcome: string; tone: DiaryTone } | null {
  switch (row['state']) {
    case 'sent':
      if (row['read_at']) return { outcome: 'Read', tone: 'good' }
      if (row['delivered_at']) return { outcome: 'Delivered', tone: 'good' }
      return { outcome: 'Sent', tone: 'plain' }
    case 'sending':
      return { outcome: 'Sending now', tone: 'plain' }
    case 'not_on_whatsapp':
      return { outcome: 'Not on WhatsApp', tone: 'warn' }
    case 'unsure':
      return { outcome: 'Unsure: may or may not have gone', tone: 'warn' }
    case 'failed': {
      const code = text(row['failure_code'])
      return { outcome: code ? `Failed (${code})` : 'Failed', tone: 'alarm' }
    }
    default:
      return null
  }
}

function sent(raw: Row, context: HistoryContext): HistoryRowSent[] {
  return rows(raw['sent']).flatMap((row) => {
    const at = instant(row['at'])
    const campaign = text(row['campaign_name'])
    const phone = text(row['phone'])
    const ended = outcomeOf(row)
    if (at === null || !campaign || !phone || !ended) return []
    const test = row['kind'] === 'test'
    const batchNo = count(row['batch_no'])
    const name = test ? 'Test number' : (text(row['name']) ?? 'No saved name')
    return [
      {
        when: context.clockText(at),
        who: `${name} · ${phoneForPeople(phone)}`,
        what: `${quoted(campaign)} · ${test || batchNo === null ? 'test' : `batch ${batchNo}`}`,
        ...ended,
      },
    ]
  })
}

export function shapeHistory(
  raw: unknown,
  diary: readonly DiaryEntry[],
  context: HistoryContext,
): HistoryView {
  const answer = typeof raw === 'object' && raw !== null ? (raw as Row) : {}
  return {
    comingUp: comingUp(answer),
    sent: sent(answer, context),
    diary: diary.map((entry) => ({
      when: context.clockText(Date.parse(entry.at)),
      text: entry.text,
      tone: entry.tone,
    })),
  }
}
