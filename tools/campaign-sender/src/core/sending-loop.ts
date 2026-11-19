/**
 * The sending loop (a-campaign-goes-out-on-whatsapp, design D6).
 *
 * One recipient at a time: ask the queue, take one, look the number up, send,
 * record, wait. Everything it knows about the world comes through
 * `WhatsAppLink`, `CampaignQueue` and a clock, so it is tested whole with
 * fakes and decides nothing by itself about who is sent what: the queue hands
 * over a recipient or refuses to, and the loop obeys.
 *
 * **Nobody is sent a message twice, and that is bought by sometimes sending
 * nobody.** A recipient is marked as being sent to before the send and settled
 * after it. Whenever the loop cannot be sure it holds no unsettled recipient —
 * when it starts, each time WhatsApp reconnects, after a send nobody can vouch
 * for, after a claim whose answer was lost — it first has the queue turn every
 * such recipient into *unsure*, and an unsure recipient is never claimed
 * again. One customer may miss an offer [owner agreed].
 *
 * What a send can come to, and where it is decided:
 *
 *   number not on WhatsApp       `not_on_whatsapp`, and no wait before the next
 *   lookup or composing failed   `failed`: nothing left the laptop
 *   `send` returned an id        `sent`
 *   `send` threw `SendRefused`   `failed`, with its code
 *   `send` threw anything else   left as it is, and so *unsure*
 *   refused after it was sent    `failed`, when WhatsApp's verdict arrives
 *
 * A result that could not be recorded because the database was unreachable is
 * kept and recorded before anything else is asked: the message did go, and
 * calling it unsure would be throwing that knowledge away.
 *
 * **This module has no way to print and none to write a file**, and a test
 * holds it to that. A number, a name and a message body exist here only as
 * local values for the length of one send. What it tells its caller
 * (`SenderEvent`) carries positions and counts.
 */

import { reconnectDelayMs } from './backoff.ts'
import { QUEUE_CONTRACT_VERSION, SendRefused } from './contracts.ts'
import { finishNoticeText } from './finish-notice.ts'
import type {
  BatchRef,
  CampaignQueue,
  ClaimedRecipient,
  ClaimRefusal,
  Clock,
  LinkConnection,
  LinkEnd,
  OutgoingMessage,
  ReceiptListener,
  ReceiptReport,
  ReceiptStatus,
  RecipientRef,
  SenderPauseReason,
  SenderStatus,
  SendResult,
  TickResult,
  WaitingBatch,
  WhatsAppLink,
} from './contracts.ts'

/** How often the queue is asked while a campaign could start at any moment (D6). */
const TICK_BUSY_MS = 60_000
/** And while nothing could: no campaign open, outside the window, no connection. */
const TICK_QUIET_MS = 5 * 60_000
/** How many sends in a row may go wrong before the sender pauses the campaign itself. */
const TROUBLE_IN_A_ROW = 3

export type SenderEvent =
  | { kind: 'waiting_for_whatsapp' }
  /** Nothing may be sent. `waiting` is the batch an owner has yet to release, if there is one. */
  | { kind: 'idle'; campaignsOpen: boolean; waiting: WaitingBatch | null }
  | { kind: 'outside_hours'; opensAt: Date | null }
  /** The queue refused to hand anybody over, and why. */
  | { kind: 'held'; why: ClaimRefusal }
  | { kind: 'stood_down' }
  | { kind: 'database_unreachable'; retryInMs: number }
  | { kind: 'gap'; ms: number }
  | { kind: 'sent'; batchNo: number; position: number }
  | { kind: 'not_on_whatsapp'; batchNo: number; position: number }
  | { kind: 'failed'; batchNo: number; position: number; code: string }
  /** A send nobody can vouch for. The recipient becomes unsure. */
  | { kind: 'send_unclear'; batchNo: number; position: number }
  /** The queue would not record a result: the recipient was no longer this claim's. */
  | { kind: 'report_refused'; batchNo: number; position: number }
  | { kind: 'unsure'; count: number }
  | { kind: 'paused_by_sender'; campaignId: string; reason: SenderPauseReason }
  | { kind: 'batch_finished'; batchNo: number }
  | { kind: 'receipts'; delivered: number; read: number; rejected: number }
  /** A reply of STOP was passed to the database. `stopped`: it was a recent recipient. */
  | { kind: 'stop_reply'; stopped: boolean }
  /** The owner who submitted a campaign was sent its totals, or could not be. */
  | { kind: 'finish_notice'; sent: boolean }

/** `needs_update`: the queue speaks a contract this sender does not know (D14). */
export type SenderEnd = LinkEnd | { kind: 'needs_update' }

export interface SenderDeps {
  link: WhatsAppLink
  queue: CampaignQueue
  clock: Clock
  /** From 0 up to, not including, 1. */
  random: () => number
  /** Turns a claimed recipient into the message to send. If it rejects, nothing is sent. */
  compose: (recipient: ClaimedRecipient) => Promise<OutgoingMessage>
  onEvent: (event: SenderEvent) => void
  /** Told every answer the queue gives to the tick: what a page showing the sender's state is drawn from. */
  onTick?: (tick: TickResult) => void
  /**
   * Handed, once, a way to make the loop ask the queue now and not at its next
   * turn. For the moment the owner releases a batch: the first message should
   * not wait out the rest of an idle minute.
   */
  onReady?: (controls: { askNow: () => void }) => void
  signal: AbortSignal
}

/** The database could not be reached. Nothing else is caught by the loop. */
class QueueUnreachable extends Error {}

const RANK: Readonly<Record<ReceiptStatus, number>> = { delivered: 1, read: 2, rejected: 3 }

/** A wait drawn evenly between the two settings, in milliseconds. */
export function gapBetweenSends(
  minSeconds: number,
  maxSeconds: number,
  random: () => number,
): number {
  const low = Math.max(0, Math.min(minSeconds, maxSeconds))
  const high = Math.max(minSeconds, maxSeconds)
  return Math.round((low + (high - low) * random()) * 1000)
}

/**
 * Runs until its signal stops it, WhatsApp halts it, or it finds it cannot
 * work. Resolves with why. It never sends after it has resolved.
 */
export async function runSender(deps: SenderDeps): Promise<SenderEnd> {
  const { link, queue, clock, random, compose, onEvent } = deps

  // ── Stopping, and waking from a wait ──────────────────────────────────────

  const stop = new AbortController()
  let wake = new AbortController()
  const requestStop = () => {
    stop.abort()
    wake.abort()
  }
  deps.signal.addEventListener('abort', requestStop, { once: true })
  if (deps.signal.aborted) requestStop()
  // Cuts the current wait short. It changes nothing else: the gap between
  // messages is counted from the last send, not from the wait.
  deps.onReady?.({ askNow: () => wake.abort() })

  // ── The connection ────────────────────────────────────────────────────────

  let connection: LinkConnection | null = null
  /** Goes up every time a connection opens or closes. */
  let generation = 0
  /** The generation whose connection has been made ready: claims released, receipts heard. */
  let readyFor = -1
  /** A recipient may be marked as being sent to that this loop does not hold. */
  let claimMayBeStale = true
  /** A message may have gone since: the next waits a full gap from here. */
  let gapFrom: number | null = clock.now()
  let gapMs: number | null = null
  /** The two gap settings, as the queue last gave them. */
  let gaps: { min: number; max: number } | null = null

  /** How much of the gap is still to wait. Draws the gap the first time it is asked. */
  const gapRemaining = (): number => {
    if (gapFrom === null || gaps === null) return 0
    gapMs ??= gapBetweenSends(gaps.min, gaps.max, random)
    return gapFrom + gapMs - clock.now()
  }

  /** Waits, cut short by a stop or by the connection opening or closing. */
  const pause = async (ms: number, seen: number): Promise<void> => {
    if (stop.signal.aborted || generation !== seen) return
    wake = new AbortController()
    await clock.sleep(ms, wake.signal)
  }

  // ── Receipts ──────────────────────────────────────────────────────────────

  /** Campaign message ids a receipt could still change, with the most that has been reported. */
  const outstanding = new Map<string, number>()
  const toReport = new Map<string, ReceiptReport>()
  /** Receipts that came while a send was in flight, before its id was known. */
  let early: ReceiptReport[] = []
  let sendInFlight = false
  /** The last few sends, for noticing trouble. */
  const recent: Array<{ messageId: string | null; wentWrong: boolean }> = []

  const remember = (messageId: string | null, wentWrong: boolean): void => {
    recent.push({ messageId, wentWrong })
    while (recent.length > TROUBLE_IN_A_ROW) recent.shift()
  }

  const note = (receipt: ReceiptReport): void => {
    const rank = RANK[receipt.status]
    if (rank <= (outstanding.get(receipt.messageId) ?? 0)) return
    const waiting = toReport.get(receipt.messageId)
    if (!waiting || rank > RANK[waiting.status]) toReport.set(receipt.messageId, receipt)
    if (receipt.status === 'rejected') {
      for (const send of recent) if (send.messageId === receipt.messageId) send.wentWrong = true
    }
  }

  /**
   * Whether finished campaigns may be waiting for their notice: asked once
   * WhatsApp is up, and again each time a batch finishes.
   */
  let noticesDue = true
  /** Whether the last answer had a batch out. */
  let hadReleased = false

  /** Each owner told once, when nothing else is waiting to go. */
  const sendFinishNotices = async (via: LinkConnection): Promise<void> => {
    noticesDue = false
    const notices = await ask(() => queue.finishNotices())
    for (const notice of notices) {
      let sent = false
      try {
        const address = await via.resolve(notice.phone)
        if (address) {
          await via.send(address, { text: finishNoticeText(notice.campaignName, notice.counts) })
          sent = true
        }
      } catch {
        // Not sent: tried again the next time the sender starts.
      }
      if (sent) await ask(() => queue.markFinishNotice(notice.campaignId))
      tell({ kind: 'finish_notice', sent })
    }
  }

  /** Numbers that replied STOP, held only until the database has been told. */
  const stopReplies: string[] = []
  const heardStop = (phoneDigits: string): void => {
    stopReplies.push(phoneDigits)
    wake.abort()
  }
  const handOverStops = async (): Promise<void> => {
    while (stopReplies.length > 0) {
      const phone = stopReplies[0] as string
      const stopped = await ask(() => queue.recordStop(phone))
      stopReplies.shift()
      tell({ kind: 'stop_reply', stopped })
    }
  }

  const hear: ReceiptListener = (messageId, status, code) => {
    const receipt: ReceiptReport =
      code === undefined ? { messageId, status } : { messageId, status, code }
    if (outstanding.has(messageId)) note(receipt)
    else if (sendInFlight) early.push(receipt)
    // Anything else is about a message that is no campaign's. Almost every
    // status WhatsApp sends is, and it stops here.
  }

  // ── The queue ─────────────────────────────────────────────────────────────

  const ask = async <T>(call: () => Promise<T>): Promise<T> => {
    try {
      return await call()
    } catch {
      throw new QueueUnreachable()
    }
  }

  /** A result the queue has not yet been told. Kept until it has. */
  let owed: { ref: RecipientRef; result: SendResult } | null = null

  const settleOwed = async (): Promise<void> => {
    if (!owed) return
    const { ref, result } = owed
    const accepted = await ask(() => queue.report(ref, result))
    owed = null
    if (!accepted) {
      claimMayBeStale = true
      onEvent({ kind: 'report_refused', batchNo: ref.batchNo, position: ref.position })
    }
  }

  const settle = (ref: RecipientRef, result: SendResult): Promise<void> => {
    owed = { ref, result }
    return settleOwed()
  }

  const handOverReceipts = async (): Promise<void> => {
    if (toReport.size === 0) return
    const batch = [...toReport.values()]
    await ask(() => queue.reportReceipts(batch))
    const counts = { delivered: 0, read: 0, rejected: 0 }
    for (const receipt of batch) {
      counts[receipt.status] += 1
      if (toReport.get(receipt.messageId) === receipt) toReport.delete(receipt.messageId)
      // Delivered may still become read. Read and rejected are the last word.
      if (receipt.status === 'delivered') {
        if (outstanding.has(receipt.messageId)) outstanding.set(receipt.messageId, RANK.delivered)
      } else {
        outstanding.delete(receipt.messageId)
      }
    }
    onEvent({ kind: 'receipts', ...counts })
  }

  // ── What is said ──────────────────────────────────────────────────────────

  let lastState = ''
  /** A standing state, said once and not again on every tick. */
  const say = (event: SenderEvent): void => {
    const key = JSON.stringify(event)
    if (key === lastState) return
    lastState = key
    onEvent(event)
  }
  /** Something that happened. */
  const tell = (event: SenderEvent): void => {
    lastState = ''
    onEvent(event)
  }

  // ── One recipient ─────────────────────────────────────────────────────────

  const sendTo = async (recipient: ClaimedRecipient, via: LinkConnection): Promise<void> => {
    const { ref } = recipient
    const where = { batchNo: ref.batchNo, position: ref.position }

    let message: OutgoingMessage
    try {
      message = await compose(recipient)
    } catch {
      remember(null, true)
      tell({ kind: 'failed', ...where, code: 'compose_failed' })
      return settle(ref, { state: 'failed', code: 'compose_failed' })
    }

    let address: string | null
    try {
      address = await via.resolve(recipient.phone)
    } catch {
      // The lookup failed, so nothing was sent: that much is certain.
      remember(null, true)
      tell({ kind: 'failed', ...where, code: 'lookup_failed' })
      return settle(ref, { state: 'failed', code: 'lookup_failed' })
    }
    if (address === null) {
      tell({ kind: 'not_on_whatsapp', ...where })
      return settle(ref, { state: 'not_on_whatsapp' })
    }

    let messageId: string | null = null
    let refused: string | null = null
    sendInFlight = true
    try {
      messageId = await via.send(address, message)
    } catch (error) {
      if (error instanceof SendRefused) refused = error.code
    } finally {
      sendInFlight = false
    }
    // Whatever happened, a message may have left. The next waits its gap.
    gapFrom = clock.now()
    gapMs = null
    const heardEarly = early
    early = []

    if (messageId !== null) {
      outstanding.set(messageId, 0)
      remember(messageId, false)
      for (const receipt of heardEarly) if (receipt.messageId === messageId) note(receipt)
      tell({ kind: 'sent', ...where })
      return settle(ref, { state: 'sent', messageId })
    }
    remember(null, true)
    if (refused !== null) {
      tell({ kind: 'failed', ...where, code: refused })
      return settle(ref, { state: 'failed', code: refused })
    }
    // Nobody can say whether it went. The recipient stays marked as being sent
    // to, and is turned to unsure before anybody else is claimed.
    claimMayBeStale = true
    tell({ kind: 'send_unclear', ...where })
  }

  // ── The loop ──────────────────────────────────────────────────────────────

  const work = async (): Promise<SenderEnd | null> => {
    let status: SenderStatus = 'idle'
    let unreachableFor = 0

    while (!stop.signal.aborted) {
      const seen = generation
      let claiming = false
      try {
        // What the database is owed comes before anything it is asked.
        await settleOwed()

        const via = connection
        if (!via) {
          say({ kind: 'waiting_for_whatsapp' })
          await pause(TICK_QUIET_MS, seen)
          continue
        }

        if (claimMayBeStale || readyFor !== seen) {
          const released = await ask(() => queue.releaseStaleClaims())
          claimMayBeStale = false
          if (released > 0) tell({ kind: 'unsure', count: released })
        }
        if (readyFor !== seen) {
          const ids = await ask(() => queue.outstandingMessageIds())
          if (generation !== seen) continue
          outstanding.clear()
          for (const id of ids) outstanding.set(id, 0)
          // Only now: the first listener is handed everything WhatsApp was
          // holding, and it can be matched only once the ids are known.
          via.onReceipt(hear)
          via.onStopReply?.(heardStop)
          readyFor = seen
        }

        // The gap is waited out before the queue is asked, so that its answer
        // is fresh when it is acted on: a pause, a stop or the window closing
        // during the wait is obeyed before the next message.
        const beforeAsking = gapRemaining()
        if (beforeAsking > 0) {
          say({ kind: 'gap', ms: beforeAsking })
          await pause(beforeAsking, seen)
          continue
        }

        await handOverReceipts()
        await handOverStops()

        const tick: TickResult = await ask(() => queue.tick(status))
        unreachableFor = 0
        deps.onTick?.(tick)
        if (tick.contractVersion !== QUEUE_CONTRACT_VERSION) return { kind: 'needs_update' }
        gaps = { min: tick.minGapSeconds, max: tick.maxGapSeconds }

        if (tick.standDown) {
          status = 'idle'
          say({ kind: 'stood_down' })
          await pause(TICK_QUIET_MS, seen)
          continue
        }

        // The owners' own test numbers go first, by themselves: no release, and
        // whatever the window says [owner, 2026-11-18]. Paced like anything
        // else, so the gap above has been waited.
        if (tick.testsWaiting > 0) {
          status = 'sending'
          // The first question of a run is the one that learns the gap.
          if (gapRemaining() > 0) continue
          if (stop.signal.aborted || generation !== seen) continue
          gapFrom = null
          gapMs = null
          claiming = true
          const test = await ask(() => queue.claimNextTest())
          claiming = false
          if (test.kind === 'claimed') {
            await sendTo(test.recipient, via)
            continue
          }
          if (test.kind === 'refused') {
            claimMayBeStale = true
            say({ kind: 'held', why: test.why })
            await pause(TICK_BUSY_MS, seen)
            continue
          }
          // Nothing after all: carry on with the customers.
        }

        const batch: BatchRef | null = tick.released
        // A batch that was out and is out no more has finished: its campaign may
        // have finished with it.
        if (hadReleased && !batch) noticesDue = true
        hadReleased = batch !== null
        if (!batch && noticesDue) {
          await sendFinishNotices(via)
          continue
        }
        if (!batch) {
          status = 'idle'
          // Said once for each batch that comes to wait, which is what a
          // notification hangs on (D7).
          say({
            kind: 'idle',
            campaignsOpen: tick.campaignsOpen,
            waiting: tick.waitingForRelease,
          })
          await pause(tick.campaignsOpen ? TICK_BUSY_MS : TICK_QUIET_MS, seen)
          continue
        }

        if (!tick.window.open) {
          status = 'outside_hours'
          say({ kind: 'outside_hours', opensAt: tick.window.opensAt })
          await pause(untilOpen(tick.window.opensAt), seen)
          continue
        }
        status = 'sending'

        if (recent.length === TROUBLE_IN_A_ROW && recent.every((send) => send.wentWrong)) {
          await ask(() => queue.pauseCampaign(batch.campaignId, 'three_in_a_row'))
          recent.length = 0
          tell({
            kind: 'paused_by_sender',
            campaignId: batch.campaignId,
            reason: 'three_in_a_row',
          })
          continue
        }

        // Only the very first question finds a gap still to wait: until it is
        // answered the loop does not know how long the gap is.
        if (gapRemaining() > 0) continue
        gapFrom = null
        gapMs = null

        if (stop.signal.aborted || generation !== seen) continue
        claiming = true
        const claim = await ask(() => queue.claimNext(batch))
        claiming = false

        if (claim.kind === 'refused') {
          // A recipient is in hand that this loop does not hold.
          if (claim.why === 'claim_in_flight') claimMayBeStale = true
          if (claim.why === 'outside_window') {
            status = 'outside_hours'
            say({ kind: 'outside_hours', opensAt: claim.opensAt ?? null })
            await pause(untilOpen(claim.opensAt ?? null), seen)
          } else {
            say({ kind: 'held', why: claim.why })
            await pause(TICK_BUSY_MS, seen)
          }
          continue
        }
        if (claim.kind === 'nothing') {
          noticesDue = true
          tell({ kind: 'batch_finished', batchNo: batch.batchNo })
          await pause(TICK_BUSY_MS, seen)
          continue
        }

        await sendTo(claim.recipient, via)
      } catch (error) {
        if (!(error instanceof QueueUnreachable)) throw error
        // The claim may have been made and only its answer lost.
        if (claiming) claimMayBeStale = true
        const wait = reconnectDelayMs(unreachableFor, random)
        unreachableFor += 1
        say({ kind: 'database_unreachable', retryInMs: wait })
        await pause(wait, generation)
      }
    }
    return null
  }

  const untilOpen = (opensAt: Date | null): number =>
    opensAt
      ? Math.min(TICK_QUIET_MS, Math.max(1_000, opensAt.getTime() - clock.now()))
      : TICK_QUIET_MS

  // ── Holding the link while working ────────────────────────────────────────

  // The link is stopped only after the loop has finished the recipient it has
  // in hand, so Ctrl+C mid-send does not cut that send off and leave it unsure.
  const linkStop = new AbortController()
  const held = link
    .hold(
      {
        onOpen: (opened) => {
          connection = opened
          generation += 1
          // A reconnect is not a licence to send at once.
          gapFrom = clock.now()
          gapMs = null
          wake.abort()
        },
        onClose: () => {
          connection = null
          generation += 1
          wake.abort()
        },
      },
      linkStop.signal,
    )
    .finally(requestStop)

  let workEnd: SenderEnd | null
  try {
    workEnd = await work()
  } finally {
    requestStop()
    linkStop.abort()
  }
  const linkEnd = await held

  // On the way out, whatever is known and not yet told, tried once.
  try {
    await settleOwed()
    await handOverReceipts()
    await handOverStops()
    if (linkEnd.kind === 'halted') await ask(() => queue.tick('halted', linkEnd.reason))
  } catch {
    // The database is unreachable. A halt is already recorded on the laptop.
  }

  deps.signal.removeEventListener('abort', requestStop)
  return workEnd ?? linkEnd
}

/** The real clock. */
export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise<void>((resolve) => {
      if (signal.aborted) return resolve()
      const timer = setTimeout(done, ms)
      function done() {
        clearTimeout(timer)
        signal.removeEventListener('abort', done)
        resolve()
      }
      signal.addEventListener('abort', done, { once: true })
    }),
}
