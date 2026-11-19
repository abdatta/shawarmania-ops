/**
 * The database's answers, read into the shapes the sending loop speaks
 * (design D6, `CampaignQueue` in `contracts.ts`).
 *
 * The functions answer in JSON with the database's own names
 * (`waiting_for_release`, `opens_at`, `image_path`). This module turns those
 * into `TickResult` and `ClaimResult`, and back again for what the sender
 * reports. It is plain data in and out, so the root test run holds it to the
 * same answers the stand-in queue gives, with no database running.
 *
 * Anything that does not read as the contract says is an error: a sender that
 * guessed at a half-understood answer could send when it should not.
 */

import type {
  FinishNotice,
  ClaimRefusal,
  ClaimResult,
  ReceiptReport,
  RecipientRef,
  SendResult,
  TickResult,
} from './contracts.ts'

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

export class QueueAnswerUnreadable extends Error {
  constructor(what: string) {
    super(`The database's answer could not be read: ${what}`)
    this.name = 'QueueAnswerUnreadable'
  }
}

function object(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new QueueAnswerUnreadable(what)
  }
  return value as Record<string, unknown>
}

function text(value: unknown, what: string): string {
  if (typeof value !== 'string' || value === '') throw new QueueAnswerUnreadable(what)
  return value
}

function count(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new QueueAnswerUnreadable(what)
  }
  return value
}

function instant(value: unknown, what: string): Date | null {
  if (value === null || value === undefined) return null
  const at = new Date(text(value, what))
  if (Number.isNaN(at.getTime())) throw new QueueAnswerUnreadable(what)
  return at
}

const REFUSALS: readonly ClaimRefusal[] = [
  'paused',
  'stopped',
  'not_released',
  'outside_window',
  'claim_in_flight',
]

export function readTick(answer: unknown): TickResult {
  const tick = object(answer, 'the tick')
  const window = object(tick['window'], 'the window')
  const released =
    tick['released'] === null || tick['released'] === undefined
      ? null
      : object(tick['released'], 'the released batch')
  const waiting =
    tick['waiting_for_release'] === null || tick['waiting_for_release'] === undefined
      ? null
      : object(tick['waiting_for_release'], 'the waiting batch')
  return {
    contractVersion: count(tick['contract_version'], 'the contract version'),
    standDown: tick['stand_down'] === true,
    minGapSeconds: count(tick['min_gap_seconds'], 'the shortest gap'),
    maxGapSeconds: count(tick['max_gap_seconds'], 'the longest gap'),
    window: {
      open: window['open'] === true,
      opensAt: instant(window['opens_at'], 'when the window opens'),
    },
    released: released && {
      campaignId: text(released['campaign_id'], 'the released campaign'),
      batchNo: count(released['batch_no'], 'the released batch'),
    },
    waitingForRelease: waiting && {
      campaignId: text(waiting['campaign_id'], 'the waiting campaign'),
      batchNo: count(waiting['batch_no'], 'the waiting batch'),
      campaignName: text(waiting['campaign_name'], 'the waiting campaign’s name'),
      recipients: count(waiting['recipients'], 'how many are waiting'),
    },
    campaignsOpen: tick['campaigns_open'] === true,
    sentToday: count(tick['sent_today'], 'how many went today'),
    lastBatchFinishedAt: instant(tick['last_batch_finished_at'], 'when the last batch finished'),
    testsWaiting: count(tick['tests_waiting'] ?? 0, 'how many tests wait'),
  }
}

function refusalOrNothing(claim: Record<string, unknown>): ClaimResult | null {
  if (claim['kind'] === 'nothing') return { kind: 'nothing' }
  if (claim['kind'] !== 'refused') return null
  const why = claim['why']
  if (!REFUSALS.includes(why as ClaimRefusal)) throw new QueueAnswerUnreadable('a refusal')
  return {
    kind: 'refused',
    why: why as ClaimRefusal,
    ...(why === 'outside_window'
      ? { opensAt: instant(claim['opens_at'], 'when the window opens') }
      : {}),
  }
}

/** `campaign_claim_next`: one customer, with the number read at this moment. */
export function readClaim(answer: unknown): ClaimResult {
  const claim = object(answer, 'the claim')
  const other = refusalOrNothing(claim)
  if (other) return other
  if (claim['kind'] !== 'claimed') throw new QueueAnswerUnreadable('the claim')
  const recipient = object(claim['recipient'], 'the recipient')
  return {
    kind: 'claimed',
    recipient: {
      ref: {
        campaignId: text(recipient['campaign_id'], 'the campaign'),
        batchNo: count(recipient['batch_no'], 'the batch'),
        customerId: text(recipient['customer_id'], 'the customer'),
        position: count(recipient['position'], 'the position'),
      },
      phone: text(recipient['phone'], 'the number'),
      name: typeof recipient['name'] === 'string' ? recipient['name'] : null,
      body: typeof recipient['body'] === 'string' ? recipient['body'] : '',
      imageUrl: typeof recipient['image_path'] === 'string' ? recipient['image_path'] : null,
    },
  }
}

/** `campaign_claim_next_test`: one of the owners' own test numbers. */
export function readTestClaim(answer: unknown): ClaimResult {
  const claim = object(answer, 'the test claim')
  const other = refusalOrNothing(claim)
  if (other) return other
  if (claim['kind'] !== 'claimed') throw new QueueAnswerUnreadable('the test claim')
  const recipient = object(claim['recipient'], 'the test')
  const testId = text(recipient['test_id'], 'the test')
  return {
    kind: 'claimed',
    recipient: {
      ref: {
        campaignId: text(recipient['campaign_id'], 'the campaign'),
        batchNo: 0,
        customerId: testId,
        position: 0,
        testId,
      },
      phone: text(recipient['phone'], 'the number'),
      name: null,
      body: typeof recipient['body'] === 'string' ? recipient['body'] : '',
      imageUrl: typeof recipient['image_path'] === 'string' ? recipient['image_path'] : null,
    },
  }
}

/** The arguments to `campaign_report_result`, or to `campaign_report_test_result` for a test. */
export function reportArguments(
  ref: RecipientRef,
  result: SendResult,
): { fn: 'campaign_report_result' | 'campaign_report_test_result'; args: Record<string, Json> } {
  const outcome: Record<string, Json> = {
    p_state: result.state,
    p_message_id: result.state === 'sent' ? result.messageId : null,
    p_failure_code: result.state === 'failed' ? result.code : null,
  }
  return ref.testId
    ? { fn: 'campaign_report_test_result', args: { p_test_id: ref.testId, ...outcome } }
    : {
        fn: 'campaign_report_result',
        args: { p_campaign_id: ref.campaignId, p_customer_id: ref.customerId, ...outcome },
      }
}

export function receiptArguments(receipts: readonly ReceiptReport[]): Json[] {
  return receipts.map((receipt) => ({
    message_id: receipt.messageId,
    status: receipt.status,
    ...(receipt.code === undefined ? {} : { code: receipt.code }),
  }))
}

/** `campaign_finish_notices`: finished campaigns and their owners' numbers. */
export function readFinishNotices(answer: unknown): FinishNotice[] {
  if (!Array.isArray(answer)) throw new QueueAnswerUnreadable('the finished campaigns')
  return answer.map((item) => {
    const notice = object(item, 'a finished campaign')
    const counts = object(notice['counts'], 'its totals')
    return {
      campaignId: text(notice['campaign_id'], 'its campaign'),
      campaignName: text(notice['name'], 'its name'),
      phone: text(notice['phone'], 'the owner’s number'),
      counts: {
        recipients: count(counts['recipients'], 'its customers'),
        sent: count(counts['sent'], 'how many were sent'),
        notOnWhatsapp: count(counts['not_on_whatsapp'], 'how many are not on WhatsApp'),
        failed: count(counts['failed'], 'how many failed'),
        unsure: count(counts['unsure'], 'how many are unsure'),
        stopped: count(counts['stopped'], 'how many stopped'),
      },
    }
  })
}

export function readMessageIds(answer: unknown): string[] {
  if (!Array.isArray(answer) || answer.some((id) => typeof id !== 'string')) {
    throw new QueueAnswerUnreadable('the outstanding message ids')
  }
  return answer as string[]
}
