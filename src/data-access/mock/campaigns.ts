import { customerMatchStrength, parseCustomerQuery, shiftBusinessDate } from '@/domain'

import { campaignBodyProblem } from '../../../shared/campaign-message'
import {
  checkTestNumber,
  MAX_TEST_NUMBERS,
  TEST_NUMBER_SUGGESTIONS,
  testNumberProblem,
} from '../../../shared/campaign-test-number'
import { phoneErrorMessage, validateIndianPhone } from '../../../shared/phone'
import { newUuid } from '@/lib/uuid'
import type { AppRole } from '../adapters'
import {
  AUDIENCE_PAGE_SIZE,
  CampaignActionError,
  type CampaignAudience,
  type CampaignAudiencePerson,
  type CampaignBatchReading,
  type CampaignCounts,
  type CampaignDetail,
  type CampaignReading,
  type CampaignSenderReading,
  type CampaignSummary,
  type CampaignsAdapter,
  type MarketingCampaignBatchRow,
  type MarketingCampaignRecipientRow,
  type MarketingCampaignRow,
  type MarketingCampaignTestRow,
  type MarketingSenderRow,
  type MarketingStoppedRow,
  type StoppedCustomer,
} from '../campaigns'
import {
  currentSpell,
  goldOnAt,
  type DemoCustomerProfile,
  type DemoCustomers,
  type DemoCustomerVisit,
} from './customers'
import {
  DEMO_LAPSED_CUSTOMER_PHONE,
  DEMO_MEMBER_CUSTOMER_PHONE,
  DEMO_REGULAR_CUSTOMER_PHONE,
  DEMO_RETURNING_CUSTOMER_PHONE,
  customerIdForPhone,
} from './fixtures/customers'
import { pastCustomerId } from './fixtures/customer-crowd'
import { OUTLET_KALYANI_ID } from './fixtures/outlets'
import { DEMO_OWNER_ID, personaFixtures } from './fixtures/personas'
import type { DemoStore } from './store'

/**
 * The mock campaigns: three campaigns, a stopped list and a sender that sends
 * nothing (a-campaign-goes-out-on-whatsapp, design D15).
 *
 * **Nothing here sends, links or shows a code.** There is no sender in the
 * demo. What the laptop would be doing is one of six scenes the demo banner
 * switches between, so every state the sender line can be in is reachable
 * without a laptop.
 *
 * **Two scales, and why.** The demo's customer directory holds seven people,
 * and the audience filters count over those seven and their real demo bills,
 * as design D15 asks: a count here is a count of rows the Customers page also
 * shows. The two campaigns already scheduled are seeded at the size of the
 * real business, a thousand and 418, because a campaign's page is batch rows
 * and those cannot be judged over seven people. Their recipient rows hold a
 * customer id and nothing else, as the table will (design D5), so most point
 * at customers this demo has no card for.
 *
 * **Every figure on a page is counted from recipient rows when it is read.**
 * No campaign states its own total.
 */

/** What the laptop is doing, for the demo banner to switch between. */
export type DemoSenderScene =
  'sending' | 'waiting' | 'outside_hours' | 'offline' | 'halted' | 'not_linked'

export const DEMO_SENDER_SCENES: readonly DemoSenderScene[] = [
  'sending',
  'waiting',
  'outside_hours',
  'offline',
  'halted',
  'not_linked',
]

export interface DemoCampaigns {
  campaigns: MarketingCampaignRow[]
  batches: MarketingCampaignBatchRow[]
  recipients: MarketingCampaignRecipientRow[]
  stopped: MarketingStoppedRow[]
  /** The owner's settings. What the sender says about itself comes from `scene`. */
  sender: MarketingSenderRow
  scene: DemoSenderScene
  /** Names for the customers the seeded history stopped, whom the directory has no card for. */
  pastCustomers: Map<string, { name: string | null; phoneLast4: string }>
  /** A draft's image, held in this tab only: the demo uploads nothing. */
  images: Map<string, string>
  /** Every test send. The demo sends none: a test queued here waits for a laptop it has not got. */
  tests: MarketingCampaignTestRow[]
}

/**
 * The demo's test numbers: invented, in ranges no phone holds. Nine thousand
 * upward is not an allocated Indian mobile range (as the demo's customers),
 * and 555-0100 to 555-0199 is the American range kept for fiction.
 */
export const DEMO_TEST_NUMBERS = ['+919000000901', '+919000000902', '+12025550142'] as const

const campaignId = (n: number) => `d9000000-0000-4000-a000-${String(n).padStart(12, '0')}`

export const DEMO_CAMPAIGN_DONE_ID = campaignId(1)
export const DEMO_CAMPAIGN_SENDING_ID = campaignId(2)
export const DEMO_CAMPAIGN_DRAFT_ID = campaignId(3)

/** The batch of the part-sent campaign that the scenes move. */
const SCENE_BATCH_NO = 3
/** How far into it the sender has got, in every scene but `waiting`. */
const SCENE_BATCH_SENT = 47

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const ago = (now: number, ms: number) => new Date(now - ms).toISOString()

/** One seeded batch: who in it did not simply get the message. */
interface BatchSeed {
  size: number
  /** How long ago it was released. */
  releasedAgoMs: number
  /** Positions in the batch (0-based) that came to something other than `sent`. */
  outcomes?: Record<number, 'not_on_whatsapp' | 'unsure' | 'failed'>
  /** Positions that got the message and replied STOP to it. */
  repliedStop?: number[]
  /** How many were sent; the rest wait. Defaults to the whole batch. */
  sent?: number
}

/**
 * A batch's recipient rows, one a minute from its release.
 *
 * Receipts are spread by position so the figures look like a real batch: all
 * but a few delivered, and about three in five read. Nothing is random, so a
 * walkthrough reads the same every time.
 */
function seedBatch(
  campaign: string,
  batchNo: number,
  firstPosition: number,
  customerIds: (position: number) => string,
  seed: BatchSeed,
  now: number,
): MarketingCampaignRecipientRow[] {
  const settled = seed.sent ?? seed.size
  return Array.from({ length: seed.size }, (_, index) => {
    const position = firstPosition + index
    const row: MarketingCampaignRecipientRow = {
      campaign_id: campaign,
      customer_id: customerIds(position),
      batch_no: batchNo,
      position,
      state: 'waiting',
      claimed_at: null,
      sent_at: null,
      delivered_at: null,
      read_at: null,
      wa_message_id: null,
      failure_code: null,
    }
    if (index >= settled) return row
    const at = now - seed.releasedAgoMs + index * MINUTE
    const outcome = seed.outcomes?.[index]
    row.claimed_at = new Date(at).toISOString()
    if (outcome) {
      row.state = outcome
      if (outcome === 'failed') row.failure_code = 'upload_failed'
      return row
    }
    row.state = 'sent'
    row.sent_at = new Date(at + 2_000).toISOString()
    row.wa_message_id = `DEMO${String(position).padStart(6, '0')}`
    if (index % 34 !== 33) row.delivered_at = new Date(at + 9_000).toISOString()
    if (row.delivered_at && index % 5 < 3) row.read_at = new Date(at + 4 * MINUTE).toISOString()
    return row
  })
}

function batchRow(
  campaign: string,
  batchNo: number,
  state: MarketingCampaignBatchRow['state'],
  releasedAt: string | null,
  finishedAt: string | null,
): MarketingCampaignBatchRow {
  return {
    campaign_id: campaign,
    batch_no: batchNo,
    state,
    released_by: releasedAt ? DEMO_OWNER_ID : null,
    released_at: releasedAt,
    finished_at: finishedAt,
  }
}

export function createDemoCampaigns(now: number = Date.now()): DemoCampaigns {
  const batchSize = 100
  const campaigns: MarketingCampaignRow[] = []
  const batches: MarketingCampaignBatchRow[] = []
  const recipients: MarketingCampaignRecipientRow[] = []
  /** The recipients who got a message and replied STOP to it. */
  const repliers: MarketingCampaignRecipientRow[] = []

  // ── Weekend combo: done, with its receipts ────────────────────────────────
  const doneRegulars = [
    DEMO_RETURNING_CUSTOMER_PHONE,
    DEMO_MEMBER_CUSTOMER_PHONE,
    DEMO_REGULAR_CUSTOMER_PHONE,
  ].map(customerIdForPhone)
  const doneCustomer = (position: number) => doneRegulars[position - 1] ?? pastCustomerId(position)
  const doneBatches: BatchSeed[] = [
    { size: 100, releasedAgoMs: 12 * DAY, outcomes: { 41: 'not_on_whatsapp' }, repliedStop: [77] },
    { size: 100, releasedAgoMs: 11 * DAY, outcomes: { 12: 'unsure' } },
    { size: 100, releasedAgoMs: 10 * DAY, outcomes: { 58: 'not_on_whatsapp' } },
    { size: 100, releasedAgoMs: 10 * DAY - 4 * HOUR, outcomes: { 90: 'failed' }, repliedStop: [3] },
    { size: 18, releasedAgoMs: 9 * DAY },
  ]
  campaigns.push({
    id: DEMO_CAMPAIGN_DONE_ID,
    name: 'Weekend combo',
    body: 'Hi {name}, this weekend only: *any two shawarmas and a drink for ₹299*.\nShow this message at the counter.',
    image_path: null,
    // The owners tried it on their own phones first.
    test_phones: [DEMO_TEST_NUMBERS[0], DEMO_TEST_NUMBERS[2]],
    audience: {
      outletId: OUTLET_KALYANI_ID,
      ordered: { kind: 'within', days: 60 },
      orders: { kind: 'any' },
      gold: 'any',
      spentAtLeastPaise: null,
      campaigns: { kind: 'any' },
      sort: 'most_orders',
      picked: { kind: 'all', except: [] },
    },
    batch_size: batchSize,
    state: 'done',
    paused_reason: null,
    not_before: null,
    created_by: DEMO_OWNER_ID,
    created_at: ago(now, 13 * DAY),
    scheduled_by: DEMO_OWNER_ID,
    scheduled_at: ago(now, 12 * DAY + HOUR),
    finished_at: ago(now, 9 * DAY - 18 * MINUTE),
    finish_notice_sent_at: null,
  })
  let position = 1
  doneBatches.forEach((seed, index) => {
    const releasedAt = ago(now, seed.releasedAgoMs)
    batches.push(
      batchRow(
        DEMO_CAMPAIGN_DONE_ID,
        index + 1,
        'done',
        releasedAt,
        ago(now, seed.releasedAgoMs - seed.size * MINUTE),
      ),
    )
    const rows = seedBatch(DEMO_CAMPAIGN_DONE_ID, index + 1, position, doneCustomer, seed, now)
    recipients.push(...rows)
    repliers.push(...(seed.repliedStop ?? []).flatMap((at) => rows[at] ?? []))
    position += seed.size
  })

  // ── Diwali offer: two batches done, the third part-sent ───────────────────
  const sendingCustomer = (at: number) =>
    at === 1 ? customerIdForPhone('+919000000106') : pastCustomerId(1000 + at)
  campaigns.push({
    id: DEMO_CAMPAIGN_SENDING_ID,
    name: 'Diwali offer',
    body: 'Happy Diwali, {name}! 🪔\n*20% off every order* at Shawarmania Kalyani until Sunday.\n_Dine in or takeaway._',
    image_path: null,
    test_phones: [DEMO_TEST_NUMBERS[0], DEMO_TEST_NUMBERS[1]],
    audience: {
      outletId: OUTLET_KALYANI_ID,
      ordered: { kind: 'any' },
      orders: { kind: 'any' },
      gold: 'any',
      spentAtLeastPaise: null,
      campaigns: { kind: 'any' },
      sort: 'most_recent',
      picked: { kind: 'all', except: [] },
    },
    batch_size: batchSize,
    state: 'scheduled',
    paused_reason: null,
    not_before: null,
    created_by: DEMO_OWNER_ID,
    created_at: ago(now, 3 * DAY),
    scheduled_by: DEMO_OWNER_ID,
    scheduled_at: ago(now, 2 * DAY + 2 * HOUR),
    finished_at: null,
    finish_notice_sent_at: null,
  })
  const sendingBatches: BatchSeed[] = [
    { size: 100, releasedAgoMs: 2 * DAY, outcomes: { 23: 'not_on_whatsapp' }, repliedStop: [60] },
    {
      size: 100,
      releasedAgoMs: DAY + 2 * HOUR,
      outcomes: { 37: 'unsure' },
      repliedStop: [8, 71, 95],
    },
    { size: 100, releasedAgoMs: SCENE_BATCH_SENT * MINUTE, sent: SCENE_BATCH_SENT },
    ...Array.from({ length: 7 }, () => ({ size: 100, releasedAgoMs: 0, sent: 0 })),
  ]
  position = 1
  sendingBatches.forEach((seed, index) => {
    const batchNo = index + 1
    const settled = seed.sent ?? seed.size
    const state = settled === seed.size ? 'done' : settled > 0 ? 'released' : 'waiting'
    batches.push(
      batchRow(
        DEMO_CAMPAIGN_SENDING_ID,
        batchNo,
        state,
        state === 'waiting' ? null : ago(now, seed.releasedAgoMs),
        state === 'done' ? ago(now, seed.releasedAgoMs - seed.size * MINUTE) : null,
      ),
    )
    const rows = seedBatch(DEMO_CAMPAIGN_SENDING_ID, batchNo, position, sendingCustomer, seed, now)
    recipients.push(...rows)
    repliers.push(...(seed.repliedStop ?? []).flatMap((at) => rows[at] ?? []))
    position += seed.size
  })

  // ── New menu: a draft, with nobody chosen yet ─────────────────────────────
  campaigns.push({
    id: DEMO_CAMPAIGN_DRAFT_ID,
    name: 'New menu',
    body: 'Hi {name}, our *new menu* is here: Peri Peri Shawarma and Loaded Fries.\nCome try them this week.',
    image_path: null,
    test_phones: [],
    audience: null,
    batch_size: null,
    state: 'draft',
    paused_reason: null,
    not_before: null,
    created_by: DEMO_OWNER_ID,
    created_at: ago(now, 20 * HOUR),
    scheduled_by: null,
    scheduled_at: null,
    finished_at: null,
    finish_notice_sent_at: null,
  })

  // ── The stopped list: everybody who replied STOP, and one added by hand ───
  const pastCustomers = new Map<string, { name: string | null; phoneLast4: string }>()
  const stopped: MarketingStoppedRow[] = []
  const names: (string | null)[] = [
    'Tanmoy Saha',
    'Rina Mondal',
    'Subhajit Dey',
    null,
    'Ayesha Khatun',
    'Debolina Paul',
  ]
  repliers.forEach((row, index) => {
    pastCustomers.set(row.customer_id, {
      name: names[index % names.length] ?? null,
      phoneLast4: String(2310 + index * 137).slice(-4),
    })
    stopped.push({
      customer_id: row.customer_id,
      // A reply some hours after the message arrived.
      stopped_at: new Date(
        Date.parse(row.sent_at ?? ago(now, DAY)) + (2 + index) * HOUR,
      ).toISOString(),
      source: 'reply',
      campaign_id: row.campaign_id,
      recorded_by: null,
    })
  })
  stopped.push({
    // Asked at the counter not to be messaged.
    customer_id: customerIdForPhone(DEMO_LAPSED_CUSTOMER_PHONE),
    stopped_at: ago(now, 5 * DAY),
    source: 'owner',
    campaign_id: null,
    recorded_by: DEMO_OWNER_ID,
  })

  return {
    campaigns,
    batches,
    recipients,
    stopped,
    sender: {
      id: true,
      installation_id: null,
      last_seen_at: null,
      status: 'sending',
      halt_reason: null,
      linked_number_last4: '4721',
      batch_size: batchSize,
      window_start: '10:00:00',
      window_end: '21:00:00',
      min_gap_seconds: 45,
      max_gap_seconds: 90,
    },
    scene: 'sending',
    pastCustomers,
    images: new Map(),
    tests: [
      testSend(
        1,
        campaigns,
        DEMO_CAMPAIGN_DONE_ID,
        DEMO_TEST_NUMBERS[0],
        'sent',
        ago(now, 12 * DAY + 2 * HOUR),
      ),
      testSend(
        2,
        campaigns,
        DEMO_CAMPAIGN_DONE_ID,
        DEMO_TEST_NUMBERS[2],
        'sent',
        ago(now, 12 * DAY + 2 * HOUR),
      ),
      testSend(
        3,
        campaigns,
        DEMO_CAMPAIGN_SENDING_ID,
        DEMO_TEST_NUMBERS[0],
        'sent',
        ago(now, 2 * DAY + 3 * HOUR),
      ),
      testSend(
        4,
        campaigns,
        DEMO_CAMPAIGN_SENDING_ID,
        DEMO_TEST_NUMBERS[1],
        'not_on_whatsapp',
        ago(now, 2 * DAY + 3 * HOUR),
      ),
      testSend(
        5,
        campaigns,
        DEMO_CAMPAIGN_SENDING_ID,
        DEMO_TEST_NUMBERS[0],
        'sent',
        ago(now, 2 * DAY + 2 * HOUR),
      ),
    ],
  }
}

function testSend(
  n: number,
  campaigns: readonly MarketingCampaignRow[],
  campaignId: string,
  phone: string,
  outcome: 'sent' | 'not_on_whatsapp',
  queuedAt: string,
): MarketingCampaignTestRow {
  const sent = outcome === 'sent'
  return {
    id: `de000000-0000-4000-a000-${String(n).padStart(12, '0')}`,
    seq: n,
    campaign_id: campaignId,
    phone,
    body: campaigns.find((campaign) => campaign.id === campaignId)?.body ?? '',
    image_path: null,
    state: outcome,
    queued_by: DEMO_OWNER_ID,
    queued_at: queuedAt,
    claimed_at: new Date(Date.parse(queuedAt) + 30_000).toISOString(),
    sent_at: sent ? new Date(Date.parse(queuedAt) + 40_000).toISOString() : null,
    wa_message_id: sent ? `DEMOTEST${n}` : null,
    failure_code: null,
  }
}

/**
 * Change what the laptop is doing.
 *
 * Five scenes leave the part-sent campaign mid-batch, 47 of 100 into its third.
 * `waiting` puts that batch back to not yet released, which is the one state a
 * sender scene cannot show otherwise: the line reads *batch 3 waiting on the
 * laptop*. Only that batch's rows are rewritten, and only while the campaign is
 * still going, so a Pause or a Stop done in the walkthrough is left alone.
 */
export function setDemoSenderScene(state: DemoCampaigns, scene: DemoSenderScene): void {
  state.scene = scene
  const campaign = state.campaigns.find((row) => row.id === DEMO_CAMPAIGN_SENDING_ID)
  if (!campaign || (campaign.state !== 'scheduled' && campaign.state !== 'paused')) return
  const batch = state.batches.find(
    (row) => row.campaign_id === campaign.id && row.batch_no === SCENE_BATCH_NO,
  )
  if (!batch || batch.state === 'done') return
  const now = Date.now()
  const waiting = scene === 'waiting'
  batch.state = waiting ? 'waiting' : 'released'
  batch.released_at = waiting ? null : ago(now, SCENE_BATCH_SENT * MINUTE)
  batch.released_by = waiting ? null : DEMO_OWNER_ID
  const rows = state.recipients.filter(
    (row) => row.campaign_id === campaign.id && row.batch_no === SCENE_BATCH_NO,
  )
  const first = rows[0]?.position ?? 1
  const fresh = seedBatch(
    campaign.id,
    SCENE_BATCH_NO,
    first,
    (position) => rows[position - first]?.customer_id ?? pastCustomerId(1000 + position),
    {
      size: rows.length,
      releasedAgoMs: SCENE_BATCH_SENT * MINUTE,
      sent: waiting ? 0 : SCENE_BATCH_SENT,
    },
    now,
  )
  rows.forEach((row, index) => Object.assign(row, fresh[index]))
}

/** Yesterday at 21:00 India time: when a laptop closed for the night was last seen. */
function yesterdayEvening(now: number): string {
  const istDay = new Date(now + 5.5 * HOUR - DAY).toISOString().slice(0, 10)
  return new Date(`${istDay}T21:00:00+05:30`).toISOString()
}

/** What the sender last said, in the scene the banner chose. Read fresh each time. */
function senderReading(state: DemoCampaigns): CampaignSenderReading {
  const now = Date.now()
  const settings = {
    serverNow: new Date(now).toISOString(),
    batchSize: state.sender.batch_size,
    windowStart: state.sender.window_start,
    windowEnd: state.sender.window_end,
  }
  const linked = state.sender.linked_number_last4
  switch (state.scene) {
    case 'sending':
      return {
        status: 'sending',
        lastSeenAt: ago(now, 20_000),
        haltReason: null,
        linkedNumberLast4: linked,
        ...settings,
      }
    case 'waiting':
      return {
        status: 'idle',
        lastSeenAt: ago(now, 35_000),
        haltReason: null,
        linkedNumberLast4: linked,
        ...settings,
      }
    case 'outside_hours':
      return {
        status: 'outside_hours',
        lastSeenAt: ago(now, 2 * MINUTE),
        haltReason: null,
        linkedNumberLast4: linked,
        ...settings,
      }
    case 'offline':
      // What it last said was that it was sending. The page must not repeat it.
      return {
        status: 'sending',
        lastSeenAt: yesterdayEvening(now),
        haltReason: null,
        linkedNumberLast4: linked,
        ...settings,
      }
    case 'halted':
      return {
        status: 'halted',
        lastSeenAt: ago(now, 3 * HOUR),
        haltReason: 'logged_out',
        linkedNumberLast4: linked,
        ...settings,
      }
    case 'not_linked':
      return {
        status: 'not_linked',
        lastSeenAt: ago(now, 40_000),
        haltReason: null,
        linkedNumberLast4: null,
        ...settings,
      }
  }
}

function countsOf(
  rows: readonly MarketingCampaignRecipientRow[],
  /** The customers who replied STOP to this campaign. */
  repliedStop: ReadonlySet<string>,
): CampaignCounts {
  const counts: CampaignCounts = {
    recipients: rows.length,
    sent: 0,
    toGo: 0,
    delivered: 0,
    read: 0,
    notOnWhatsApp: 0,
    failed: 0,
    unsure: 0,
    stopped: 0,
  }
  for (const row of rows) {
    if (row.state === 'sent') counts.sent += 1
    else if (row.state === 'waiting' || row.state === 'sending') counts.toGo += 1
    else if (row.state === 'not_on_whatsapp') counts.notOnWhatsApp += 1
    else if (row.state === 'failed') counts.failed += 1
    else if (row.state === 'unsure') counts.unsure += 1
    else counts.stopped += 1
    if (row.delivered_at) counts.delivered += 1
    if (row.read_at) counts.read += 1
    // Sent to, and then said stop: counted as both, because both happened.
    if (row.state !== 'stopped' && repliedStop.has(row.customer_id)) counts.stopped += 1
  }
  return counts
}

function personName(profileId: string | null): string | null {
  if (profileId === null) return null
  for (const persona of Object.values(personaFixtures)) {
    if (persona.profile.id === profileId) return persona.profile.full_name
  }
  return null
}

type CampaignStore = Pick<DemoStore, 'bills'> & Partial<Pick<DemoStore, 'loyaltySettings'>>

export function createMockCampaignsAdapter(
  state: DemoCampaigns,
  customers: DemoCustomers,
  store: CampaignStore,
  role: AppRole,
  actorId: string = DEMO_OWNER_ID,
): CampaignsAdapter {
  /** `app_is_owner()`, which every campaign function begins with (design D13). */
  const requireOwner = () => {
    if (role !== 'super_admin') {
      throw new CampaignActionError('not_permitted', 'Campaigns are for the owners.')
    }
  }

  const profiles = () => [...customers.byPhone.values()]
  const isStopped = (customerId: string) =>
    state.stopped.some((row) => row.customer_id === customerId)

  const rowsOf = (id: string) => state.recipients.filter((row) => row.campaign_id === id)
  const batchesOf = (id: string) =>
    state.batches.filter((row) => row.campaign_id === id).sort((a, b) => a.batch_no - b.batch_no)

  const requireCampaign = (id: string): MarketingCampaignRow => {
    const row = state.campaigns.find((campaign) => campaign.id === id)
    if (!row) throw new CampaignActionError('not_found', 'That campaign is no longer here.')
    return row
  }

  const summary = (row: MarketingCampaignRow): CampaignSummary => {
    const recipients = rowsOf(row.id)
    const batches = batchesOf(row.id)
    const going = row.state === 'scheduled' || row.state === 'paused'
    const sending = going ? batches.find((batch) => batch.state === 'released') : undefined
    const next = going && !sending ? batches.find((batch) => batch.state === 'waiting') : undefined
    return {
      id: row.id,
      name: row.name,
      state: row.state,
      pausedReason: row.paused_reason,
      notBefore: row.not_before,
      recipients: recipients.length,
      sent: recipients.filter((recipient) => recipient.state === 'sent').length,
      sendingBatchNo: sending?.batch_no ?? null,
      nextBatchNo: next?.batch_no ?? null,
      createdAt: row.created_at,
      scheduledAt: row.scheduled_at,
      finishedAt: row.finished_at,
    }
  }

  /** Test numbers are set and sent while a campaign is a draft, submitted or paused. */
  const requireGoing = (row: MarketingCampaignRow) => {
    if (row.state === 'done' || row.state === 'stopped') {
      throw new CampaignActionError(
        'campaign_finished',
        'This campaign is finished, so it takes no more tests.',
      )
    }
  }

  /** One test send per test number, waiting for the laptop. The demo has no laptop. */
  const queueTests = (id: string, { skipWaiting }: { skipWaiting: boolean }): number => {
    const queuedAt = new Date().toISOString()
    const row = requireCampaign(id)
    const phones = row.test_phones.filter(
      (phone) =>
        !skipWaiting ||
        !state.tests.some(
          (test) => test.campaign_id === id && test.phone === phone && test.state === 'waiting',
        ),
    )
    for (const phone of phones) {
      state.tests.push({
        id: newUuid(),
        seq: state.tests.reduce((top, test) => Math.max(top, test.seq), 0) + 1,
        campaign_id: id,
        phone,
        // The message as it stands now: a draft edited afterwards does not change it.
        body: row.body,
        image_path: row.image_path,
        state: 'waiting',
        queued_by: actorId,
        queued_at: queuedAt,
        claimed_at: null,
        sent_at: null,
        wa_message_id: null,
        failure_code: null,
      })
    }
    return phones.length
  }

  const detail = (row: MarketingCampaignRow): CampaignDetail => {
    const recipients = rowsOf(row.id)
    const repliedStop = new Set(
      state.stopped.filter((stop) => stop.campaign_id === row.id).map((stop) => stop.customer_id),
    )
    const batches: CampaignBatchReading[] = batchesOf(row.id).map((batch) => ({
      batchNo: batch.batch_no,
      state: batch.state,
      releasedAt: batch.released_at,
      finishedAt: batch.finished_at,
      ...countsOf(
        recipients.filter((recipient) => recipient.batch_no === batch.batch_no),
        repliedStop,
      ),
    }))
    return {
      ...summary(row),
      body: row.body,
      imageUrl: state.images.get(row.id) ?? null,
      audience: row.audience,
      batchSize: row.batch_size,
      counts: countsOf(recipients, repliedStop),
      batches,
      scheduledByName: personName(row.scheduled_by),
      testPhones: [...row.test_phones],
      tests: state.tests
        .filter((test) => test.campaign_id === row.id)
        .sort((a, b) => b.seq - a.seq)
        // The last twenty, as `campaign_reading` gives them.
        .slice(0, 20)
        .map((test) => ({
          id: test.id,
          phone: test.phone,
          state: test.state,
          queuedAt: test.queued_at,
          sentAt: test.sent_at,
          failureCode: test.failure_code,
        })),
    }
  }

  /** When each customer was last handed a campaign message, by anybody's campaign. */
  const lastSentAt = (): Map<string, string> => {
    const latest = new Map<string, string>()
    for (const row of state.recipients) {
      if (!row.sent_at) continue
      const held = latest.get(row.customer_id)
      if (!held || row.sent_at > held) latest.set(row.customer_id, row.sent_at)
    }
    return latest
  }

  /** Every customer's settled visits, read in one pass rather than one pass per customer. */
  const visitsByCustomer = (): Map<string, DemoCustomerVisit[]> => {
    const byPhone = new Map(
      [...customers.byPhone.values()].map((profile) => [profile.phone, profile]),
    )
    const out = new Map<string, DemoCustomerVisit[]>()
    const add = (customerId: string, visit: DemoCustomerVisit) => {
      const held = out.get(customerId)
      if (held) held.push(visit)
      else out.set(customerId, [visit])
    }
    for (const visit of customers.olderVisits) add(visit.customerId, visit)
    for (const bill of store.bills) {
      // A sale the demo counter settled without a link is the customer's by its phone.
      const customerId =
        bill.customer_id ?? (bill.customer_phone ? byPhone.get(bill.customer_phone)?.id : undefined)
      if (!customerId) continue
      add(customerId, {
        customerId,
        outletId: bill.outlet_id,
        businessDate: bill.business_date,
        paidAt: bill.paid_at,
        totalPaise: bill.total_paise,
        voided: bill.status !== 'settled',
      })
    }
    return out
  }

  interface Candidate {
    profile: DemoCustomerProfile
    orders: number
    lastDate: string
    spendPaise: number
  }

  /**
   * Everybody who could be in a campaign at this outlet: a settled,
   * uncancelled bill there, and not on the stopped list, whatever the filters
   * say.
   */
  const candidatesAt = (outletId: string): Candidate[] => {
    const visits = visitsByCustomer()
    return profiles().flatMap((profile) => {
      if (isStopped(profile.id)) return []
      const here = (visits.get(profile.id) ?? []).filter(
        (visit) => visit.outletId === outletId && !visit.voided,
      )
      if (here.length === 0) return []
      return [
        {
          profile,
          orders: here.length,
          lastDate: here.reduce(
            (latest, visit) => (visit.businessDate > latest ? visit.businessDate : latest),
            '',
          ),
          spendPaise: here.reduce((sum, visit) => sum + visit.totalPaise, 0),
        },
      ]
    })
  }

  /** Whether a candidate passes the filters. Picks are not filters. */
  const passes =
    (audience: CampaignAudience, sent: Map<string, string>, now: number) =>
    (entry: Candidate): boolean => {
      if (audience.ordered.kind !== 'any') {
        // A bill on the business date exactly that many days back is within it.
        const within = entry.lastDate >= shiftBusinessDate(customers.today, -audience.ordered.days)
        if (within !== (audience.ordered.kind === 'within')) return false
      }
      if (audience.orders.kind === 'at_least' && entry.orders < audience.orders.count) return false
      if (audience.orders.kind === 'at_most' && entry.orders > audience.orders.count) return false
      if (audience.gold !== 'any') {
        const gold =
          goldOnAt(store, audience.outletId) &&
          currentSpell(customers, entry.profile.id, audience.outletId) !== null
        if (gold !== (audience.gold === 'gold')) return false
      }
      if (audience.spentAtLeastPaise !== null && entry.spendPaise < audience.spentAtLeastPaise) {
        return false
      }
      const last = sent.get(entry.profile.id)
      if (audience.campaigns.kind === 'never' && last) return false
      if (
        audience.campaigns.kind === 'not_within' &&
        last &&
        Date.parse(last) >= now - audience.campaigns.days * DAY
      ) {
        return false
      }
      return true
    }

  /** The chosen order. Ties end on the id, so two pages never repeat or skip anybody. */
  const sorted = (entries: Candidate[], sort: CampaignAudience['sort']): Candidate[] => {
    const byId = (a: Candidate, b: Candidate) => a.profile.id.localeCompare(b.profile.id)
    const recent = (a: Candidate, b: Candidate) => b.lastDate.localeCompare(a.lastDate)
    return [...entries].sort((a, b) => {
      if (sort === 'most_orders') return b.orders - a.orders || recent(a, b) || byId(a, b)
      if (sort === 'most_recent') return recent(a, b) || byId(a, b)
      return a.lastDate.localeCompare(b.lastDate) || byId(a, b)
    })
  }

  /** The customers the filters match, in order: what the list shows. */
  const listed = (audience: CampaignAudience): Candidate[] =>
    sorted(
      candidatesAt(audience.outletId).filter(passes(audience, lastSentAt(), Date.now())),
      audience.sort,
    )

  /**
   * Who a campaign goes to, in order: one definition, so the count, the list
   * and what submitting cuts cannot disagree.
   *
   * Picked one by one, it is those customers, whatever the filters say now
   * (they are still left out if they said stop). Picked all, it is everybody
   * the filters match but the unticked.
   */
  const audienceOf = (audience: CampaignAudience): DemoCustomerProfile[] => {
    const { picked } = audience
    const chosen =
      picked.kind === 'all'
        ? listed(audience).filter((entry) => !picked.except.includes(entry.profile.id))
        : sorted(
            candidatesAt(audience.outletId).filter((entry) =>
              picked.ids.includes(entry.profile.id),
            ),
            audience.sort,
          )
    return chosen.map((entry) => entry.profile)
  }

  const person = (profile: DemoCustomerProfile): CampaignAudiencePerson => ({
    customerId: profile.id,
    name: profile.name,
    phoneLast4: profile.phone.slice(-4),
  })

  const stoppedCustomer = (row: MarketingStoppedRow): StoppedCustomer => {
    const profile = profiles().find((candidate) => candidate.id === row.customer_id)
    const past = state.pastCustomers.get(row.customer_id)
    return {
      customerId: row.customer_id,
      name: profile?.name ?? past?.name ?? null,
      phoneLast4: profile?.phone.slice(-4) ?? past?.phoneLast4 ?? '0000',
      stoppedAt: row.stopped_at,
      source: row.source,
      campaignName:
        state.campaigns.find((campaign) => campaign.id === row.campaign_id)?.name ?? null,
      recordedByName: personName(row.recorded_by),
    }
  }

  return {
    async overview() {
      requireOwner()
      return {
        sender: senderReading(state),
        campaigns: [...state.campaigns]
          .sort((a, b) => b.created_at.localeCompare(a.created_at))
          .map(summary),
        stoppedCount: state.stopped.length,
      }
    },

    async campaign(id): Promise<CampaignReading | null> {
      requireOwner()
      const row = state.campaigns.find((campaign) => campaign.id === id)
      if (!row) return null
      // One batch at a time across every campaign (design D7).
      const ahead = state.batches.find(
        (batch) => batch.state === 'released' && batch.campaign_id !== id,
      )
      const aheadOf =
        ahead && (row.state === 'scheduled' || row.state === 'paused')
          ? state.campaigns.find(
              (campaign) =>
                campaign.id === ahead.campaign_id &&
                (campaign.state === 'scheduled' || campaign.state === 'paused'),
            )
          : undefined
      return {
        sender: senderReading(state),
        campaign: detail(row),
        behindCampaignName: aheadOf?.name ?? null,
      }
    },

    async audienceCount(audience) {
      requireOwner()
      return audienceOf(audience).length
    },

    async audiencePage(audience, offset, search) {
      requireOwner()
      // The Customers page's own rules: a name anywhere in the saved name, or
      // digits anywhere in the number. Below the minimum, nothing narrows.
      const query = parseCustomerQuery(search ?? '')
      const everybody = listed(audience)
        .map((entry) => entry.profile)
        .filter(
          (profile) => query.kind === 'too-short' || customerMatchStrength(query, profile) !== null,
        )
      const rows = everybody.slice(offset, offset + AUDIENCE_PAGE_SIZE).map(person)
      const next = offset + rows.length
      return { rows, next: next < everybody.length ? next : null }
    },

    async saveDraft(draft) {
      requireOwner()
      const name = draft.name.trim()
      if (name === '') throw new CampaignActionError('name_required', 'Give the campaign a name.')
      const held = state.campaigns.find((campaign) => campaign.id === draft.id)
      if (held && held.state !== 'draft') {
        throw new CampaignActionError(
          'not_a_draft',
          'This campaign is already submitted, so it can no longer be changed.',
        )
      }
      if (held) {
        Object.assign(held, { name, body: draft.body, audience: draft.audience })
        return detail(held)
      }
      const row: MarketingCampaignRow = {
        id: draft.id,
        name,
        body: draft.body,
        image_path: null,
        test_phones: [],
        audience: draft.audience,
        batch_size: null,
        state: 'draft',
        paused_reason: null,
        not_before: null,
        created_by: actorId,
        created_at: new Date().toISOString(),
        scheduled_by: null,
        scheduled_at: null,
        finished_at: null,
        finish_notice_sent_at: null,
      }
      state.campaigns.push(row)
      return detail(row)
    },

    async setImage(id, image) {
      requireOwner()
      const row = requireCampaign(id)
      if (row.state !== 'draft') {
        throw new CampaignActionError(
          'not_a_draft',
          'This campaign is already submitted, so it can no longer be changed.',
        )
      }
      const previous = state.images.get(id)
      if (previous && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(previous)
      if (image === null || typeof URL.createObjectURL !== 'function') {
        state.images.delete(id)
        row.image_path = null
      } else {
        // Held in this tab and nowhere else: the demo uploads nothing.
        state.images.set(id, URL.createObjectURL(image))
        row.image_path = `demo/${id}`
      }
      return detail(row)
    },

    async schedule(id, notBefore) {
      requireOwner()
      const row = requireCampaign(id)
      if (row.state !== 'draft') {
        throw new CampaignActionError('not_a_draft', 'This campaign is already submitted.')
      }
      const problem = campaignBodyProblem(row.body)
      if (problem === 'empty') {
        throw new CampaignActionError('body_required', 'Write the message first.')
      }
      if (problem === 'too_long') {
        throw new CampaignActionError('body_too_long', 'The message is too long. Shorten it.')
      }
      if (!row.audience) {
        throw new CampaignActionError('audience_required', 'Choose who it goes to first.')
      }
      // The filters are evaluated once, here. What was counted is what is cut.
      const audience = audienceOf(row.audience)
      if (audience.length === 0) {
        throw new CampaignActionError('nobody_matches', 'Nobody matches that audience.')
      }
      const size = state.sender.batch_size
      audience.forEach((profile, index) => {
        state.recipients.push({
          campaign_id: id,
          customer_id: profile.id,
          batch_no: Math.floor(index / size) + 1,
          position: index + 1,
          state: 'waiting',
          claimed_at: null,
          sent_at: null,
          delivered_at: null,
          read_at: null,
          wa_message_id: null,
          failure_code: null,
        })
      })
      const batchCount = Math.ceil(audience.length / size)
      for (let batchNo = 1; batchNo <= batchCount; batchNo += 1) {
        state.batches.push(batchRow(id, batchNo, 'waiting', null, null))
      }
      Object.assign(row, {
        state: 'scheduled',
        batch_size: size,
        not_before: notBefore,
        scheduled_by: actorId,
        scheduled_at: new Date().toISOString(),
      })
      // The test numbers get it first, with no press on the laptop; one still
      // waiting from Send test is not queued twice.
      queueTests(id, { skipWaiting: true })
      return detail(row)
    },

    async pause(id) {
      requireOwner()
      const row = requireCampaign(id)
      if (row.state !== 'scheduled') {
        throw new CampaignActionError('wrong_state', 'Only a campaign that is going can be paused.')
      }
      row.state = 'paused'
      row.paused_reason = null
      return detail(row)
    },

    async resume(id) {
      requireOwner()
      const row = requireCampaign(id)
      if (row.state !== 'paused') {
        throw new CampaignActionError('wrong_state', 'Only a paused campaign can be resumed.')
      }
      row.state = 'scheduled'
      row.paused_reason = null
      return detail(row)
    },

    async stop(id) {
      requireOwner()
      const row = requireCampaign(id)
      if (row.state !== 'scheduled' && row.state !== 'paused') {
        throw new CampaignActionError(
          'wrong_state',
          'Only a campaign that is still going can be stopped.',
        )
      }
      // Its waiting rows stay as they are, and read as not sent (design D7).
      row.state = 'stopped'
      row.paused_reason = null
      row.finished_at = new Date().toISOString()
      return detail(row)
    },

    async stopped() {
      requireOwner()
      return [...state.stopped]
        .sort((a, b) => b.stopped_at.localeCompare(a.stopped_at))
        .map(stoppedCustomer)
    },

    async addStopped(phone) {
      requireOwner()
      const checked = validateIndianPhone(phone)
      if (checked.phone === null) {
        throw new CampaignActionError(
          'phone_incomplete',
          phoneErrorMessage(checked.error ?? 'incomplete'),
        )
      }
      const profile = customers.byPhone.get(checked.phone)
      if (!profile) {
        throw new CampaignActionError(
          'no_such_customer',
          'Nobody with that number has ordered, so there is nobody to stop.',
        )
      }
      const held = state.stopped.find((row) => row.customer_id === profile.id)
      if (held) return stoppedCustomer(held)
      const row: MarketingStoppedRow = {
        customer_id: profile.id,
        stopped_at: new Date().toISOString(),
        source: 'owner',
        campaign_id: null,
        recorded_by: actorId,
      }
      state.stopped.push(row)
      return stoppedCustomer(row)
    },

    async removeStopped(customerId) {
      requireOwner()
      const index = state.stopped.findIndex((row) => row.customer_id === customerId)
      if (index !== -1) state.stopped.splice(index, 1)
    },

    async setTestNumbers(id, phones) {
      requireOwner()
      const row = requireCampaign(id)
      requireGoing(row)
      const stored: string[] = []
      for (const typed of phones) {
        const checked = checkTestNumber(typed)
        if (checked.phone === null) {
          throw new CampaignActionError('phone_incomplete', testNumberProblem(checked.error))
        }
        if (!stored.includes(checked.phone)) stored.push(checked.phone)
      }
      if (stored.length > MAX_TEST_NUMBERS) {
        throw new CampaignActionError(
          'too_many_test_numbers',
          `A campaign takes at most ${MAX_TEST_NUMBERS} test numbers.`,
        )
      }
      row.test_phones = stored
      return [...stored]
    },

    async sendTest(id) {
      requireOwner()
      const row = requireCampaign(id)
      requireGoing(row)
      if (row.test_phones.length === 0) {
        throw new CampaignActionError('no_test_numbers', 'Add a test number first.')
      }
      const problem = campaignBodyProblem(row.body)
      if (problem === 'empty') {
        throw new CampaignActionError('body_required', 'Write the message first.')
      }
      if (problem === 'too_long') {
        throw new CampaignActionError('body_too_long', 'The message is too long. Shorten it.')
      }
      if (state.tests.some((test) => test.campaign_id === id && test.state === 'waiting')) {
        throw new CampaignActionError(
          'test_already_waiting',
          'A test is already waiting for the laptop.',
        )
      }
      return queueTests(id, { skipWaiting: false })
    },

    async testNumberSuggestions() {
      requireOwner()
      // Most recently used first: a test send's time, else the campaign's.
      const used = new Map<string, string>()
      const note = (phone: string, at: string) => {
        const held = used.get(phone)
        if (!held || at > held) used.set(phone, at)
      }
      for (const test of state.tests) note(test.phone, test.queued_at)
      for (const campaign of state.campaigns) {
        for (const phone of campaign.test_phones) {
          note(phone, campaign.scheduled_at ?? campaign.created_at)
        }
      }
      return [...used.entries()]
        .sort((a, b) => b[1].localeCompare(a[1]) || a[0].localeCompare(b[0]))
        .slice(0, TEST_NUMBER_SUGGESTIONS)
        .map(([phone]) => phone)
    },
  }
}
