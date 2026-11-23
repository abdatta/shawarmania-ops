import { describe, expect, it } from 'vitest'

import type { LinkConnection, OutgoingMessage } from './contracts.ts'
import { parseNoticeRecipients, sendNotice, tokenMatches, NOTICE_MOST_CHARS } from './owner-notice.ts'

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
    const outcome = await sendNotice({ to: '919800000000', text: 'Hi' }, ['12135550199'], connection)
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
    expect(await sendNotice({ text: '  ' }, ['12135550199'], connection)).toMatchObject({ status: 400 })
    expect(
      await sendNotice({ text: 'x'.repeat(NOTICE_MOST_CHARS + 1) }, ['12135550199'], connection),
    ).toMatchObject({ status: 400 })
  })

  it('says so when not connected', async () => {
    expect(await sendNotice({ text: 'Hi' }, ['12135550199'], null)).toMatchObject({ status: 503 })
  })
})
