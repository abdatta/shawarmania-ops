import { describe, expect, it } from 'vitest'

import {
  everybodyAt,
  type CampaignBatchReading,
  type CampaignSenderReading,
  type CampaignSummary,
  type CampaignTestSend,
} from '@/data-access/campaigns'

import {
  audienceWords,
  batchWords,
  campaignShownState,
  pausedReasonWords,
  senderLine,
  senderOnline,
  testStateWords,
  windowTime,
} from './words'

const NOW = '2026-11-18T08:00:00.000Z'

function sender(patch: Partial<CampaignSenderReading> = {}): CampaignSenderReading {
  return {
    status: 'sending',
    lastSeenAt: '2026-11-18T07:59:40.000Z',
    haltReason: null,
    linkedNumberLast4: '4721',
    serverNow: NOW,
    batchSize: 100,
    windowStart: '10:00:00',
    windowEnd: '21:00:00',
    ...patch,
  }
}

function campaign(patch: Partial<CampaignSummary> = {}): CampaignSummary {
  return {
    id: 'c1',
    name: 'Diwali offer',
    state: 'scheduled',
    pausedReason: null,
    notBefore: null,
    recipients: 1000,
    sent: 247,
    sendingBatchNo: 3,
    nextBatchNo: null,
    createdAt: NOW,
    scheduledAt: NOW,
    finishedAt: null,
    ...patch,
  }
}

function batch(patch: Partial<CampaignBatchReading> = {}): CampaignBatchReading {
  return {
    batchNo: 3,
    state: 'released',
    releasedAt: NOW,
    finishedAt: null,
    recipients: 100,
    sent: 47,
    toGo: 53,
    delivered: 45,
    read: 20,
    notOnWhatsApp: 0,
    failed: 0,
    unsure: 0,
    stopped: 0,
    ...patch,
  }
}

describe('the sender line', () => {
  it('says what an online sender is doing', () => {
    expect(senderLine(sender(), [campaign()])).toEqual({
      tone: 'live',
      headline: 'Sender online',
      detail: 'sending batch 3',
    })
  })

  it('says a batch is waiting on the laptop, which is where it is released', () => {
    const waiting = campaign({ sendingBatchNo: null, nextBatchNo: 3 })
    expect(senderLine(sender({ status: 'idle' }), [waiting]).detail).toBe(
      'batch 3 waiting on the laptop',
    )
  })

  it('says when a campaign held for later may start', () => {
    const held = campaign({
      sent: 0,
      sendingBatchNo: null,
      nextBatchNo: 1,
      notBefore: '2026-11-21T04:30:00.000Z',
    })
    expect(senderLine(sender({ status: 'idle' }), [held]).detail).toBe(
      'batch 1 can go from 21 Nov, 10:00 am',
    )
  })

  it('says it is waiting for the window outside sending hours', () => {
    expect(senderLine(sender({ status: 'outside_hours' }), [campaign()]).detail).toBe(
      'waiting for 10:00 am in India',
    )
  })

  it('says which campaign goes first when this one waits behind it', () => {
    const behind = campaign({ sent: 0, sendingBatchNo: null, nextBatchNo: 1 })
    expect(senderLine(sender(), [behind], 'Diwali offer').detail).toBe('Diwali offer goes first')
  })

  it('is plainly online when nothing is going out', () => {
    expect(senderLine(sender({ status: 'idle' }), [campaign({ state: 'done' })])).toEqual({
      tone: 'live',
      headline: 'Sender online',
      detail: null,
    })
  })

  it('reads offline since it was last seen, and never repeats that it was sending', () => {
    const closed = sender({ status: 'sending', lastSeenAt: '2026-11-17T15:30:00.000Z' })
    expect(senderOnline(closed)).toBe(false)
    expect(senderLine(closed, [campaign()])).toEqual({
      tone: 'quiet',
      headline: 'Sender offline since yesterday, 09:00 pm',
      detail: 'it carries on when the laptop is back',
    })
    expect(campaignShownState(campaign(), closed)).toBe('waiting')
  })

  it('counts a sender seen within ten minutes as online, and one past it as not', () => {
    expect(senderOnline(sender({ lastSeenAt: '2026-11-18T07:50:00.000Z' }))).toBe(true)
    expect(senderOnline(sender({ lastSeenAt: '2026-11-18T07:49:59.000Z' }))).toBe(false)
    expect(senderOnline(sender({ lastSeenAt: null }))).toBe(false)
  })

  it('says a halted sender is halted, why, and where it is restarted', () => {
    const halted = sender({ status: 'halted', haltReason: 'logged_out' })
    expect(senderLine(halted, [campaign()])).toEqual({
      tone: 'trouble',
      headline: 'Sender halted',
      detail: 'WhatsApp logged it out · restart it on the laptop',
    })
    expect(senderLine(sender({ status: 'halted', haltReason: 'restricted' }), []).detail).toBe(
      'WhatsApp restricted the account · restart it on the laptop',
    )
  })

  it('says an unlinked sender is linked on the laptop, and shows no code', () => {
    const words = senderLine(sender({ status: 'not_linked', linkedNumberLast4: null }), [])
    expect(words).toEqual({
      tone: 'quiet',
      headline: 'Sender not linked',
      detail: 'link it on the laptop',
    })
    expect(`${words.headline} ${words.detail}`).not.toMatch(/\d/)
  })
})

describe('a campaign’s shown state', () => {
  it('is sending only while a batch is out and the sender says so', () => {
    expect(campaignShownState(campaign(), sender())).toBe('sending')
    expect(campaignShownState(campaign(), sender({ status: 'outside_hours' }))).toBe('waiting')
    expect(campaignShownState(campaign(), sender({ status: 'halted' }))).toBe('waiting')
  })

  it('is submitted before anything has gone, and waiting between batches', () => {
    const fresh = campaign({ sent: 0, sendingBatchNo: null, nextBatchNo: 1 })
    expect(campaignShownState(fresh, sender({ status: 'idle' }))).toBe('submitted')
    const between = campaign({ sent: 200, sendingBatchNo: null, nextBatchNo: 3 })
    expect(campaignShownState(between, sender({ status: 'idle' }))).toBe('waiting')
  })

  it('passes every other state through', () => {
    for (const state of ['draft', 'paused', 'stopped', 'done'] as const) {
      expect(campaignShownState(campaign({ state }), sender())).toBe(state)
    }
  })

  it('says why the sender paused a campaign, and nothing when an owner did', () => {
    expect(pausedReasonWords(null)).toBeNull()
    expect(pausedReasonWords('three_in_a_row')).toMatch(/three sends in a row/)
  })
})

describe('a batch row', () => {
  it('gives a done batch its receipts and whatever else happened', () => {
    const done = batch({
      state: 'done',
      sent: 97,
      toGo: 0,
      delivered: 96,
      read: 58,
      notOnWhatsApp: 1,
      unsure: 1,
      stopped: 2,
    })
    expect(batchWords(done, campaign(), sender(), false)).toEqual({
      state: 'done',
      figures: '96 delivered · 58 read',
      others: '1 not on WhatsApp · 1 unsure · 2 stopped',
    })
  })

  it('says how far a sending batch has got', () => {
    expect(batchWords(batch(), campaign(), sender(), false)).toEqual({
      state: 'sending',
      figures: '47 of 100',
      others: null,
    })
  })

  it('never calls a batch sending while the sender is away, halted or outside hours', () => {
    const offline = sender({ lastSeenAt: '2026-11-17T15:30:00.000Z' })
    expect(batchWords(batch(), campaign(), offline, false)).toMatchObject({
      state: 'waiting',
      figures: '47 of 100 · sender offline',
    })
    expect(batchWords(batch(), campaign(), sender({ status: 'halted' }), false).figures).toBe(
      '47 of 100 · sender halted',
    )
    expect(
      batchWords(batch(), campaign(), sender({ status: 'outside_hours' }), false).figures,
    ).toBe('47 of 100 · from 10:00 am')
    expect(batchWords(batch(), campaign({ state: 'paused' }), sender(), false).state).toBe('paused')
  })

  it('tells only the next batch where it is sent from', () => {
    const waiting = batch({ state: 'waiting', sent: 0, toGo: 100, delivered: 0, read: 0 })
    const between = campaign({ sendingBatchNo: null, nextBatchNo: 3 })
    expect(batchWords(waiting, between, sender({ status: 'idle' }), false).figures).toBe(
      'send from the laptop',
    )
    expect(
      batchWords({ ...waiting, batchNo: 4 }, between, sender({ status: 'idle' }), false).figures,
    ).toBeNull()
    // Behind another campaign's batch, or paused, there is nothing to release yet.
    expect(batchWords(waiting, between, sender({ status: 'idle' }), true).figures).toBeNull()
    expect(
      batchWords(waiting, { ...between, state: 'paused' }, sender({ status: 'idle' }), false)
        .figures,
    ).toBeNull()
  })

  it('reads a stopped campaign’s unsent batches as not sent', () => {
    const waiting = batch({ state: 'waiting', sent: 0, toGo: 100, delivered: 0, read: 0 })
    expect(batchWords(waiting, campaign({ state: 'stopped' }), sender(), false)).toEqual({
      state: 'not sent',
      figures: null,
      others: null,
    })
    expect(batchWords(batch(), campaign({ state: 'stopped' }), sender(), false).figures).toBe(
      '47 of 100 went',
    )
  })
})

describe('an audience in words', () => {
  it('says everyone when nothing narrows it', () => {
    expect(audienceWords(everybodyAt('o1'))).toEqual([
      'everyone who has ordered',
      'most orders first',
    ])
  })

  it('names each filter chosen, money as rupees', () => {
    expect(
      audienceWords({
        outletId: 'o1',
        ordered: { kind: 'not_within', days: 45 },
        orders: { kind: 'at_least', count: 5 },
        gold: 'gold',
        spentAtLeastPaise: 200000,
        campaigns: { kind: 'not_within', days: 30 },
        sort: 'longest_away',
        picked: { kind: 'all', except: ['c1', 'c2'] },
      }),
    ).toEqual([
      'not ordered in the last 45 days',
      'at least 5 orders',
      'gold members',
      'spent at least ₹2,000',
      'not sent one in the last 30 days',
      '2 left out',
      'longest away first',
    ])
  })

  it('says customers ticked one by one as that, not as filters', () => {
    expect(
      audienceWords({
        ...everybodyAt('o1'),
        gold: 'not_gold',
        sort: 'most_recent',
        picked: { kind: 'only', ids: ['c1'] },
      }),
    ).toEqual(['picked one by one', 'most recent first'])
    expect(audienceWords({ ...everybodyAt('o1'), gold: 'not_gold' })).toEqual([
      'not gold members',
      'most orders first',
    ])
  })

  it('writes the window as a clock time', () => {
    expect(windowTime('10:00:00')).toBe('10:00 am')
    expect(windowTime('21:00:00')).toBe('9:00 pm')
    expect(windowTime('12:30:00')).toBe('12:30 pm')
  })
})

describe('a test send in words', () => {
  const test = (patch: Partial<CampaignTestSend>): CampaignTestSend => ({
    id: 't1',
    phone: '+919000000901',
    state: 'waiting',
    queuedAt: NOW,
    sentAt: null,
    failureCode: null,
    ...patch,
  })

  it('says each state plainly', () => {
    expect(testStateWords(test({}), NOW)).toBe('waiting for the laptop')
    expect(testStateWords(test({ state: 'not_on_whatsapp' }), NOW)).toBe('not on WhatsApp')
    expect(testStateWords(test({ state: 'failed' }), NOW)).toBe('failed')
    expect(testStateWords(test({ state: 'unsure' }), NOW)).toBe('unsure')
  })

  it('says when it was sent: the time today, the date before', () => {
    expect(testStateWords(test({ state: 'sent', sentAt: '2026-11-18T07:35:00.000Z' }), NOW)).toBe(
      'sent at 01:05 pm',
    )
    expect(
      testStateWords(test({ state: 'sent', sentAt: '2026-11-16T07:35:00.000Z' }), NOW),
    ).toMatch(/^sent 16 Nov/)
  })
})
