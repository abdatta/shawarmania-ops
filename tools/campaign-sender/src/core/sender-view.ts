/**
 * What the sender is doing, as one small picture a person can read
 * (design D7).
 *
 * The loop says what happens as a stream of events and tick answers. The Send
 * batch page, the tray icon and the pinned card all need the same summary of
 * that stream: what state is it in, is a batch waiting for the owner, what has
 * gone out, is anything wrong. This module keeps that summary. It is plain
 * data in and plain data out, so it is tested without a page or a window.
 *
 * **`attention` is the one thing that asks for the owner.** It is what the
 * pinned card shows. Each has an `id`, and the card treats a new id as new
 * news: putting a card away hides that id only, so the next batch to wait
 * brings the card back by itself.
 *
 * Nothing here holds a phone number or a message. A campaign's name does
 * appear: it is the owners' own label for it.
 */

import type { BatchRef, TickResult, WaitingBatch } from './contracts.ts'
import type { SenderEnd, SenderEvent } from './sending-loop.ts'

export type SenderMood =
  | 'connecting'
  | 'idle'
  | 'waiting_for_you'
  | 'sending'
  | 'outside_hours'
  | 'held'
  | 'database_unreachable'
  | 'stood_down'
  | 'halted'
  | 'stopped'

export interface Attention {
  id: string
  /** `action`: the owner is needed. `done`: news. `alarm`: something is wrong. */
  tone: 'action' | 'done' | 'alarm'
  title: string
  lines: string[]
}

export interface SenderView {
  mood: SenderMood
  /** One line saying what the sender is doing now. */
  headline: string
  waiting: WaitingBatch | null
  released: BatchRef | null
  /** Null until the queue has answered once. */
  sentToday: number | null
  lastBatchFinishedAt: string | null
  windowOpensAt: string | null
  /** What this run of the sender has done since it started. */
  thisRun: { sent: number; notOnWhatsApp: number; failed: number; unsure: number }
  /** A notice that stays until something newer replaces it. */
  notice: Attention | null
  attention: Attention | null
  updatedAt: string
}

export interface ViewContext {
  now: number
  /** A clock time as the owner reads it on this laptop, e.g. `14:05`. */
  clockText: (ms: number) => string
}

const HELD_WORDS = {
  paused: 'The campaign is paused',
  stopped: 'The campaign was stopped',
  not_released: 'The batch is not released',
  outside_window: 'Outside the sending window',
  claim_in_flight: 'Settling an interrupted send',
} as const

export function startingView(context: ViewContext): SenderView {
  return {
    mood: 'connecting',
    headline: 'Connecting to WhatsApp',
    waiting: null,
    released: null,
    sentToday: null,
    lastBatchFinishedAt: null,
    windowOpensAt: null,
    thisRun: { sent: 0, notOnWhatsApp: 0, failed: 0, unsure: 0 },
    notice: null,
    attention: null,
    updatedAt: new Date(context.now).toISOString(),
  }
}

/** The card for a waiting batch is drawn afresh each time, so its figures stay current. */
function waitingCard(view: SenderView, context: ViewContext): Attention | null {
  const { waiting } = view
  if (!waiting) return null
  const lines = [`“${waiting.campaignName}” · ${waiting.recipients} people`]
  if (view.sentToday !== null) lines.push(`Sent today: ${view.sentToday}`)
  lines.push(
    view.lastBatchFinishedAt
      ? `Last batch finished at ${context.clockText(Date.parse(view.lastBatchFinishedAt))}`
      : 'No batch has finished yet',
  )
  return {
    id: `waiting:${waiting.campaignId}:${waiting.batchNo}`,
    tone: 'action',
    title: `Batch ${waiting.batchNo} is waiting for you`,
    lines,
  }
}

function settle(view: SenderView, context: ViewContext): SenderView {
  const alarm = view.notice?.tone === 'alarm' ? view.notice : null
  return {
    ...view,
    attention: alarm ?? waitingCard(view, context) ?? view.notice,
    updatedAt: new Date(context.now).toISOString(),
  }
}

export function viewAfterTick(
  view: SenderView,
  tick: TickResult,
  context: ViewContext,
): SenderView {
  return settle(
    {
      ...view,
      waiting: tick.waitingForRelease,
      released: tick.released,
      sentToday: tick.sentToday,
      lastBatchFinishedAt: tick.lastBatchFinishedAt?.toISOString() ?? null,
      windowOpensAt: tick.window.open ? null : (tick.window.opensAt?.toISOString() ?? null),
    },
    context,
  )
}

export function viewAfterEvent(
  view: SenderView,
  event: SenderEvent,
  context: ViewContext,
): SenderView {
  const next: SenderView = { ...view, thisRun: { ...view.thisRun } }
  // Batch 0 is the owners' own test numbers.
  const sending = (batchNo: number) => {
    next.mood = 'sending'
    next.headline = batchNo === 0 ? 'Sending to the test numbers' : `Sending batch ${batchNo}`
  }

  switch (event.kind) {
    case 'waiting_for_whatsapp':
      next.mood = 'connecting'
      next.headline = 'Connecting to WhatsApp'
      break
    case 'idle':
      next.waiting = event.waiting
      next.mood = event.waiting ? 'waiting_for_you' : 'idle'
      next.headline = event.waiting
        ? `Batch ${event.waiting.batchNo} of “${event.waiting.campaignName}” is waiting for you`
        : 'Nothing to send'
      break
    case 'outside_hours':
      next.mood = 'outside_hours'
      next.headline = 'Outside the sending window'
      next.windowOpensAt = event.opensAt?.toISOString() ?? null
      break
    case 'held':
      next.mood = 'held'
      next.headline = HELD_WORDS[event.why]
      break
    case 'stood_down':
      next.mood = 'stood_down'
      next.headline = 'Another sender is the one in use'
      break
    case 'database_unreachable':
      next.mood = 'database_unreachable'
      next.headline = 'Cannot reach the database'
      break
    case 'gap':
      if (next.released) sending(next.released.batchNo)
      break
    case 'sent':
      next.thisRun.sent += 1
      sending(event.batchNo)
      break
    case 'not_on_whatsapp':
      next.thisRun.notOnWhatsApp += 1
      sending(event.batchNo)
      break
    case 'failed':
      next.thisRun.failed += 1
      sending(event.batchNo)
      break
    case 'unsure':
      next.thisRun.unsure += event.count
      break
    case 'paused_by_sender':
      next.notice = {
        id: `paused:${event.campaignId}:${context.now}`,
        tone: 'alarm',
        title: 'The sender paused the campaign',
        lines: [
          'Three sends in a row went wrong.',
          'Look at the campaign in the app before resuming it.',
        ],
      }
      break
    case 'batch_finished':
      next.notice = {
        id: `finished:${event.batchNo}:${context.now}`,
        tone: 'done',
        title: `Batch ${event.batchNo} is finished`,
        lines: [`Finished at ${context.clockText(context.now)}`],
      }
      break
    case 'send_unclear':
    case 'report_refused':
    case 'receipts':
    case 'stop_reply':
    case 'finish_notice':
      break
  }
  return settle(next, context)
}

/** @param explanation what to tell the owner when the sender halted. */
export function viewAfterEnd(
  view: SenderView,
  end: SenderEnd,
  explanation: string,
  context: ViewContext,
): SenderView {
  if (end.kind === 'halted') {
    return settle(
      {
        ...view,
        mood: 'halted',
        headline: 'Halted. Nothing will be sent',
        waiting: null,
        notice: {
          id: `halted:${end.reason}:${context.now}`,
          tone: 'alarm',
          title: 'The sender has halted',
          lines: [explanation],
        },
      },
      context,
    )
  }
  return settle({ ...view, mood: 'stopped', headline: 'The sender has stopped' }, context)
}
