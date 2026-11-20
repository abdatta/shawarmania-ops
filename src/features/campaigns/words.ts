import { DataActionError } from '@/data-access/adapters'
import type {
  CampaignTestSend,
  CampaignAudience,
  CampaignBatchReading,
  CampaignSenderReading,
  CampaignSummary,
} from '@/data-access/campaigns'
import { formatBusinessDateShort, formatDayTime, formatFreshness, formatPaise } from '@/domain'

/**
 * What the Campaigns pages say, worked out in one place
 * (a-campaign-goes-out-on-whatsapp).
 *
 * Every page reads the same rows, and two owners on two phones must read the
 * same thing off them. So the sentences are derived here from what the sender
 * last reported and how far each batch has got, and the components only draw
 * them.
 *
 * **The one rule that outranks the rest: a campaign is never shown as sending
 * while the sender has not been seen** (spec, *The app says truthfully where
 * the sender is*). What the sender last said about itself is a claim with a
 * time on it, and past that time it is not repeated.
 */

/**
 * How long after its last word the sender still counts as online.
 *
 * It asks the database once a minute while a campaign is open and once every
 * five minutes otherwise (design D6), so ten minutes is two missed questions at
 * its slowest. The same ten minutes after which a second sender may take over
 * (design D12).
 */
export const SENDER_SEEN_WITHIN_MS = 10 * 60_000

export type SenderTone = 'live' | 'quiet' | 'trouble'

export interface SenderLineWords {
  /** `live` is the only tone with a dot: a coloured dot is for a live state. */
  tone: SenderTone
  headline: string
  detail: string | null
}

/** Seen recently enough to be believed, and able to send at all. */
export function senderOnline(sender: CampaignSenderReading): boolean {
  if (sender.status === 'halted' || sender.status === 'not_linked') return false
  if (sender.lastSeenAt === null) return false
  return Date.parse(sender.serverNow) - Date.parse(sender.lastSeenAt) <= SENDER_SEEN_WITHIN_MS
}

/** `10:00:00` → `10:00 am`. The window is the customers' clock, so no zone is converted. */
export function windowTime(time: string): string {
  const [hours = 0, minutes = 0] = time.split(':').map(Number)
  const hour = hours % 12 === 0 ? 12 : hours % 12
  return `${hour}:${String(minutes).padStart(2, '0')} ${hours < 12 ? 'am' : 'pm'}`
}

const HALT_REASONS: Readonly<Record<string, string>> = {
  logged_out: 'WhatsApp logged it out',
  forbidden: 'WhatsApp refused it',
  banned: 'WhatsApp refused it',
  restricted: 'WhatsApp restricted the account',
}

/** `Yesterday, 09:00 pm` → `yesterday, 09:00 pm`, to sit mid-sentence. */
function sinceWords(instant: string, now: string): string {
  const words = formatDayTime(instant, now)
  return words.replace(/^(Today|Yesterday)/, (word) => word.toLowerCase())
}

/**
 * The line above the list and above a campaign: whether the sender is online,
 * when it was last seen, and what it is waiting on.
 *
 * `campaigns` is every campaign for the list, or the one campaign for its own
 * page.
 */
export function senderLine(
  sender: CampaignSenderReading,
  campaigns: readonly CampaignSummary[],
  /** On one campaign's page: the campaign whose batch is out ahead of it. */
  behind: string | null = null,
): SenderLineWords {
  const open = campaigns.filter((campaign) => campaign.state === 'scheduled')
  const going = campaigns.some(
    (campaign) => campaign.state === 'scheduled' || campaign.state === 'paused',
  )

  if (sender.status === 'not_linked') {
    // Linking is by QR code on the laptop, and no code of any kind is shown
    // here (design D9).
    return { tone: 'quiet', headline: 'Sender not linked', detail: 'link it on the laptop' }
  }
  if (sender.status === 'halted') {
    const reason = HALT_REASONS[sender.haltReason ?? ''] ?? 'it stopped itself'
    return {
      tone: 'trouble',
      headline: 'Sender halted',
      detail: `${reason} · restart it on the laptop`,
    }
  }
  if (!senderOnline(sender)) {
    if (sender.lastSeenAt === null) {
      return { tone: 'quiet', headline: 'Sender not seen yet', detail: null }
    }
    const since = `since ${sinceWords(sender.lastSeenAt, sender.serverNow)}`
    return {
      tone: 'quiet',
      headline: `Sender offline ${since}`,
      detail: going ? 'it carries on when the laptop is back' : null,
    }
  }

  if (sender.status === 'outside_hours' && going) {
    return {
      tone: 'live',
      headline: 'Sender online',
      detail: `waiting for ${windowTime(sender.windowStart)} in India`,
    }
  }
  // One batch at a time across every campaign (design D7): this one waits.
  if (behind !== null && open.length > 0) {
    return { tone: 'live', headline: 'Sender online', detail: `${behind} goes first` }
  }
  const sending = open.find((campaign) => campaign.sendingBatchNo !== null)
  if (sending) {
    return {
      tone: 'live',
      headline: 'Sender online',
      detail: `sending batch ${sending.sendingBatchNo}`,
    }
  }
  const waiting = open.find((campaign) => campaign.nextBatchNo !== null)
  if (waiting) {
    const held =
      waiting.notBefore !== null && Date.parse(waiting.notBefore) > Date.parse(sender.serverNow)
    return {
      tone: 'live',
      headline: 'Sender online',
      detail: held
        ? `batch ${waiting.nextBatchNo} can go from ${formatDayTime(waiting.notBefore ?? '', sender.serverNow)}`
        : `batch ${waiting.nextBatchNo} waiting on the laptop`,
    }
  }
  return { tone: 'live', headline: 'Sender online', detail: null }
}

export type CampaignShownState =
  'draft' | 'submitted' | 'sending' | 'waiting' | 'paused' | 'stopped' | 'done'

/**
 * What a campaign is doing, as its row says it. `scheduled` in the database
 * covers three things a reader tells apart: submitted and not started, sending
 * now, and between batches or waiting for the sender. The pages never say
 * "scheduled": nothing is promised for a time [owner, 2026-11-18].
 */
export function campaignShownState(
  campaign: CampaignSummary,
  sender: CampaignSenderReading,
): CampaignShownState {
  if (campaign.state !== 'scheduled') return campaign.state
  if (campaign.sendingBatchNo !== null && senderOnline(sender) && sender.status === 'sending') {
    return 'sending'
  }
  return campaign.sent === 0 && campaign.sendingBatchNo === null ? 'submitted' : 'waiting'
}

/** Why the sender paused a campaign itself (design D6), or null when an owner did. */
export function pausedReasonWords(reason: string | null): string | null {
  if (reason === null) return null
  if (reason === 'three_in_a_row') return 'The sender paused it: three sends in a row went wrong.'
  return 'The sender paused it.'
}

export interface BatchWords {
  /** One word: the batch's state as a reader says it. */
  state: 'done' | 'sending' | 'waiting' | 'paused' | 'not sent'
  /** What goes beside it: figures for a batch that has sent, a pointer for one that waits. */
  figures: string | null
  /** The outcomes that are not a delivery, where any happened. */
  others: string | null
}

function otherOutcomes(batch: CampaignBatchReading): string | null {
  const parts = [
    batch.notOnWhatsApp > 0 ? `${batch.notOnWhatsApp} not on WhatsApp` : null,
    batch.unsure > 0 ? `${batch.unsure} unsure` : null,
    batch.failed > 0 ? `${batch.failed} failed` : null,
    batch.stopped > 0 ? `${batch.stopped} stopped` : null,
  ].filter((part): part is string => part !== null)
  return parts.length > 0 ? parts.join(' · ') : null
}

/** One batch row of a campaign's page. */
export function batchWords(
  batch: CampaignBatchReading,
  campaign: CampaignSummary,
  sender: CampaignSenderReading,
  /** Another campaign's batch is sending, so this campaign waits its turn. */
  behind: boolean,
): BatchWords {
  const settled = batch.recipients - batch.toGo
  const others = otherOutcomes(batch)
  if (batch.state === 'done') {
    // Delivered keeps rising after a batch is done, so it is never called final.
    return {
      state: 'done',
      figures: `${batch.delivered} delivered · ${batch.read} read`,
      others,
    }
  }
  if (campaign.state === 'stopped' || campaign.state === 'done') {
    return {
      state: 'not sent',
      figures: settled > 0 ? `${settled} of ${batch.recipients} went` : null,
      others,
    }
  }
  if (batch.state === 'released') {
    const progress = `${settled} of ${batch.recipients}`
    if (campaign.state === 'paused') return { state: 'paused', figures: progress, others }
    if (sender.status === 'halted') {
      return { state: 'waiting', figures: `${progress} · sender halted`, others }
    }
    if (sender.status === 'not_linked') {
      return { state: 'waiting', figures: `${progress} · sender not linked`, others }
    }
    if (!senderOnline(sender)) {
      return { state: 'waiting', figures: `${progress} · sender offline`, others }
    }
    if (sender.status === 'outside_hours') {
      return {
        state: 'waiting',
        figures: `${progress} · from ${windowTime(sender.windowStart)}`,
        others,
      }
    }
    return { state: 'sending', figures: progress, others }
  }
  // Waiting. Only the next batch says where it is sent from, and only when
  // nothing is in its way: sending is the laptop's, and there is no button
  // for it here (design D7).
  const next = campaign.state === 'scheduled' && campaign.nextBatchNo === batch.batchNo && !behind
  return { state: 'waiting', figures: next ? 'send from the laptop' : null, others }
}

const SORT_WORDS: Readonly<Record<CampaignAudience['sort'], string>> = {
  most_orders: 'most orders first',
  most_recent: 'most recent first',
  longest_away: 'longest away first',
}

/**
 * Who a campaign goes to, as short phrases: the filters in the order the sheet
 * lists them, then the order. Customers ticked one by one are said as that,
 * since the filters did not choose them.
 */
export function audienceWords(audience: CampaignAudience): string[] {
  if (audience.picked.kind === 'only') return ['picked one by one', SORT_WORDS[audience.sort]]
  const words: string[] = []
  if (audience.ordered.kind === 'within')
    words.push(`ordered in the last ${audience.ordered.days} days`)
  if (audience.ordered.kind === 'not_within') {
    words.push(`not ordered in the last ${audience.ordered.days} days`)
  }
  if (audience.ordered.kind === 'between') {
    const { from, to, notSince } = audience.ordered
    words.push(`ordered ${stretchWords(from, to)}`)
    if (notSince) words.push(`not back since ${formatBusinessDateShort(to)}`)
  }
  if (audience.orders.kind === 'at_least') words.push(`at least ${audience.orders.count} orders`)
  if (audience.orders.kind === 'at_most') words.push(`at most ${audience.orders.count} orders`)
  if (audience.gold === 'gold') words.push('gold members')
  if (audience.gold === 'not_gold') words.push('not gold members')
  if (audience.spentAtLeastPaise !== null) {
    words.push(`spent at least ${formatPaise(audience.spentAtLeastPaise)}`)
  }
  if (audience.campaigns.kind === 'never') words.push('never sent a campaign')
  if (audience.campaigns.kind === 'not_within') {
    words.push(`not sent one in the last ${audience.campaigns.days} days`)
  }
  if (words.length === 0) words.push('everyone who has ordered')
  const left = audience.picked.except.length
  if (left > 0) words.push(`${left} left out`)
  words.push(SORT_WORDS[audience.sort])
  return words
}

/** Two business dates as a stretch: `01 Sept to 30 Sept`, the year only where it is not this one. */
export function stretchWords(from: string, to: string): string {
  return from === to
    ? `on ${formatBusinessDateShort(from)}`
    : `${formatBusinessDateShort(from)} to ${formatBusinessDateShort(to)}`
}

/** `1 customer`, `412 customers`, with Indian digit grouping. */
export function customersWord(count: number): string {
  return `${count.toLocaleString('en-IN')} ${count === 1 ? 'customer' : 'customers'}`
}

/** `1 batch`, `5 batches`. */
export function batchesWord(count: number): string {
  return `${count} ${count === 1 ? 'batch' : 'batches'}`
}

/** A whole number with Indian digit grouping: `1,000`, `1,23,456`. */
export function count(value: number): string {
  return value.toLocaleString('en-IN')
}

export function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof DataActionError ? cause.message : fallback
}

/** One test send's state, in plain words. `waiting` is the laptop's to send. */
export function testStateWords(test: CampaignTestSend, now: string): string {
  switch (test.state) {
    case 'waiting':
      return 'waiting for the laptop'
    case 'sending':
      return 'sending'
    case 'sent':
      return test.sentAt
        ? `sent ${formatFreshness(test.sentAt, now).replace(/^(\d{1,2}:\d{2})/, 'at $1')}`
        : 'sent'
    case 'not_on_whatsapp':
      return 'not on WhatsApp'
    case 'failed':
      return 'failed'
    case 'unsure':
      return 'unsure'
    case 'stopped':
      return 'stopped'
  }
}
