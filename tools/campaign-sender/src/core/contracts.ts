/**
 * The two things the sending loop talks to, and nothing else it may touch
 * (a-campaign-goes-out-on-whatsapp, design D3, D6).
 *
 * `WhatsAppLink` is the linked-device connection. `CampaignQueue` is the
 * database. The loop in `sending-loop.ts` is written against these two and an
 * injected clock, so the root test run drives it with fakes and no WhatsApp,
 * no Supabase and no real time.
 *
 * This file declares shapes and imports nothing.
 */

// ── WhatsApp ────────────────────────────────────────────────────────────────

export interface OutgoingMessage {
  text: string
  /** One image, sent with `text` as its caption. */
  image?: Buffer
}

/**
 * What WhatsApp later says about a message this sender sent.
 *
 * `rejected` is WhatsApp refusing a message *after* `send` returned its id:
 * Baileys hands a message to the socket and returns, and the server's verdict
 * arrives afterwards (design, *The sending loop, rehearsed*).
 */
export type ReceiptStatus = 'delivered' | 'read' | 'rejected'

export type ReceiptListener = (messageId: string, status: ReceiptStatus, code?: string) => void

/**
 * `send` throws this, and only this, when it is **certain the message did not
 * go**: WhatsApp refused it, or it failed before anything left the laptop.
 * Anything else thrown by `send` means nobody knows, and the loop treats the
 * recipient as *unsure*.
 */
export class SendRefused extends Error {
  readonly code: string

  constructor(code: string) {
    super(`not sent: ${code}`)
    this.name = 'SendRefused'
    this.code = code
  }
}

/**
 * One open connection. Numbers go in as digits with country code and never
 * come back out.
 */
export interface LinkConnection {
  /** The address to send to, or null when the number is not on WhatsApp. */
  resolve: (phoneDigits: string) => Promise<string | null>
  /** Sends and returns WhatsApp's id for the message. See `SendRefused`. */
  send: (address: string, message: OutgoingMessage) => Promise<string>
  /**
   * Told what happens to messages this account sent. The first listener is
   * also handed whatever arrived before it asked: WhatsApp delivers held
   * receipts the moment a connection is made.
   */
  onReceipt: (listener: ReceiptListener) => void
  /**
   * Told the phone number, as digits, of whoever replied STOP to this account,
   * and of nobody else: every other incoming message is dropped unread by the
   * link itself (design D11). Like receipts, the first listener is handed what
   * came before it asked.
   */
  onStopReply?: (listener: (phoneDigits: string) => void) => void
}

export interface LinkHandlers {
  /** A connection is up. Called again, with a new one, after every reconnect. */
  onOpen: (connection: LinkConnection) => void
  /** The connection last given to `onOpen` is gone. */
  onClose: () => void
}

export type LinkEnd =
  /** The caller's signal stopped it. */
  | { kind: 'stopped' }
  /** WhatsApp ended the session or restricted the account (D10). Never retried. */
  | { kind: 'halted'; reason: string }
  /** There is no link to hold, or WhatsApp no longer accepts this sender. */
  | { kind: 'unusable'; why: 'not_linked' | 'outdated' }

export interface WhatsAppLink {
  /**
   * Connects and stays connected, reconnecting after ordinary drops, until the
   * signal stops it or WhatsApp halts it. Resolves once; never rejects.
   */
  hold: (handlers: LinkHandlers, signal: AbortSignal) => Promise<LinkEnd>
}

// ── The queue ───────────────────────────────────────────────────────────────

/** The version of this contract the loop speaks (D14). */
export const QUEUE_CONTRACT_VERSION = 1

/** What the sender says about itself with each tick (D5, `marketing_sender.status`). */
export type SenderStatus = 'idle' | 'sending' | 'outside_hours' | 'halted'

export interface BatchRef {
  campaignId: string
  batchNo: number
}

/** A batch nobody has released yet, as the laptop shows it to the owner. */
export interface WaitingBatch extends BatchRef {
  campaignName: string
  /** How many people are in the batch. */
  recipients: number
}

export interface TickResult {
  /** A loop that does not recognise it stops and says it needs updating (D14). */
  contractVersion: number
  /** Another installation was seen recently; this one must not send (D12). */
  standDown: boolean
  minGapSeconds: number
  maxGapSeconds: number
  /**
   * The sending window as the database's clock reads it (D8). The laptop's
   * clock is never asked whether it is daytime in India.
   */
  window: { open: boolean; opensAt: Date | null }
  /** The batch an owner has released and that may be sent now, if any. */
  released: BatchRef | null
  /**
   * The next batch waiting for an owner to release it on this laptop, if any
   * (D7). It is what the notification is about and what the Send batch page
   * shows. Null while a batch is released: one batch at a time.
   */
  waitingForRelease: WaitingBatch | null
  /** Any campaign scheduled or paused: the reason to ask again in a minute. */
  campaignsOpen: boolean
  /** Messages recorded as sent since midnight in India. Shown beside Send batch. */
  sentToday: number
  /** When the last batch to finish did so, in any campaign. */
  lastBatchFinishedAt: Date | null
  /**
   * Messages to the owners' own test numbers waiting to go. The sender sends
   * them by itself, before anything else, with no release and whatever the
   * window says [owner, 2026-11-18].
   */
  testsWaiting: number
}

export interface RecipientRef extends BatchRef {
  customerId: string
  position: number
  /**
   * Set for a message to one of the owners' own test numbers, which the queue
   * hands over with `claimNextTest`. Such a ref has batch number 0, and its
   * `customerId` is the test's id: it is nobody in the customer list.
   */
  testId?: string
}

export interface ClaimedRecipient {
  ref: RecipientRef
  /** Digits with country code. Held for one send and never written anywhere. */
  phone: string
  name: string | null
  body: string
  imageUrl: string | null
}

export type ClaimRefusal =
  'paused' | 'stopped' | 'not_released' | 'outside_window' | 'claim_in_flight'

export type ClaimResult =
  | { kind: 'claimed'; recipient: ClaimedRecipient }
  /** Nobody is left waiting in this batch. */
  | { kind: 'nothing' }
  | { kind: 'refused'; why: ClaimRefusal; opensAt?: Date | null }

export type SendResult =
  | { state: 'sent'; messageId: string }
  | { state: 'failed'; code: string }
  | { state: 'not_on_whatsapp' }

export interface ReceiptReport {
  messageId: string
  status: ReceiptStatus
  code?: string
}

/** A finished campaign whose owner has not yet been told (task 4.7). */
export interface FinishNotice {
  campaignId: string
  campaignName: string
  /** The owner who submitted it: their own number, as digits. */
  phone: string
  counts: {
    recipients: number
    sent: number
    notOnWhatsapp: number
    failed: number
    unsure: number
    stopped: number
  }
}

/** Why the sender itself paused a campaign. Shown to the owners as the reason. */
export type SenderPauseReason = 'three_in_a_row'

/**
 * Every method may reject when the database cannot be reached. The loop then
 * sends nothing and asks again later.
 */
export interface CampaignQueue {
  /** The heartbeat and the question (D6). */
  tick: (status: SenderStatus, haltReason?: string) => Promise<TickResult>
  /**
   * Marks the next waiting recipient as being sent to and hands them over.
   * The one place a phone number leaves the database.
   */
  claimNext: (batch: BatchRef) => Promise<ClaimResult>
  /**
   * The oldest message to a test number, with no release and no window. Never
   * refused but as `claim_in_flight`; `nothing` when none waits.
   */
  claimNextTest: () => Promise<ClaimResult>
  /**
   * Records what happened to a claimed recipient, or to a test when the ref has
   * a `testId`. False when the row was not this claim's to settle.
   */
  report: (ref: RecipientRef, result: SendResult) => Promise<boolean>
  /** Every recipient still marked as being sent to becomes *unsure*. Returns how many. */
  releaseStaleClaims: () => Promise<number>
  reportReceipts: (receipts: readonly ReceiptReport[]) => Promise<void>
  /** Ids of campaign messages a receipt could still change. */
  outstandingMessageIds: () => Promise<string[]>
  /** The sender pausing a campaign itself, with the reason the page shows. */
  pauseCampaign: (campaignId: string, reason: SenderPauseReason) => Promise<void>
  /**
   * A reply of STOP from this number. True when it was a customer sent a
   * campaign in the last thirty days, who is now on the stopped list; false
   * for anybody else, which changes nothing.
   */
  recordStop: (phoneDigits: string) => Promise<boolean>
  /** Finished campaigns, last week's, whose owner has not been sent their totals. */
  finishNotices: () => Promise<FinishNotice[]>
  /** The owner was sent the totals. */
  markFinishNotice: (campaignId: string) => Promise<void>
}

/**
 * The one thing the laptop does to a campaign on the owner's say-so: release
 * the batch that is waiting (design D7). Not part of `CampaignQueue`, because
 * the loop never calls it; the Send batch page does, when the owner presses.
 */
export interface BatchReleaser {
  /** False when the batch was not waiting any more, or another is still sending. */
  releaseBatch: (batch: BatchRef) => Promise<boolean>
}

// ── Time ────────────────────────────────────────────────────────────────────

export interface Clock {
  /** Milliseconds since the epoch. */
  now: () => number
  /** Resolves after `ms`, or as soon as the signal aborts. Never rejects. */
  sleep: (ms: number, signal: AbortSignal) => Promise<void>
}
