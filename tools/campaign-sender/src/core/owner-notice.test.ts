import { describe, expect, it } from 'vitest'

import type { LinkConnection, OutgoingMessage } from './contracts.ts'
import {
  deleteNotice,
  editNotice,
  foldNoticeLog,
  listNotices,
  parseNoticeRecipients,
  pickNotice,
  sendNotice,
  tokenMatches,
  NOTICE_DELETE_WINDOW_MS,
  NOTICE_EDIT_WINDOW_MS,
  NOTICE_MOST_CHARS,
} from './owner-notice.ts'

function fakeConnection(onWhatsApp = true) {
  const sent: Array<{ address: string; message: OutgoingMessage }> = []
  const connection: LinkConnection = {
    resolve: async (digits) => (onWhatsApp ? `${digits}@s.whatsapp.net` : null),
    send: async (address, message) => {
      sent.push({ address, message })
      return 'id-1'
    },
    onReceipt: () => {},
  }
  return { connection, sent }
}

describe('owner notices', () => {
  it('reads recipients one per line, skipping comments, blanks and bad numbers', () => {
    expect(
      parseNoticeRecipients('# owner\n+1 213 555 0199\n\n9812345678\n919812345678 # shop\n'),
    ).toEqual(['12135550199', '919812345678'])
  })

  it('compares the token exactly', () => {
    expect(tokenMatches('abc', 'abc')).toBe(true)
    expect(tokenMatches('abd', 'abc')).toBe(false)
    expect(tokenMatches(undefined, 'abc')).toBe(false)
    expect(tokenMatches(['abc'], 'abc')).toBe(false)
  })

  it('sends to the first recipient when none is named', async () => {
    const { connection, sent } = fakeConnection()
    const outcome = await sendNotice({ text: 'Hello' }, ['12135550199'], connection)
    expect(outcome.ok).toBe(true)
    expect(sent).toEqual([{ address: '12135550199@s.whatsapp.net', message: { text: 'Hello' } }])
  })

  it('refuses any number not on the list, and sends nothing', async () => {
    const { connection, sent } = fakeConnection()
    const outcome = await sendNotice(
      { to: '919800000000', text: 'Hi' },
      ['12135550199'],
      connection,
    )
    expect(outcome).toMatchObject({ ok: false, status: 403 })
    expect(sent).toEqual([])
  })

  it('refuses when no recipients are set', async () => {
    const { connection, sent } = fakeConnection()
    expect(await sendNotice({ text: 'Hi' }, [], connection)).toMatchObject({ status: 403 })
    expect(sent).toEqual([])
  })

  it('refuses empty or overlong text', async () => {
    const { connection } = fakeConnection()
    expect(await sendNotice({ text: '  ' }, ['12135550199'], connection)).toMatchObject({
      status: 400,
    })
    expect(
      await sendNotice({ text: 'x'.repeat(NOTICE_MOST_CHARS + 1) }, ['12135550199'], connection),
    ).toMatchObject({ status: 400 })
  })

  it('says so when not connected', async () => {
    expect(await sendNotice({ text: 'Hi' }, ['12135550199'], null)).toMatchObject({ status: 503 })
  })

  it('says which number and address a sent notice went to, for the log', async () => {
    const { connection } = fakeConnection()
    expect(await sendNotice({ text: 'Hi' }, ['12135550199'], connection)).toMatchObject({
      ok: true,
      id: 'id-1',
      to: '12135550199',
      address: '12135550199@s.whatsapp.net',
    })
  })
})

describe('owner notices, deleted and edited later', () => {
  const T0 = Date.parse('2026-11-23T18:00:00.000Z')
  const minutes = (n: number) => n * 60 * 1000
  const log = [
    {
      kind: 'sent',
      at: '2026-11-23T18:00:00.000Z',
      id: '3EB0AAAA1111',
      to: '12135550199',
      address: 'a@s.whatsapp.net',
      head: 'first',
    },
    {
      kind: 'sent',
      at: '2026-11-23T18:00:00.000Z',
      id: '3EB0BBBB2222',
      to: '919812345678',
      address: 'b@s.whatsapp.net',
      head: 'second',
    },
    'not json',
    { kind: 'deleted', at: '2026-11-23T18:01:00.000Z', id: 'unknown-id' },
  ]
    .map((line) => (typeof line === 'string' ? line : JSON.stringify(line)))
    .join('\n')

  function changing() {
    const calls: string[] = []
    const connection: LinkConnection = {
      resolve: async () => null,
      send: async () => 'x',
      onReceipt: () => {},
      revoke: async (address, id) => {
        calls.push(`revoke ${address} ${id}`)
      },
      edit: async (address, id, text) => {
        calls.push(`edit ${address} ${id} ${text}`)
      },
    }
    return { connection, calls }
  }

  it('folds the log into one record per message, skipping bad and unknown lines', () => {
    const records = foldNoticeLog(log)
    expect(records.map((record) => record.id)).toEqual(['3EB0AAAA1111', '3EB0BBBB2222'])
    const deleted = foldNoticeLog(
      `${log}\n${JSON.stringify({ kind: 'deleted', at: '2026-11-23T18:02:00.000Z', id: '3EB0BBBB2222' })}`,
    )
    expect(deleted[1]?.deletedAt).toBe('2026-11-23T18:02:00.000Z')
  })

  it('picks by whole id, a unique start of one, or last still standing', () => {
    const records = foldNoticeLog(log)
    expect(pickNotice(records, '3EB0AAAA1111')?.head).toBe('first')
    expect(pickNotice(records, '3EB0BB')?.head).toBe('second')
    expect(pickNotice(records, '3EB0')).toBeNull()
    expect(pickNotice(records, '3EB0A')).toBeNull()
    expect(pickNotice(records, 'last')?.head).toBe('second')
    records[1]!.deletedAt = 'x'
    expect(pickNotice(records, 'last')?.head).toBe('first')
  })

  it('deletes only a notice in the log, at the address it went to', async () => {
    const { connection, calls } = changing()
    const records = foldNoticeLog(log)
    expect(await deleteNotice({ id: 'someone-elses' }, records, connection, T0)).toMatchObject({
      status: 404,
    })
    expect(await deleteNotice({ id: '3EB0BB' }, records, connection, T0)).toMatchObject({
      ok: true,
      id: '3EB0BBBB2222',
    })
    expect(calls).toEqual(['revoke b@s.whatsapp.net 3EB0BBBB2222'])
  })

  it('refuses to delete one already deleted or past WhatsApp’s window', async () => {
    const { connection, calls } = changing()
    const records = foldNoticeLog(log)
    records[0]!.deletedAt = 'x'
    expect(await deleteNotice({ id: '3EB0AAAA1111' }, records, connection, T0)).toMatchObject({
      status: 409,
    })
    const late = T0 + NOTICE_DELETE_WINDOW_MS + 1
    expect(await deleteNotice({ id: '3EB0BBBB2222' }, records, connection, late)).toMatchObject({
      status: 409,
    })
    expect(calls).toEqual([])
  })

  it('edits within 15 minutes and not after', async () => {
    const { connection, calls } = changing()
    const records = foldNoticeLog(log)
    expect(
      await editNotice({ id: 'last', text: 'better' }, records, connection, T0 + minutes(5)),
    ).toMatchObject({ ok: true })
    expect(
      await editNotice(
        { id: 'last', text: 'later' },
        records,
        connection,
        T0 + NOTICE_EDIT_WINDOW_MS + 1,
      ),
    ).toMatchObject({ status: 409 })
    expect(await editNotice({ id: 'last', text: ' ' }, records, connection, T0)).toMatchObject({
      status: 400,
    })
    expect(calls).toEqual(['edit b@s.whatsapp.net 3EB0BBBB2222 better'])
  })

  it('says so when the connection cannot delete or edit', async () => {
    const { connection } = fakeConnection()
    const records = foldNoticeLog(log)
    expect(await deleteNotice({ id: 'last' }, records, connection, T0)).toMatchObject({
      status: 503,
    })
    expect(await editNotice({ id: 'last', text: 'x' }, records, null, T0)).toMatchObject({
      status: 503,
    })
  })

  it('lists newest first, with the number shortened and what can still be done', () => {
    const listed = listNotices(foldNoticeLog(log), T0 + minutes(20)) as Array<
      Record<string, unknown>
    >
    expect(listed[0]).toMatchObject({
      id: '3EB0BBBB2222',
      to: '••••5678',
      canEdit: false,
      canDelete: true,
    })
    expect(JSON.stringify(listed)).not.toContain('s.whatsapp.net')
  })
})
