// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { SendRefused } from './contracts.ts'
import type { LinkConnection, LinkHandlers, WhatsAppLink } from './contracts.ts'
import { queueSessionPath, realQueueConfigured } from './data-folder.ts'
import { onlyTo } from './rehearsal-guard.ts'
import {
  fileStore,
  memoryStore,
  newRehearsal,
  rehearsalQueue,
  REHEARSAL_QUEUE_FILE,
} from './rehearsal-queue.ts'
import type { RehearsalState } from './rehearsal-queue.ts'
import { indiaClock, parseClockTime, windowAt } from './sending-window.ts'

/** 12:00 in India. */
const NOON_IN_INDIA = Date.UTC(2026, 10, 18, 6, 30)
const BATCH = { campaignId: 'rehearsal', batchNo: 1 }

describe('the sending window', () => {
  const ten = 10 * 60
  const nine = 21 * 60
  const india = (hours: number, minutes = 0) =>
    Date.UTC(2026, 10, 18, hours, minutes) - 330 * 60_000

  it('is open from its start up to, and not at, its end, on the clock in India', () => {
    expect(windowAt(india(10), ten, nine)).toEqual({ open: true, opensAt: null })
    expect(windowAt(india(20, 59), ten, nine).open).toBe(true)
    expect(windowAt(india(21), ten, nine).open).toBe(false)
    expect(windowAt(india(9, 59), ten, nine).open).toBe(false)
  })

  it('says when it next opens: later today, or tomorrow', () => {
    expect(windowAt(india(7, 30), ten, nine).opensAt).toEqual(new Date(india(10)))
    expect(windowAt(india(23), ten, nine).opensAt).toEqual(new Date(india(10) + 24 * 3_600_000))
  })

  it('does not care what time it is where the laptop is', () => {
    // 22:30 on the 17th in Los Angeles is 12:00 on the 18th in India.
    expect(windowAt(Date.UTC(2026, 10, 18, 6, 30), ten, nine).open).toBe(true)
    expect(indiaClock(Date.UTC(2026, 10, 18, 6, 30))).toBe('12:00')
  })

  it('runs through midnight when its end is not after its start', () => {
    const late = 22 * 60
    const early = 2 * 60
    expect(windowAt(india(23), late, early).open).toBe(true)
    expect(windowAt(india(1, 59), late, early).open).toBe(true)
    expect(windowAt(india(2), late, early).open).toBe(false)
    expect(windowAt(india(12), 0, 24 * 60).open).toBe(true)
  })

  it('reads a time as written and refuses what is not one', () => {
    expect(parseClockTime('10:00')).toBe(600)
    expect(parseClockTime(' 9:05 ')).toBe(545)
    expect(parseClockTime('24:00')).toBe(1440)
    for (const wrong of ['24:01', '10:60', '10', 'ten', '']) {
      expect(parseClockTime(wrong)).toBeNull()
    }
  })
})

describe('the rehearsal queue, answering as the database will', () => {
  const setUp = (change?: (state: RehearsalState) => void, nowMs = NOON_IN_INDIA) => {
    const initial = newRehearsal(['text', 'image', 'absent'], { imagePath: 'picture.jpg' })
    change?.(initial)
    const store = memoryStore(initial)
    const asked: string[] = []
    const queue = rehearsalQueue(store, { now: () => nowMs }, (row) => {
      asked.push(row.kind)
      return row.kind === 'absent' ? '12135550100' : '12135550101'
    })
    return { store, queue, asked }
  }

  it('holds no phone number', async () => {
    const { store, queue } = setUp()
    await queue.claimNext(BATCH)
    expect(JSON.stringify(store.load())).not.toMatch(/\d{7,}/)
  })

  it('hands over one recipient at a time, in order, with the number read at that moment', async () => {
    const { store, queue, asked } = setUp()
    const first = await queue.claimNext(BATCH)
    expect(first).toMatchObject({
      kind: 'claimed',
      recipient: { ref: { position: 1 }, phone: '12135550101', imageUrl: null },
    })
    expect(asked).toEqual(['text'])
    expect(await queue.claimNext(BATCH)).toEqual({ kind: 'refused', why: 'claim_in_flight' })

    if (first.kind !== 'claimed') throw new Error('not claimed')
    expect(await queue.report(first.recipient.ref, { state: 'sent', messageId: 'A' })).toBe(true)
    const second = await queue.claimNext(BATCH)
    expect(second).toMatchObject({
      kind: 'claimed',
      recipient: { ref: { position: 2 }, imageUrl: 'picture.jpg' },
    })
    expect(store.load().recipients.map((row) => row.state)).toEqual(['sent', 'sending', 'waiting'])
  })

  it('fills in which message of how many', async () => {
    const { queue } = setUp()
    const claim = await queue.claimNext(BATCH)
    if (claim.kind !== 'claimed') throw new Error('not claimed')
    expect(claim.recipient.body).toContain('message 1 of 3')
  })

  it.each([
    [
      'paused',
      (state: RehearsalState) => {
        state.campaign.state = 'paused'
      },
    ],
    [
      'stopped',
      (state: RehearsalState) => {
        state.campaign.state = 'stopped'
      },
    ],
    [
      'not_released',
      (state: RehearsalState) => {
        state.batch.state = 'waiting'
      },
    ],
  ] as const)('refuses a claim when %s', async (why, change) => {
    const { queue, store } = setUp(change)
    expect(await queue.claimNext(BATCH)).toEqual({ kind: 'refused', why })
    expect(store.load().recipients[0]!.state).toBe('waiting')
    expect((await queue.tick('idle')).released).toBeNull()
  })

  it('refuses a claim outside the window and says when it opens', async () => {
    const night = Date.UTC(2026, 10, 18, 17, 30)
    const { queue } = setUp(undefined, night)
    expect(await queue.claimNext(BATCH)).toEqual({
      kind: 'refused',
      why: 'outside_window',
      opensAt: new Date(Date.UTC(2026, 10, 19, 4, 30)),
    })
    expect((await queue.tick('idle')).window.open).toBe(false)
  })

  it('turns a claim nobody settled into unsure, and never hands that recipient over again', async () => {
    const { store, queue } = setUp()
    await queue.claimNext(BATCH)
    expect(await queue.releaseStaleClaims()).toBe(1)
    expect(await queue.releaseStaleClaims()).toBe(0)
    const next = await queue.claimNext(BATCH)
    expect(next).toMatchObject({ kind: 'claimed', recipient: { ref: { position: 2 } } })
    expect(store.load().recipients[0]!.state).toBe('unsure')
  })

  it('accepts the same report twice and refuses one for a recipient not in hand', async () => {
    const { queue } = setUp()
    const claim = await queue.claimNext(BATCH)
    if (claim.kind !== 'claimed') throw new Error('not claimed')
    const { ref } = claim.recipient
    expect(await queue.report(ref, { state: 'sent', messageId: 'A' })).toBe(true)
    expect(await queue.report(ref, { state: 'sent', messageId: 'A' })).toBe(true)
    expect(await queue.report(ref, { state: 'sent', messageId: 'B' })).toBe(false)
    expect(await queue.report({ ...ref, position: 3 }, { state: 'not_on_whatsapp' })).toBe(false)
  })

  it('finishes the batch and the campaign when nobody is left', async () => {
    const { store, queue } = setUp()
    for (const result of [
      { state: 'sent', messageId: 'A' },
      { state: 'failed', code: 'x' },
      { state: 'not_on_whatsapp' },
    ] as const) {
      const claim = await queue.claimNext(BATCH)
      if (claim.kind !== 'claimed') throw new Error('not claimed')
      await queue.report(claim.recipient.ref, result)
    }
    expect(await queue.claimNext(BATCH)).toEqual({ kind: 'nothing' })
    expect(store.load()).toMatchObject({ batch: { state: 'done' }, campaign: { state: 'done' } })
    expect(await queue.tick('idle')).toMatchObject({ released: null, campaignsOpen: false })
  })

  it('keeps receipts by message id, and lists the ids one could still change', async () => {
    const { store, queue } = setUp()
    const claim = await queue.claimNext(BATCH)
    if (claim.kind !== 'claimed') throw new Error('not claimed')
    await queue.report(claim.recipient.ref, { state: 'sent', messageId: 'A' })
    expect(await queue.outstandingMessageIds()).toEqual(['A'])

    await queue.reportReceipts([
      { messageId: 'A', status: 'delivered' },
      { messageId: 'never-heard-of', status: 'read' },
    ])
    expect(store.load().recipients[0]).toMatchObject({ state: 'sent', readAt: null })
    expect(store.load().recipients[0]!.deliveredAt).not.toBeNull()
    expect(await queue.outstandingMessageIds()).toEqual(['A'])

    await queue.reportReceipts([{ messageId: 'A', status: 'read' }])
    expect(await queue.outstandingMessageIds()).toEqual([])
  })

  // A customer with read receipts off never sends `read`, so without a limit
  // their message would be asked about on every connect for ever. The database
  // asks only about the last thirty days, and so does this.
  it('stops asking about a message sent more than thirty days ago', async () => {
    const { store, queue } = setUp()
    const claim = await queue.claimNext(BATCH)
    if (claim.kind !== 'claimed') throw new Error('not claimed')
    await queue.report(claim.recipient.ref, { state: 'sent', messageId: 'A' })
    const sentDaysAgo = (days: number) => {
      const state = store.load()
      state.recipients[0]!.sentAt = new Date(NOON_IN_INDIA - days * 86_400_000).toISOString()
      store.save(state)
    }
    sentDaysAgo(29)
    expect(await queue.outstandingMessageIds()).toEqual(['A'])
    sentDaysAgo(31)
    expect(await queue.outstandingMessageIds()).toEqual([])
  })

  it('marks a message WhatsApp refused afterwards as failed, with the code', async () => {
    const { store, queue } = setUp()
    const claim = await queue.claimNext(BATCH)
    if (claim.kind !== 'claimed') throw new Error('not claimed')
    await queue.report(claim.recipient.ref, { state: 'sent', messageId: 'A' })
    await queue.reportReceipts([{ messageId: 'A', status: 'rejected', code: '463' }])
    expect(store.load().recipients[0]).toMatchObject({ state: 'failed', failureCode: '463' })
  })

  it('says which batch is waiting for release, and never while one is released', async () => {
    const { queue, store } = setUp((state) => {
      state.batch.state = 'waiting'
    })
    expect((await queue.tick('idle')).waitingForRelease).toEqual({
      campaignId: 'rehearsal',
      batchNo: 1,
      campaignName: 'Rehearsal',
      recipients: 3,
    })
    const state = store.load()
    state.batch.state = 'released'
    store.save(state)
    expect(await queue.tick('idle')).toMatchObject({ waitingForRelease: null, released: BATCH })
  })

  it('releases the waiting batch once, and nothing else', async () => {
    const { queue } = setUp((state) => {
      state.batch.state = 'waiting'
    })
    expect(await queue.claimNext(BATCH)).toEqual({ kind: 'refused', why: 'not_released' })
    expect(await queue.releaseBatch(BATCH)).toBe(true)
    expect(await queue.releaseBatch(BATCH)).toBe(false)
    expect((await queue.claimNext(BATCH)).kind).toBe('claimed')
  })

  it('counts what was sent today in India, and says when the last batch finished', async () => {
    const { queue } = setUp()
    expect(await queue.tick('idle')).toMatchObject({ sentToday: 0, lastBatchFinishedAt: null })
    for (const result of [
      { state: 'sent', messageId: 'A' },
      { state: 'sent', messageId: 'B' },
      { state: 'not_on_whatsapp' },
    ] as const) {
      const claim = await queue.claimNext(BATCH)
      if (claim.kind !== 'claimed') throw new Error('not claimed')
      await queue.report(claim.recipient.ref, result)
    }
    expect(await queue.tick('idle')).toMatchObject({
      sentToday: 2,
      lastBatchFinishedAt: new Date(NOON_IN_INDIA),
    })
  })

  it('hands over test messages with no release and the window shut, one at a time', async () => {
    const night = Date.UTC(2026, 10, 18, 17, 30)
    const store = memoryStore(newRehearsal(['text'], { waitForRelease: true, tests: 2 }))
    const queue = rehearsalQueue(
      store,
      { now: () => night },
      () => '12135550101',
      () => '12135550199',
    )
    expect((await queue.tick('idle')).testsWaiting).toBe(2)
    const first = await queue.claimNextTest()
    expect(first).toMatchObject({
      kind: 'claimed',
      recipient: { phone: '12135550199', ref: { batchNo: 0, testId: 'rehearsal-test-1' } },
    })
    expect(await queue.claimNextTest()).toEqual({ kind: 'refused', why: 'claim_in_flight' })
    expect(await queue.claimNext(BATCH)).toEqual({ kind: 'refused', why: 'not_released' })
    if (first.kind !== 'claimed') throw new Error('not claimed')
    expect(await queue.report(first.recipient.ref, { state: 'sent', messageId: 'T1' })).toBe(true)
    expect(await queue.report(first.recipient.ref, { state: 'sent', messageId: 'T1' })).toBe(true)
    expect((await queue.tick('idle')).testsWaiting).toBe(1)
    await queue.claimNextTest()
    expect(await queue.releaseStaleClaims()).toBe(1)
    expect(store.load().tests?.map((test) => test.state)).toEqual(['sent', 'unsure'])
    expect(await queue.claimNextTest()).toEqual({ kind: 'nothing' })
    // Tests are no customer: the day's count and the batch know nothing of them.
    expect((await queue.tick('idle')).sentToday).toBe(0)
  })

  it('records the pause the sender asks for, with its reason', async () => {
    const { store, queue } = setUp()
    await queue.pauseCampaign('rehearsal', 'three_in_a_row')
    expect(store.load().campaign).toMatchObject({
      state: 'paused',
      pausedBecause: 'three_in_a_row',
    })
  })
})

describe('the rehearsal queue file', () => {
  let folder: string

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'campaign-sender-rehearsal-'))
  })

  afterEach(() => {
    rmSync(folder, { recursive: true, force: true })
  })

  it('is named and labelled as a rehearsal, and saved whole', () => {
    const store = fileStore(join(folder, 'made-on-demand'))
    store.save(newRehearsal(['text']))
    const path = join(folder, 'made-on-demand', REHEARSAL_QUEUE_FILE)
    expect(REHEARSAL_QUEUE_FILE).toMatch(/rehearsal/i)
    expect(readFileSync(path, 'utf8')).toMatch(/REHEARSAL ONLY/)
    expect(existsSync(`${path}.tmp`)).toBe(false)
    expect(store.load().recipients).toHaveLength(1)
  })

  it('is read afresh for every question, so an edit by hand is obeyed', async () => {
    const store = fileStore(folder)
    store.save(newRehearsal(['text', 'text']))
    const queue = rehearsalQueue(store, { now: () => NOON_IN_INDIA }, () => '12135550101')
    expect((await queue.tick('idle')).released).not.toBeNull()

    const edited = store.load()
    edited.campaign.state = 'paused'
    writeFileSync(join(folder, REHEARSAL_QUEUE_FILE), JSON.stringify(edited), 'utf8')
    expect(await queue.claimNext(BATCH)).toEqual({ kind: 'refused', why: 'paused' })
  })

  it('is not for a laptop signed in to the real queue', () => {
    expect(realQueueConfigured(folder)).toBe(false)
    writeFileSync(queueSessionPath(folder), '{}', 'utf8')
    expect(realQueueConfigured(folder)).toBe(true)
  })
})

describe('a rehearsal can reach exactly one phone', () => {
  const RECIPIENT = '12135550101'
  const ABSENT = '12135550100'
  const SOMEBODY_ELSE = '12135550199'

  const setUp = (existing: readonly string[] = [RECIPIENT]) => {
    const lookedUp: string[] = []
    const sentTo: string[] = []
    const real: LinkConnection = {
      resolve: async (phone) => {
        lookedUp.push(phone)
        return existing.includes(phone) ? `${phone}@s.whatsapp.net` : null
      },
      send: async (address) => {
        sentTo.push(address)
        return 'id'
      },
      onReceipt: () => {},
    }
    const opened: LinkConnection[] = []
    const link: WhatsAppLink = {
      hold: async (handlers: LinkHandlers) => {
        handlers.onOpen(real)
        return { kind: 'stopped' }
      },
    }
    void onlyTo(link, { recipient: RECIPIENT, lookupOnly: [ABSENT] }).hold(
      { onOpen: (connection) => opened.push(connection), onClose: () => {} },
      new AbortController().signal,
    )
    const guarded = opened[0]
    if (!guarded) throw new Error('never opened')
    return { guarded, lookedUp, sentTo }
  }

  it('sends to its recipient', async () => {
    const { guarded, sentTo } = setUp()
    const address = await guarded.resolve(RECIPIENT)
    expect(await guarded.send(address!, { text: 'hello' })).toBe('id')
    expect(sentTo).toEqual([`${RECIPIENT}@s.whatsapp.net`])
  })

  it('will not even look up anybody else', async () => {
    const { guarded, lookedUp } = setUp()
    await expect(guarded.resolve(SOMEBODY_ELSE)).rejects.toThrow()
    expect(lookedUp).toEqual([])
  })

  it('refuses to send to an address it did not get for its recipient', async () => {
    const { guarded, sentTo } = setUp()
    await guarded.resolve(RECIPIENT)
    await expect(
      guarded.send(`${SOMEBODY_ELSE}@s.whatsapp.net`, { text: 'hello' }),
    ).rejects.toThrow(SendRefused)
    expect(sentTo).toEqual([])
  })

  it('looks up the absent number, and still cannot send to it should it exist', async () => {
    const { guarded, sentTo } = setUp([RECIPIENT, ABSENT])
    const address = await guarded.resolve(ABSENT)
    expect(address).not.toBeNull()
    await expect(guarded.send(address!, { text: 'hello' })).rejects.toThrow(SendRefused)
    expect(sentTo).toEqual([])
  })
})
