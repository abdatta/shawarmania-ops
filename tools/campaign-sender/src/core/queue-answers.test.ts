// @vitest-environment node
import { describe, expect, it } from 'vitest'

import {
  QueueAnswerUnreadable,
  readClaim,
  readFinishNotices,
  readMessageIds,
  readTestClaim,
  readTick,
  receiptArguments,
  reportArguments,
} from './queue-answers.ts'

// Answers as `campaign_sender_tick` and the claims give them: the shapes the
// pgTAP files `99_a_campaign_goes_out_on_whatsapp.sql` and
// `99_campaign_test_numbers.sql` hold the database to.
const TICK = {
  contract_version: 1,
  stand_down: false,
  min_gap_seconds: 45,
  max_gap_seconds: 90,
  window: { open: false, opens_at: '2026-11-19T04:30:00+00:00' },
  released: null,
  waiting_for_release: {
    campaign_id: 'c1',
    batch_no: 2,
    campaign_name: 'Diwali offer',
    recipients: 100,
  },
  campaigns_open: true,
  sent_today: 7,
  last_batch_finished_at: '2026-11-18T12:00:00.123+00:00',
  tests_waiting: 1,
}

describe('the database’s tick, as the loop reads it', () => {
  it('reads every field, the instants included', () => {
    expect(readTick(TICK)).toEqual({
      contractVersion: 1,
      standDown: false,
      minGapSeconds: 45,
      maxGapSeconds: 90,
      window: { open: false, opensAt: new Date('2026-11-19T04:30:00Z') },
      released: null,
      waitingForRelease: {
        campaignId: 'c1',
        batchNo: 2,
        campaignName: 'Diwali offer',
        recipients: 100,
      },
      campaignsOpen: true,
      sentToday: 7,
      lastBatchFinishedAt: new Date('2026-11-18T12:00:00.123Z'),
      testsWaiting: 1,
    })
  })

  it('reads a released batch and an open window', () => {
    const tick = readTick({
      ...TICK,
      window: { open: true, opens_at: null },
      released: { campaign_id: 'c1', batch_no: 2 },
      waiting_for_release: null,
    })
    expect(tick.released).toEqual({ campaignId: 'c1', batchNo: 2 })
    expect(tick.window).toEqual({ open: true, opensAt: null })
    expect(tick.waitingForRelease).toBeNull()
  })

  it('refuses an answer it cannot read, rather than guess', () => {
    expect(() => readTick(null)).toThrow(QueueAnswerUnreadable)
    expect(() => readTick({ ...TICK, window: 'open' })).toThrow(QueueAnswerUnreadable)
    expect(() => readTick({ ...TICK, sent_today: -1 })).toThrow(QueueAnswerUnreadable)
    expect(() => readTick({ ...TICK, last_batch_finished_at: 'yesterday' })).toThrow(
      QueueAnswerUnreadable,
    )
  })
})

describe('the database’s claims, as the loop reads them', () => {
  it('reads a customer, with the number as digits and the picture’s path', () => {
    expect(
      readClaim({
        kind: 'claimed',
        recipient: {
          campaign_id: 'c1',
          batch_no: 1,
          customer_id: 'u1',
          position: 3,
          phone: '919000008401',
          name: 'Asha',
          body: 'Hi {name}',
          image_path: 'c1/offer.jpg',
        },
      }),
    ).toEqual({
      kind: 'claimed',
      recipient: {
        ref: { campaignId: 'c1', batchNo: 1, customerId: 'u1', position: 3 },
        phone: '919000008401',
        name: 'Asha',
        body: 'Hi {name}',
        imageUrl: 'c1/offer.jpg',
      },
    })
  })

  it('reads nothing, and each refusal, with when the window opens', () => {
    expect(readClaim({ kind: 'nothing' })).toEqual({ kind: 'nothing' })
    expect(readClaim({ kind: 'refused', why: 'paused' })).toEqual({
      kind: 'refused',
      why: 'paused',
    })
    expect(
      readClaim({ kind: 'refused', why: 'outside_window', opens_at: '2026-11-19T04:30:00Z' }),
    ).toEqual({
      kind: 'refused',
      why: 'outside_window',
      opensAt: new Date('2026-11-19T04:30:00Z'),
    })
    expect(() => readClaim({ kind: 'refused', why: 'because' })).toThrow(QueueAnswerUnreadable)
    expect(() => readClaim({ kind: 'claimed', recipient: { phone: '' } })).toThrow(
      QueueAnswerUnreadable,
    )
  })

  it('reads a test as batch 0, carrying its test id, greeting nobody', () => {
    expect(
      readTestClaim({
        kind: 'claimed',
        recipient: {
          test_id: 't1',
          campaign_id: 'c1',
          phone: '12025550142',
          body: 'Hi {name}',
          image_path: null,
        },
      }),
    ).toEqual({
      kind: 'claimed',
      recipient: {
        ref: { campaignId: 'c1', batchNo: 0, customerId: 't1', position: 0, testId: 't1' },
        phone: '12025550142',
        name: null,
        body: 'Hi {name}',
        imageUrl: null,
      },
    })
    expect(readTestClaim({ kind: 'refused', why: 'claim_in_flight' })).toEqual({
      kind: 'refused',
      why: 'claim_in_flight',
    })
  })
})

describe('what the sender tells the database', () => {
  it('reports a customer to the customers’ function, and a test to the tests’', () => {
    expect(
      reportArguments(
        { campaignId: 'c1', batchNo: 1, customerId: 'u1', position: 3 },
        { state: 'sent', messageId: 'WAMID' },
      ),
    ).toEqual({
      fn: 'campaign_report_result',
      args: {
        p_campaign_id: 'c1',
        p_customer_id: 'u1',
        p_state: 'sent',
        p_message_id: 'WAMID',
        p_failure_code: null,
      },
    })
    expect(
      reportArguments(
        { campaignId: 'c1', batchNo: 0, customerId: 't1', position: 0, testId: 't1' },
        { state: 'failed', code: 'lookup_failed' },
      ),
    ).toEqual({
      fn: 'campaign_report_test_result',
      args: {
        p_test_id: 't1',
        p_state: 'failed',
        p_message_id: null,
        p_failure_code: 'lookup_failed',
      },
    })
  })

  it('sends receipts in the database’s names, with a code only where there is one', () => {
    expect(
      receiptArguments([
        { messageId: 'A', status: 'read' },
        { messageId: 'B', status: 'rejected', code: '463' },
      ]),
    ).toEqual([
      { message_id: 'A', status: 'read' },
      { message_id: 'B', status: 'rejected', code: '463' },
    ])
  })

  it('reads finished campaigns with their owners’ numbers and totals', () => {
    expect(
      readFinishNotices([
        {
          campaign_id: 'c1',
          name: 'Diwali offer',
          phone: '919000008590',
          counts: {
            recipients: 4,
            sent: 3,
            to_go: 0,
            delivered: 2,
            read: 1,
            not_on_whatsapp: 1,
            failed: 0,
            unsure: 0,
            stopped: 0,
          },
        },
      ]),
    ).toEqual([
      {
        campaignId: 'c1',
        campaignName: 'Diwali offer',
        phone: '919000008590',
        counts: { recipients: 4, sent: 3, notOnWhatsapp: 1, failed: 0, unsure: 0, stopped: 0 },
      },
    ])
    expect(() => readFinishNotices({})).toThrow(QueueAnswerUnreadable)
  })

  it('reads the outstanding ids as a list of text, and nothing else', () => {
    expect(readMessageIds(['A', 'B'])).toEqual(['A', 'B'])
    expect(() => readMessageIds('A')).toThrow(QueueAnswerUnreadable)
    expect(() => readMessageIds([1])).toThrow(QueueAnswerUnreadable)
  })
})
