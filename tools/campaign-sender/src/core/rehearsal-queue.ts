/**
 * A stand-in for the database, **for rehearsal only**.
 *
 * The real `CampaignQueue` is the database's functions (design D6), which do
 * not exist yet. This one keeps a campaign of a few rows in memory, or in one
 * JSON file in the sender's own folder, and answers the loop the way D6 says
 * the database will: one claim at a time, refused when paused, stopped,
 * unreleased or outside the window, stale claims turned to *unsure*. The
 * loop's unit tests run against it, and `npm run rehearse` runs the real loop
 * and the real WhatsApp link against it. It is the fake task 5.3 says to fix
 * when WhatsApp does something it did not model.
 *
 * **It holds no phone number.** A row says what kind of recipient it is, and
 * the number is supplied by the caller at the moment of the claim, as the real
 * queue reads it from the customer's record at that moment (design D5).
 *
 * It is never a campaign: `main.ts` refuses to rehearse on a laptop that is
 * signed in to the real queue (`data-folder.ts`, `realQueueConfigured`).
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { QUEUE_CONTRACT_VERSION } from './contracts.ts'
import type {
  BatchRef,
  BatchReleaser,
  CampaignQueue,
  ClaimedRecipient,
  RecipientRef,
} from './contracts.ts'
import { indiaDay, parseClockTime, windowAt } from './sending-window.ts'

/** Named so that nobody opening the folder takes it for anything real. */
export const REHEARSAL_QUEUE_FILE = 'REHEARSAL-QUEUE.json'

const NOTE =
  'REHEARSAL ONLY. A stand-in for the database, used by `npm run rehearse` to try the sender on one phone. Not a campaign and not read by anything else.'

const CAMPAIGN_ID = 'rehearsal'
const BATCH_NO = 1

/**
 * `text` and `image` go to the one rehearsal recipient. `absent` is looked up
 * as a number that is not on WhatsApp, and is never sent to.
 */
export type RehearsalRowKind = 'text' | 'image' | 'absent'

export type RecipientState =
  'waiting' | 'sending' | 'sent' | 'unsure' | 'failed' | 'not_on_whatsapp' | 'stopped'

export interface RehearsalRow {
  position: number
  kind: RehearsalRowKind
  state: RecipientState
  claimedAt: string | null
  sentAt: string | null
  deliveredAt: string | null
  readAt: string | null
  messageId: string | null
  failureCode: string | null
}

export interface RehearsalState {
  note: string
  minGapSeconds: number
  maxGapSeconds: number
  /** `HH:MM`, Asia/Kolkata. */
  windowStart: string
  windowEnd: string
  campaign: {
    state: 'scheduled' | 'paused' | 'stopped' | 'done'
    pausedBecause: string | null
    /** `{position}` and `{total}` are filled in at the claim. */
    body: string
    imagePath: string | null
  }
  batch: { state: 'waiting' | 'released' | 'done'; finishedAt?: string | null }
  sender: { lastSeenAt: string | null; status: string | null; haltReason: string | null }
  recipients: RehearsalRow[]
  /** Messages to the rehearsal's own test number, sent with no release. */
  tests?: RehearsalTest[]
}

export interface RehearsalTest {
  id: string
  state: RecipientState
  queuedAt: string
  sentAt: string | null
  messageId: string | null
  failureCode: string | null
}

export interface RehearsalOptions {
  minGapSeconds?: number
  maxGapSeconds?: number
  windowStart?: string
  windowEnd?: string
  body?: string
  imagePath?: string | null
  /** Start with the batch waiting for the owner, as a scheduled campaign does. Default: released. */
  waitForRelease?: boolean
  /** Test messages queued already, as submitting a campaign with test numbers does. */
  tests?: number
}

export function newRehearsal(
  kinds: readonly RehearsalRowKind[],
  options: RehearsalOptions = {},
): RehearsalState {
  return {
    note: NOTE,
    minGapSeconds: options.minGapSeconds ?? 45,
    maxGapSeconds: options.maxGapSeconds ?? 90,
    windowStart: options.windowStart ?? '10:00',
    windowEnd: options.windowEnd ?? '21:00',
    campaign: {
      state: 'scheduled',
      pausedBecause: null,
      body:
        options.body ??
        'Shawarmania campaign sender: *rehearsal* message {position} of {total}. Please ignore.',
      imagePath: options.imagePath ?? null,
    },
    batch: { state: options.waitForRelease ? 'waiting' : 'released' },
    sender: { lastSeenAt: null, status: null, haltReason: null },
    recipients: kinds.map((kind, index) => ({
      position: index + 1,
      kind,
      state: 'waiting',
      claimedAt: null,
      sentAt: null,
      deliveredAt: null,
      readAt: null,
      messageId: null,
      failureCode: null,
    })),
    tests: Array.from({ length: options.tests ?? 0 }, (_, index) => ({
      id: `rehearsal-test-${index + 1}`,
      state: 'waiting',
      queuedAt: new Date(0).toISOString(),
      sentAt: null,
      messageId: null,
      failureCode: null,
    })),
  }
}

export interface RehearsalStore {
  load: () => RehearsalState
  save: (state: RehearsalState) => void
}

/** Kept in memory: what the unit tests use. */
export function memoryStore(initial: RehearsalState): RehearsalStore {
  let text = JSON.stringify(initial)
  return {
    load: () => JSON.parse(text) as RehearsalState,
    save: (state) => {
      text = JSON.stringify(state)
    },
  }
}

/**
 * Kept in one file, saved whole by temporary file and rename, so a process
 * killed mid-rehearsal leaves either the old queue or the new one. Read afresh
 * for every question, so the file may be edited while a rehearsal runs: that
 * is how a rehearsal pauses, resumes or stops its campaign.
 */
export function fileStore(folder: string): RehearsalStore {
  const path = join(folder, REHEARSAL_QUEUE_FILE)
  return {
    load: () => JSON.parse(readFileSync(path, 'utf8')) as RehearsalState,
    save: (state) => {
      mkdirSync(folder, { recursive: true })
      const temporary = `${path}.tmp`
      writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
      renameSync(temporary, path)
    },
  }
}

function refOf(row: RehearsalRow): RecipientRef {
  return {
    campaignId: CAMPAIGN_ID,
    batchNo: BATCH_NO,
    customerId: `rehearsal-recipient-${row.position}`,
    position: row.position,
  }
}

/**
 * @param phoneFor the number a row is sent to, asked at the claim and kept
 *   nowhere. A rehearsal answers with its one recipient, or with a number that
 *   is not on WhatsApp for an `absent` row.
 */
export function rehearsalQueue(
  store: RehearsalStore,
  clock: { now: () => number },
  phoneFor: (row: Readonly<RehearsalRow>) => string,
  /** The number a test is sent to. A rehearsal answers with its one recipient. */
  phoneForTest: () => string = () => phoneFor({ position: 0, kind: 'text' } as RehearsalRow),
): CampaignQueue & BatchReleaser {
  const iso = () => new Date(clock.now()).toISOString()

  const windowNow = (state: RehearsalState) =>
    windowAt(
      clock.now(),
      parseClockTime(state.windowStart) ?? 600,
      parseClockTime(state.windowEnd) ?? 1260,
    )

  const testsOf = (state: RehearsalState): RehearsalTest[] => (state.tests ??= [])
  const anyInHand = (state: RehearsalState): boolean =>
    state.recipients.some((row) => row.state === 'sending') ||
    testsOf(state).some((test) => test.state === 'sending')

  /** A released batch with nobody waiting and nobody in hand is done, and so is its campaign. */
  const finishIfEmpty = (state: RehearsalState): void => {
    if (state.batch.state !== 'released') return
    if (state.recipients.some((row) => row.state === 'waiting' || row.state === 'sending')) return
    state.batch.state = 'done'
    state.batch.finishedAt = iso()
    if (state.campaign.state === 'scheduled') state.campaign.state = 'done'
  }

  const batch: BatchRef = { campaignId: CAMPAIGN_ID, batchNo: BATCH_NO }

  return {
    tick: async (status, haltReason) => {
      const state = store.load()
      state.sender = { lastSeenAt: iso(), status, haltReason: haltReason ?? null }
      finishIfEmpty(state)
      store.save(state)
      return {
        contractVersion: QUEUE_CONTRACT_VERSION,
        standDown: false,
        minGapSeconds: state.minGapSeconds,
        maxGapSeconds: state.maxGapSeconds,
        window: windowNow(state),
        released:
          state.campaign.state === 'scheduled' && state.batch.state === 'released' ? batch : null,
        waitingForRelease:
          state.campaign.state === 'scheduled' && state.batch.state === 'waiting'
            ? { ...batch, campaignName: 'Rehearsal', recipients: state.recipients.length }
            : null,
        campaignsOpen: state.campaign.state === 'scheduled' || state.campaign.state === 'paused',
        sentToday: state.recipients.filter(
          (row) =>
            row.sentAt !== null && indiaDay(Date.parse(row.sentAt)) === indiaDay(clock.now()),
        ).length,
        lastBatchFinishedAt: state.batch.finishedAt ? new Date(state.batch.finishedAt) : null,
        testsWaiting:
          state.campaign.state === 'stopped'
            ? 0
            : testsOf(state).filter((test) => test.state === 'waiting').length,
      }
    },

    claimNextTest: async () => {
      const state = store.load()
      const tests = testsOf(state)
      if (state.campaign.state === 'stopped') {
        for (const test of tests) if (test.state === 'waiting') test.state = 'stopped'
        store.save(state)
      }
      if (anyInHand(state)) return { kind: 'refused', why: 'claim_in_flight' }
      const index = tests.findIndex((test) => test.state === 'waiting')
      const test = tests[index]
      if (!test) return { kind: 'nothing' }
      test.state = 'sending'
      store.save(state)
      const recipient: ClaimedRecipient = {
        ref: {
          campaignId: CAMPAIGN_ID,
          batchNo: 0,
          customerId: test.id,
          position: index + 1,
          testId: test.id,
        },
        phone: phoneForTest(),
        name: null,
        body: state.campaign.body
          .replaceAll('{position}', `test ${index + 1}`)
          .replaceAll('{total}', String(state.recipients.length)),
        imageUrl: state.campaign.imagePath,
      }
      return { kind: 'claimed', recipient }
    },

    claimNext: async () => {
      const state = store.load()
      if (state.campaign.state === 'paused') return { kind: 'refused', why: 'paused' }
      if (state.campaign.state === 'stopped') return { kind: 'refused', why: 'stopped' }
      if (state.campaign.state === 'done' || state.batch.state === 'done')
        return { kind: 'nothing' }
      if (state.batch.state !== 'released') return { kind: 'refused', why: 'not_released' }
      const window = windowNow(state)
      if (!window.open) return { kind: 'refused', why: 'outside_window', opensAt: window.opensAt }
      // Strictly one at a time: a recipient or a test still in hand blocks the next.
      if (anyInHand(state)) {
        return { kind: 'refused', why: 'claim_in_flight' }
      }
      const row = state.recipients.find((candidate) => candidate.state === 'waiting')
      if (!row) {
        finishIfEmpty(state)
        store.save(state)
        return { kind: 'nothing' }
      }
      row.state = 'sending'
      row.claimedAt = iso()
      store.save(state)
      const recipient: ClaimedRecipient = {
        ref: refOf(row),
        phone: phoneFor(row),
        name: null,
        body: state.campaign.body
          .replaceAll('{position}', String(row.position))
          .replaceAll('{total}', String(state.recipients.length)),
        imageUrl: row.kind === 'image' ? state.campaign.imagePath : null,
      }
      return { kind: 'claimed', recipient }
    },

    report: async (ref, result) => {
      const state = store.load()
      if (ref.testId) {
        const test = testsOf(state).find((candidate) => candidate.id === ref.testId)
        if (!test) return false
        if (test.state !== 'sending') {
          return (
            test.state === result.state &&
            (result.state !== 'sent' || test.messageId === result.messageId)
          )
        }
        test.state = result.state
        if (result.state === 'sent') {
          test.messageId = result.messageId
          test.sentAt = iso()
        }
        if (result.state === 'failed') test.failureCode = result.code
        store.save(state)
        return true
      }
      const row = state.recipients.find((candidate) => candidate.position === ref.position)
      if (!row) return false
      if (row.state !== 'sending') {
        // The same report arriving twice (its first answer was lost) is fine.
        return (
          row.state === result.state &&
          (result.state !== 'sent' || row.messageId === result.messageId)
        )
      }
      row.state = result.state
      if (result.state === 'sent') {
        row.messageId = result.messageId
        row.sentAt = iso()
      }
      if (result.state === 'failed') row.failureCode = result.code
      finishIfEmpty(state)
      store.save(state)
      return true
    },

    releaseStaleClaims: async () => {
      const state = store.load()
      const stale = state.recipients.filter((row) => row.state === 'sending')
      for (const row of stale) row.state = 'unsure'
      const staleTests = testsOf(state).filter((test) => test.state === 'sending')
      for (const test of staleTests) test.state = 'unsure'
      if (stale.length + staleTests.length > 0) {
        finishIfEmpty(state)
        store.save(state)
      }
      return stale.length + staleTests.length
    },

    reportReceipts: async (receipts) => {
      const state = store.load()
      for (const receipt of receipts) {
        const row = state.recipients.find((candidate) => candidate.messageId === receipt.messageId)
        if (!row) continue
        if (receipt.status === 'rejected') {
          row.state = 'failed'
          row.failureCode = receipt.code ?? 'rejected'
          continue
        }
        row.deliveredAt ??= iso()
        if (receipt.status === 'read') row.readAt ??= iso()
      }
      store.save(state)
    },

    // Sent in the last thirty days, as the database answers: a message to
    // somebody with read receipts off is never read, and would otherwise be
    // asked about on every connect for ever.
    outstandingMessageIds: async () =>
      store
        .load()
        .recipients.filter(
          (row) =>
            row.state === 'sent' &&
            row.messageId &&
            !row.readAt &&
            row.sentAt !== null &&
            Date.parse(row.sentAt) > clock.now() - 30 * 86_400_000,
        )
        .map((row) => row.messageId as string),

    releaseBatch: async () => {
      const state = store.load()
      if (state.campaign.state !== 'scheduled' || state.batch.state !== 'waiting') return false
      state.batch.state = 'released'
      store.save(state)
      return true
    },

    // A rehearsal has no owner's account to tell.
    finishNotices: async () => [],
    markFinishNotice: async () => {},

    pauseCampaign: async (_campaignId, reason) => {
      const state = store.load()
      if (state.campaign.state !== 'scheduled') return
      state.campaign.state = 'paused'
      state.campaign.pausedBecause = reason
      store.save(state)
    },
  }
}
