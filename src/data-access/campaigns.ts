/**
 * WhatsApp campaigns, as the owners' Campaigns pages read and write them
 * (a-campaign-goes-out-on-whatsapp, #85).
 *
 * **The app never sends.** It writes rows — a campaign, its recipients cut into
 * batches — and reads them back. A program on the owner's laptop, the sender,
 * does the sending and reports into the same rows (design, *The shape in one
 * paragraph*). So nothing here releases a batch or sends a message: release is
 * the sender's own page, on the laptop (design D7).
 *
 * **Owners only.** Every method is refused for anybody but a Super Admin, by
 * the database (design D13); the mock refuses the same people.
 */
import { DataActionError } from './adapters'
import type { Database, Tables } from './database.types'

// ─────────────────────────────────────────────────────────────────────────────
// The rows, as the migration made them (`20261119000000_a_campaign_goes_out_on_whatsapp.sql`).
//
// Generated, so a mock fixture the tables could not hold fails to compile.
// They began as hand-written copies of design D5 while the pages were
// approved in the demo before any migration existed; task 2.4 put these in
// their place. The one narrowing is a campaign's `audience`: the column is
// jsonb, and what it holds is the app's own document, `CampaignAudience`,
// which `marketing_audience` refuses anything else of.

type Enums = Database['public']['Enums']

export type CampaignState = Enums['marketing_campaign_state']
export type CampaignBatchState = Enums['marketing_batch_state']
/** Design D6: what a recipient can come to. `sent` is handed to WhatsApp, not accepted by it. */
export type CampaignRecipientState = Enums['marketing_recipient_state']
export type CampaignStopSource = Enums['marketing_stop_source']
export type CampaignSenderStatus = Enums['marketing_sender_status']

export type MarketingCampaignRow = Omit<Tables<'marketing_campaigns'>, 'audience'> & {
  /** The outlet, the filters, the order and who is picked; null on a draft with nobody chosen. */
  audience: CampaignAudience | null
}
export type MarketingCampaignBatchRow = Tables<'marketing_campaign_batches'>
/** **No phone and no name**: the row points at the customer, read at the moment of sending. */
export type MarketingCampaignRecipientRow = Tables<'marketing_campaign_recipients'>
/** One message to one test number, carrying the message as it stood when queued. */
export type MarketingCampaignTestRow = Tables<'marketing_campaign_tests'>
export type MarketingStoppedRow = Tables<'marketing_stopped'>
/** One row: what the sender last said about itself, and the owner's settings. */
export type MarketingSenderRow = Tables<'marketing_sender'>

// ─────────────────────────────────────────────────────────────────────────────
// Who a campaign goes to.

/**
 * An audience as the partner chose it: one outlet, five filters and one order.
 *
 * **The app suggests none of this** [owner, proposal decision 6]. A new
 * campaign starts with every filter at "any", which is everybody the outlet
 * has served who has not said stop.
 *
 * Everybody in an audience has a settled, uncancelled bill at the outlet: a
 * campaign goes to the customers of a shop. Days are counted in the outlet's
 * business dates, never on a timestamp, and spend is integer paise summed over
 * those bills (design D13).
 */
export interface CampaignAudience {
  outletId: string
  /**
   * Ordered here within, or not within, a number of days; or between two
   * business dates, both included, and with `notSince` not since the second
   * [owner, 2026-11-20: to win back customers from a past stretch who have
   * not come back]. Dates are `YYYY-MM-DD`.
   */
  ordered:
    | { kind: 'any' }
    | { kind: 'within' | 'not_within'; days: number }
    | { kind: 'between'; from: string; to: string; notSince: boolean }
  /** Ordered here at least, or at most, a number of times. */
  orders: { kind: 'any' } | { kind: 'at_least' | 'at_most'; count: number }
  /** Gold members at this outlet, or everybody who is not one. */
  gold: 'any' | 'gold' | 'not_gold'
  /** Spent at least this much here; null for no floor. */
  spentAtLeastPaise: number | null
  /** Never sent a campaign, or not sent one within a number of days. */
  campaigns: { kind: 'any' } | { kind: 'never' } | { kind: 'not_within'; days: number }
  /** Who is in the first batch. */
  sort: CampaignAudienceSort
  /**
   * Who among the customers listed is picked [owner, 2026-11-18: a tick per
   * customer and Select all].
   *
   * `all` is everybody the filters match when the campaign is submitted,
   * except the ones unticked; it is what Select all chooses, and it holds at a
   * thousand customers without the page ever loading a thousand rows. `only`
   * is the customers ticked one by one, found by the filters or by search,
   * whatever the filters say afterwards. A new campaign starts at `only` with
   * nobody: the app picks nobody for the partner.
   */
  picked: { kind: 'all'; except: string[] } | { kind: 'only'; ids: string[] }
}

export type CampaignAudienceSort = 'most_orders' | 'most_recent' | 'longest_away'

/** Everybody the outlet has served, most orders first: no filter, and all of them picked. */
export function everybodyAt(outletId: string): CampaignAudience {
  return {
    outletId,
    ordered: { kind: 'any' },
    orders: { kind: 'any' },
    gold: 'any',
    spentAtLeastPaise: null,
    campaigns: { kind: 'any' },
    sort: 'most_orders',
    picked: { kind: 'all', except: [] },
  }
}

/** The same list with nobody picked yet: where choosing customers starts. */
export function nobodyAt(outletId: string): CampaignAudience {
  return { ...everybodyAt(outletId), picked: { kind: 'only', ids: [] } }
}

/** Whether one customer is picked. */
export function isPicked(audience: CampaignAudience, customerId: string): boolean {
  return audience.picked.kind === 'all'
    ? !audience.picked.except.includes(customerId)
    : audience.picked.ids.includes(customerId)
}

/**
 * One customer in a look-through. **A name and the last four digits, and never
 * the number**: the audience reads are the first to list customers by what they
 * did, and a full number leaves the database only when one recipient is handed
 * to the sender (design D13).
 */
export interface CampaignAudiencePerson {
  customerId: string
  name: string | null
  phoneLast4: string
}

export interface CampaignAudiencePage {
  rows: CampaignAudiencePerson[]
  /** Where the next page starts, or null at the end. */
  next: number | null
}

/** Rows per page of a look-through. */
export const AUDIENCE_PAGE_SIZE = 20

// ─────────────────────────────────────────────────────────────────────────────
// How far a campaign has got.

/**
 * Counts over a campaign's recipients, or over one batch of them.
 *
 * `sent` is handed to WhatsApp. **`delivered` keeps rising after a batch is
 * done**, because a receipt arrives whenever the customer's phone next comes
 * online, a day later included (design, *The first real sends*). **`read` is a
 * floor**: it leaves out every customer with read receipts off, and is nought
 * if the business account has them off. Delivered is the figure to rely on.
 */
export interface CampaignCounts {
  recipients: number
  sent: number
  /** Still waiting, or being sent to this minute. */
  toGo: number
  delivered: number
  read: number
  notOnWhatsApp: number
  failed: number
  /** Cut off mid-send: nobody can say whether it went, and it is never retried. */
  unsure: number
  /**
   * On the stopped list when their turn came, and so sent nothing. Until
   * 2026-11-20 a reply of STOP to this campaign counted here too; the sender
   * reads no replies now (design, *No stop line*), so only a row recorded
   * before then can add one.
   */
  stopped: number
}

export interface CampaignBatchReading extends CampaignCounts {
  batchNo: number
  state: CampaignBatchState
  releasedAt: string | null
  finishedAt: string | null
}

/** A campaign as the list shows it. */
export interface CampaignSummary {
  id: string
  name: string
  state: CampaignState
  /** Why the sender paused it, or null when an owner did or it is not paused. */
  pausedReason: string | null
  notBefore: string | null
  recipients: number
  sent: number
  /** The batch released and not yet finished, if any. One at a time across every campaign. */
  sendingBatchNo: number | null
  /** The next batch that would be released, when none is sending. */
  nextBatchNo: number | null
  createdAt: string
  scheduledAt: string | null
  finishedAt: string | null
}

/** A campaign's own page. */
export interface CampaignDetail extends CampaignSummary {
  body: string
  /** The image, somewhere the page can show it from; null with none. */
  imageUrl: string | null
  audience: CampaignAudience | null
  /** The size its batches were cut at; null while a draft. */
  batchSize: number | null
  counts: CampaignCounts
  batches: CampaignBatchReading[]
  scheduledByName: string | null
  /** The campaign's test numbers, as `+` and digits, in the order they were added. */
  testPhones: string[]
  /** Every test send, newest first. Never counted in the campaign's figures. */
  tests: CampaignTestSend[]
}

/**
 * One test send: the message to one test number, sent by the laptop with no
 * press, ahead of any customer [owner, 2026-11-18].
 *
 * Test numbers are the owners' own (their own, a co-owner's, a friend's), so
 * the whole number is shown. They skip the stopped list and the sending
 * window, and count in none of a campaign's figures.
 */
export interface CampaignTestSend {
  id: string
  phone: string
  /** As a recipient's (design D6): `waiting` is waiting for the laptop. */
  state: CampaignRecipientState
  queuedAt: string
  sentAt: string | null
  failureCode: string | null
}

/**
 * What the sender last said about itself, with the clock it was said against.
 *
 * `serverNow` is the database's clock, so whether the sender is online is never
 * judged by the phone's own.
 */
export interface CampaignSenderReading {
  status: CampaignSenderStatus
  lastSeenAt: string | null
  haltReason: string | null
  linkedNumberLast4: string | null
  serverNow: string
  /** The owner's settings, as the pages state them. */
  batchSize: number
  windowStart: string
  windowEnd: string
}

/** The Campaigns list in one read. */
export interface CampaignsOverview {
  sender: CampaignSenderReading
  /** Newest first. */
  campaigns: CampaignSummary[]
  stoppedCount: number
}

export interface CampaignReading {
  sender: CampaignSenderReading
  campaign: CampaignDetail
  /** Another campaign's batch is sending, so this one waits its turn. */
  behindCampaignName: string | null
}

/** What a draft holds. `id` is made by the page, so a retried save writes one campaign. */
export interface CampaignDraftInput {
  id: string
  name: string
  body: string
  audience: CampaignAudience | null
}

/** A customer on the stopped list. A name and the last four digits, as an audience shows them. */
export interface StoppedCustomer {
  customerId: string
  name: string | null
  phoneLast4: string
  stoppedAt: string
  source: CampaignStopSource
  /** The campaign they replied STOP to: only rows recorded before 2026-11-20. */
  campaignName: string | null
  /** The owner who added them by hand. */
  recordedByName: string | null
}

/**
 * A refusal from the campaign functions.
 *
 * `not_permitted` is everybody but an owner. The rest are the form's business:
 * `name_required`, `body_required`, `body_too_long`, `audience_required`,
 * `nobody_matches`, `not_a_draft`, `not_found`, `wrong_state`,
 * `phone_incomplete`, `no_such_customer`; and for test numbers
 * `too_many_test_numbers`, `campaign_finished`, `no_test_numbers` and
 * `test_already_waiting`.
 */
export class CampaignActionError extends DataActionError {
  constructor(code: string, message: string) {
    super(code, message)
    this.name = 'CampaignActionError'
  }
}

export interface CampaignsAdapter {
  /** The list: the sender line, every campaign, and how many customers are stopped. */
  overview(): Promise<CampaignsOverview>
  /** One campaign's page, or null where there is no campaign by that id. */
  campaign(campaignId: string): Promise<CampaignReading | null>

  /**
   * How many customers an audience holds now, the stopped left out. Asked as
   * the filters change; it writes nothing.
   */
  audienceCount(audience: CampaignAudience): Promise<number>
  /**
   * The customers the filters match, in the chosen order, a page at a time,
   * whoever is picked; narrowed by `search` (a name, or digits of the number,
   * by the Customers page's rules) when one is given. Names and last four
   * digits only.
   */
  audiencePage(
    audience: CampaignAudience,
    offset: number,
    search?: string,
  ): Promise<CampaignAudiencePage>

  /** Create a draft, or change one. Refused once a campaign is scheduled. */
  saveDraft(draft: CampaignDraftInput): Promise<CampaignDetail>
  /** Put one image on a draft, or take it off with null. */
  setImage(campaignId: string, image: File | null): Promise<CampaignDetail>
  /**
   * Fix the audience and cut it into batches (design D5): the filters are
   * evaluated once, in the chosen order, at the batch size set at this moment.
   * `notBefore` is null for as soon as possible. **Nothing is sent**: every
   * batch waits to be released on the sender's own page.
   */
  schedule(campaignId: string, notBefore: string | null): Promise<CampaignDetail>
  /** The sender is refused its next recipient until Resume. */
  pause(campaignId: string): Promise<CampaignDetail>
  resume(campaignId: string): Promise<CampaignDetail>
  /** Final: the customers still waiting are sent nothing, and it cannot be resumed. */
  stop(campaignId: string): Promise<CampaignDetail>

  /** The stopped list, newest first. */
  stopped(): Promise<StoppedCustomer[]>
  /** Add a customer by their complete number, for one who asks at the counter. */
  addStopped(phone: string): Promise<StoppedCustomer>
  /** Take a customer off the list. They may be in a later audience again. */
  removeStopped(customerId: string): Promise<void>

  /**
   * Replace a campaign's test numbers with these, at most five, each a
   * ten-digit Indian mobile or a whole number with its country code
   * (`shared/campaign-test-number`). Answers the list as stored, `+` and
   * digits. Refused once a campaign is done or stopped.
   */
  setTestNumbers(campaignId: string, phones: string[]): Promise<string[]>
  /**
   * Send the message as it stands to every test number, by the laptop, with
   * no press there. Answers how many were queued. Refused while an earlier
   * test of this campaign still waits for the laptop.
   */
  sendTest(campaignId: string): Promise<number>
  /** Numbers used on earlier campaigns, most recent first, at most ten. */
  testNumberSuggestions(): Promise<string[]>
}
