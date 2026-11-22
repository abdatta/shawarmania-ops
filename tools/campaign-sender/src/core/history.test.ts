// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { DIARY_KEEP, diaryLine, readDiary, trimDiary } from './diary.ts'
import { phoneForPeople, shapeHistory } from './history.ts'

describe('the diary', () => {
  it('reads back newest first, as many as asked for', () => {
    const text =
      diaryLine({ at: '2026-11-21T06:00:00.000Z', tone: 'plain', text: 'Started.' }) +
      diaryLine({ at: '2026-11-21T06:01:00.000Z', tone: 'good', text: 'Connected as ••4778.' }) +
      diaryLine({ at: '2026-11-21T06:02:00.000Z', tone: 'warn', text: 'Connection lost.' })
    expect(readDiary(text, 2).map((entry) => entry.text)).toEqual([
      'Connection lost.',
      'Connected as ••4778.',
    ])
  })

  it('skips a line it cannot read, such as one cut off by a power cut', () => {
    const text =
      diaryLine({ at: '2026-11-21T06:00:00.000Z', tone: 'plain', text: 'Started.' }) +
      '{"at":"2026-11-21T06:01'
    expect(readDiary(text, 10)).toEqual([
      { at: '2026-11-21T06:00:00.000Z', tone: 'plain', text: 'Started.' },
    ])
  })

  it('keeps the newest lines once it has grown past what it keeps', () => {
    const lines = Array.from({ length: DIARY_KEEP * 2 }, (_, i) =>
      diaryLine({
        at: new Date(Date.UTC(2026, 10, 1) + i * 1000).toISOString(),
        tone: 'plain',
        text: `n${i}`,
      }),
    ).join('')
    const trimmed = trimDiary(lines)
    expect(trimmed).not.toBeNull()
    const kept = readDiary(trimmed as string, DIARY_KEEP + 10)
    expect(kept).toHaveLength(DIARY_KEEP)
    expect(kept[0]?.text).toBe(`n${DIARY_KEEP * 2 - 1}`)
    // Small enough already: left as it is.
    expect(trimDiary(lines.split('\n').slice(0, 10).join('\n'))).toBeNull()
  })
})

const RAW = {
  server_now: '2026-11-21T07:00:00+00:00',
  tests_waiting: [
    {
      campaign_name: 'Diwali Offer',
      phone: '+919000000901',
      queued_at: '2026-11-21T06:55:00+00:00',
    },
  ],
  batches_ahead: [
    {
      campaign_id: 'c1',
      campaign_name: 'Diwali Offer',
      campaign_state: 'scheduled',
      batch_no: 1,
      state: 'waiting',
      recipients: 100,
      to_go: 100,
    },
    {
      campaign_id: 'c1',
      campaign_name: 'Diwali Offer',
      campaign_state: 'scheduled',
      batch_no: 2,
      state: 'released',
      recipients: 100,
      to_go: 53,
    },
    {
      campaign_id: 'c2',
      campaign_name: 'Monsoon',
      campaign_state: 'paused',
      batch_no: 4,
      state: 'released',
      recipients: 100,
      to_go: 20,
    },
  ],
  sent: [
    {
      kind: 'customer',
      at: '2026-11-21T06:50:00+00:00',
      campaign_name: 'Diwali Offer',
      batch_no: 1,
      name: 'Asha Roy',
      phone: '+919000000901',
      state: 'sent',
      delivered_at: '2026-11-21T06:50:05+00:00',
      read_at: '2026-11-21T06:52:00+00:00',
      failure_code: null,
    },
    {
      kind: 'customer',
      at: '2026-11-21T06:49:00+00:00',
      campaign_name: 'Diwali Offer',
      batch_no: 1,
      name: null,
      phone: '+919000000123',
      state: 'not_on_whatsapp',
      delivered_at: null,
      read_at: null,
      failure_code: null,
    },
    {
      kind: 'customer',
      at: '2026-11-21T06:48:00+00:00',
      campaign_name: 'Diwali Offer',
      batch_no: 1,
      name: 'Asha',
      phone: '+919000000124',
      state: 'failed',
      delivered_at: null,
      read_at: null,
      failure_code: '463',
    },
    {
      kind: 'test',
      at: '2026-11-21T02:39:54+00:00',
      campaign_name: 'Diwali Offer',
      batch_no: null,
      name: null,
      phone: '+12135550142',
      state: 'sent',
      delivered_at: null,
      read_at: null,
      failure_code: null,
    },
  ],
}

describe('the history, made ready to show', () => {
  const view = shapeHistory(RAW, [], {
    now: Date.parse('2026-11-21T07:00:00Z'),
    clockText: () => '12:30',
  })

  it('puts what is coming up first: tests, then each batch by what it waits for', () => {
    expect(view.comingUp).toEqual([
      {
        title: 'Test to +91 90000 00901',
        detail: '“Diwali Offer” · goes by itself, no press needed',
      },
      { title: 'Batch 1 of “Diwali Offer”', detail: '100 people · waiting for Send batch' },
      { title: 'Batch 2 of “Diwali Offer”', detail: '53 of 100 still to go · released' },
      { title: 'Batch 4 of “Monsoon”', detail: '20 of 100 still to go · campaign paused' },
    ])
  })

  it('lists what went, newest first, with whole numbers and how each ended', () => {
    expect(view.sent).toEqual([
      {
        when: '12:30',
        who: 'Asha Roy · +91 90000 00901',
        what: '“Diwali Offer” · batch 1',
        outcome: 'Read',
        tone: 'good',
      },
      {
        when: '12:30',
        who: 'No saved name · +91 90000 00123',
        what: '“Diwali Offer” · batch 1',
        outcome: 'Not on WhatsApp',
        tone: 'warn',
      },
      {
        when: '12:30',
        who: 'Asha · +91 90000 00124',
        what: '“Diwali Offer” · batch 1',
        outcome: 'Failed (463)',
        tone: 'alarm',
      },
      {
        when: '12:30',
        who: 'Test number · +1 2135550142',
        what: '“Diwali Offer” · test',
        outcome: 'Sent',
        tone: 'plain',
      },
    ])
  })

  it('says delivered before read, and sent before either', () => {
    const one = (over: Record<string, unknown>) =>
      shapeHistory({ ...RAW, sent: [{ ...RAW.sent[0], ...over }] }, [], {
        now: 0,
        clockText: () => '',
      }).sent[0]?.outcome
    expect(one({ read_at: null })).toBe('Delivered')
    expect(one({ read_at: null, delivered_at: null })).toBe('Sent')
    expect(one({ state: 'unsure', read_at: null, delivered_at: null })).toBe(
      'Unsure: may or may not have gone',
    )
    expect(one({ state: 'sending', read_at: null, delivered_at: null })).toBe('Sending now')
  })

  it('carries the diary through, and says nothing is planned when nothing is', () => {
    const quiet = shapeHistory(
      { server_now: RAW.server_now, tests_waiting: [], batches_ahead: [], sent: [] },
      [{ at: '2026-11-21T06:00:00.000Z', tone: 'good', text: 'Connected.' }],
      { now: 0, clockText: () => '11:30' },
    )
    expect(quiet.comingUp).toEqual([])
    expect(quiet.sent).toEqual([])
    expect(quiet.diary).toEqual([{ when: '11:30', text: 'Connected.', tone: 'good' }])
  })

  it('drops a row it does not understand rather than show it wrong', () => {
    const odd = shapeHistory(
      { ...RAW, sent: [{ kind: 'customer', at: 'not a time' }, 7, null], tests_waiting: 'x' },
      [],
      { now: 0, clockText: () => '' },
    )
    expect(odd.sent).toEqual([])
    expect(odd.comingUp).toHaveLength(3)
    expect(shapeHistory(null, [], { now: 0, clockText: () => '' }).sent).toEqual([])
  })
})

describe('a whole number, written for a person', () => {
  it('groups an Indian number the way it is said', () => {
    expect(phoneForPeople('+919000000901')).toBe('+91 90000 00901')
  })
  it('splits off the US code, and leaves any other country as it is', () => {
    expect(phoneForPeople('+12135550142')).toBe('+1 2135550142')
    expect(phoneForPeople('+447700900123')).toBe('+447700900123')
  })
})
