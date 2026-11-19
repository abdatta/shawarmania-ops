import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'

import { newUuid } from '@/lib/uuid'
import { PictureUnreadable, shrinkPicture } from '@/lib/shrink-image'

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
  type CampaignTestSend,
  type CampaignsAdapter,
  type StoppedCustomer,
} from '../campaigns'
import type { Database, Json } from '../database.types'

/**
 * The real campaigns adapter (a-campaign-goes-out-on-whatsapp, task 3.1): the
 * Campaigns pages over the owner-only functions of
 * `20261119000000_a_campaign_goes_out_on_whatsapp.sql`.
 *
 * **Every call is the database's to refuse.** Each function checks the owner
 * and the account in its own body; nothing here decides who may. A refusal's
 * message is a word (`not_a_draft`, `nobody_matches`…), and `toCampaignError`
 * turns it into the sentence the page shows.
 *
 * **The app never sends.** It writes a campaign, its test numbers and its
 * picture, and reads back how far the laptop has got.
 *
 * **A picture is downloaded once per visit** (design, *Pictures and the free
 * plan*). `campaign_reading` gives the picture's path; this adapter signs a
 * path once, for longer than a visit, and hands the same address back on every
 * read after, so the minute's refresh of a campaign's page is the same address
 * to the browser and is not downloaded again. A picture is shrunk on the phone
 * before it is uploaded, and goes in under a name of its own each time, since
 * the bucket lets nobody overwrite a file.
 */

const BUCKET = 'campaign-images'

/** How long a signed picture address lasts: longer than anybody keeps a page open. */
const SIGNED_FOR_SECONDS = 6 * 60 * 60

/** An address with less than this left is signed again rather than handed out. */
const RESIGN_WITHIN_MS = 30 * 60 * 1000

/** The sentence each refusal word reads as. */
const REFUSALS: Readonly<Record<string, string>> = {
  not_permitted: 'Campaigns are for the owners.',
  not_found: 'That campaign is no longer here.',
  name_required: 'Give the campaign a name.',
  name_too_long: 'That name is too long. Shorten it.',
  body_required: 'Write the message first.',
  body_too_long: 'The message is too long. Shorten it.',
  audience_required: 'Choose who it goes to first.',
  audience_invalid: 'Those customers could not be read. Choose them again.',
  nobody_matches: 'Nobody is picked. Choose customers again.',
  not_a_draft: 'This campaign is already submitted, so it can no longer be changed.',
  wrong_state: 'That cannot be done to the campaign as it is now.',
  image_path_invalid: 'That picture could not be saved. Try another.',
  phone_incomplete: 'Type a 10-digit mobile, or the whole number with + and the country code.',
  no_such_customer: 'Nobody with that number has ordered, so there is nobody to stop.',
  too_many_test_numbers: 'A campaign takes at most 5 test numbers.',
  campaign_finished: 'This campaign is finished, so it takes no more tests.',
  no_test_numbers: 'Add a test number first.',
  test_already_waiting: 'A test is already waiting for the laptop.',
}

export function toCampaignError(error: PostgrestError | { message?: string; code?: string }) {
  const word = (error.message ?? '').trim()
  const sentence = REFUSALS[word]
  if (sentence) return new CampaignActionError(word, sentence)
  if (error.code === '42501')
    return new CampaignActionError('not_permitted', REFUSALS['not_permitted']!)
  return new CampaignActionError(
    'failed',
    'Campaigns could not be reached. They need the internet; try again in a moment.',
  )
}

// ── Reading the functions' documents ────────────────────────────────────────
// `campaigns_overview` and `campaign_reading` answer one jsonb each, in the
// database's snake_case. These turn them into the page's shapes and nothing
// more: every figure was counted by the database.

type Doc = Record<string, unknown>

const text = (value: unknown): string => (typeof value === 'string' ? value : '')
const textOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null)
const whole = (value: unknown): number => (typeof value === 'number' ? value : 0)
const wholeOrNull = (value: unknown): number | null => (typeof value === 'number' ? value : null)
const docs = (value: unknown): Doc[] => (Array.isArray(value) ? (value as Doc[]) : [])

function toSender(doc: Doc): CampaignSenderReading {
  return {
    status: text(doc['status']) as CampaignSenderReading['status'],
    lastSeenAt: textOrNull(doc['last_seen_at']),
    haltReason: textOrNull(doc['halt_reason']),
    linkedNumberLast4: textOrNull(doc['linked_number_last4']),
    serverNow: text(doc['server_now']),
    batchSize: whole(doc['batch_size']),
    windowStart: text(doc['window_start']),
    windowEnd: text(doc['window_end']),
  }
}

function toSummary(doc: Doc): CampaignSummary {
  return {
    id: text(doc['id']),
    name: text(doc['name']),
    state: text(doc['state']) as CampaignSummary['state'],
    pausedReason: textOrNull(doc['paused_reason']),
    notBefore: textOrNull(doc['not_before']),
    recipients: whole(doc['recipients']),
    sent: whole(doc['sent']),
    sendingBatchNo: wholeOrNull(doc['sending_batch_no']),
    nextBatchNo: wholeOrNull(doc['next_batch_no']),
    createdAt: text(doc['created_at']),
    scheduledAt: textOrNull(doc['scheduled_at']),
    finishedAt: textOrNull(doc['finished_at']),
  }
}

function toCounts(doc: Doc): CampaignCounts {
  return {
    recipients: whole(doc['recipients']),
    sent: whole(doc['sent']),
    toGo: whole(doc['to_go']),
    delivered: whole(doc['delivered']),
    read: whole(doc['read']),
    notOnWhatsApp: whole(doc['not_on_whatsapp']),
    failed: whole(doc['failed']),
    unsure: whole(doc['unsure']),
    stopped: whole(doc['stopped']),
  }
}

function toBatch(doc: Doc): CampaignBatchReading {
  return {
    batchNo: whole(doc['batch_no']),
    state: text(doc['state']) as CampaignBatchReading['state'],
    releasedAt: textOrNull(doc['released_at']),
    finishedAt: textOrNull(doc['finished_at']),
    ...toCounts(doc),
  }
}

function toTest(doc: Doc): CampaignTestSend {
  return {
    id: text(doc['id']),
    phone: text(doc['phone']),
    state: text(doc['state']) as CampaignTestSend['state'],
    queuedAt: text(doc['queued_at']),
    sentAt: textOrNull(doc['sent_at']),
    failureCode: textOrNull(doc['failure_code']),
  }
}

function toStopped(row: {
  customer_id: string
  name: string | null
  phone_last4: string
  stopped_at: string
  source: StoppedCustomer['source']
  campaign_name: string | null
  recorded_by_name: string | null
}): StoppedCustomer {
  return {
    customerId: row.customer_id,
    name: row.name,
    phoneLast4: row.phone_last4,
    stoppedAt: row.stopped_at,
    source: row.source,
    campaignName: row.campaign_name,
    recordedByName: row.recorded_by_name,
  }
}

/** The audience as the column holds it: the app's own document. */
const audienceArg = (audience: CampaignAudience) => audience as unknown as Json

export function createSupabaseCampaignsAdapter(client: SupabaseClient<Database>): CampaignsAdapter {
  /** Signed picture addresses, by path, for as long as this session runs. */
  const signed = new Map<string, { url: string; until: number }>()

  async function pictureUrl(path: string | null): Promise<string | null> {
    if (path === null) return null
    const held = signed.get(path)
    if (held && held.until - Date.now() > RESIGN_WITHIN_MS) return held.url
    const { data, error } = await client.storage
      .from(BUCKET)
      .createSignedUrl(path, SIGNED_FOR_SECONDS)
    // A picture that cannot be shown is not a page that cannot be read.
    if (error || !data) return held?.url ?? null
    signed.set(path, { url: data.signedUrl, until: Date.now() + SIGNED_FOR_SECONDS * 1000 })
    return data.signedUrl
  }

  async function reading(campaignId: string): Promise<CampaignReading | null> {
    const { data, error } = await client.rpc('campaign_reading', { p_campaign_id: campaignId })
    if (error) {
      // An address that is not a campaign's id is a campaign that is not there.
      if (error.code === '22P02') return null
      throw toCampaignError(error)
    }
    if (data === null || typeof data !== 'object' || Array.isArray(data)) return null
    const doc = data as Doc
    const campaign = (doc['campaign'] ?? {}) as Doc
    const detail: CampaignDetail = {
      ...toSummary(campaign),
      body: text(campaign['body']),
      imageUrl: await pictureUrl(textOrNull(campaign['image_path'])),
      audience: (campaign['audience'] ?? null) as CampaignAudience | null,
      batchSize: wholeOrNull(campaign['batch_size']),
      counts: toCounts((campaign['counts'] ?? {}) as Doc),
      batches: docs(campaign['batches']).map(toBatch),
      scheduledByName: textOrNull(campaign['scheduled_by_name']),
      testPhones: Array.isArray(campaign['test_phones'])
        ? (campaign['test_phones'] as unknown[]).map(text)
        : [],
      tests: docs(campaign['tests']).map(toTest),
    }
    return {
      sender: toSender((doc['sender'] ?? {}) as Doc),
      campaign: detail,
      behindCampaignName: textOrNull(doc['behind_campaign_name']),
    }
  }

  /** A write answers nothing; the page is given the campaign as it now reads. */
  async function after(campaignId: string): Promise<CampaignDetail> {
    const read = await reading(campaignId)
    if (!read) throw new CampaignActionError('not_found', REFUSALS['not_found']!)
    return read.campaign
  }

  async function call(run: PromiseLike<{ error: PostgrestError | null }>): Promise<void> {
    const { error } = await run
    if (error) throw toCampaignError(error)
  }

  return {
    async overview() {
      const { data, error } = await client.rpc('campaigns_overview')
      if (error) throw toCampaignError(error)
      const doc = (data ?? {}) as Doc
      return {
        sender: toSender((doc['sender'] ?? {}) as Doc),
        campaigns: docs(doc['campaigns']).map(toSummary),
        stoppedCount: whole(doc['stopped_count']),
      }
    },

    campaign: reading,

    async audienceCount(audience) {
      const { data, error } = await client.rpc('campaign_audience_count', {
        p_audience: audienceArg(audience),
      })
      if (error) throw toCampaignError(error)
      return data ?? 0
    },

    async audiencePage(audience, offset, search) {
      const { data, error } = await client.rpc('campaign_audience_list', {
        p_audience: audienceArg(audience),
        p_offset: offset,
        ...(search && search.trim() !== '' ? { p_search: search } : {}),
      })
      if (error) throw toCampaignError(error)
      const rows = data ?? []
      // One row past a page comes back when there is a next one.
      return {
        rows: rows.slice(0, AUDIENCE_PAGE_SIZE).map((row): CampaignAudiencePerson => ({
          customerId: row.customer_id,
          name: row.name as string | null,
          phoneLast4: row.phone_last4,
        })),
        next: rows.length > AUDIENCE_PAGE_SIZE ? offset + AUDIENCE_PAGE_SIZE : null,
      }
    },

    async saveDraft(draft) {
      await call(
        client.rpc('save_campaign_draft', {
          p_campaign_id: draft.id,
          p_name: draft.name,
          p_body: draft.body,
          p_audience: draft.audience === null ? null : audienceArg(draft.audience),
        }),
      )
      return after(draft.id)
    },

    async setImage(campaignId, image) {
      let path: string | null = null
      if (image !== null) {
        let picture: Blob
        try {
          picture = await shrinkPicture(image)
        } catch (cause) {
          if (cause instanceof PictureUnreadable) {
            throw new CampaignActionError(
              'image_unreadable',
              'That picture could not be read. Try a JPEG or PNG photo.',
            )
          }
          throw cause
        }
        // A name of its own each time: nobody may overwrite a file in the bucket.
        path = `${campaignId}/${newUuid()}.jpg`
        const { error } = await client.storage
          .from(BUCKET)
          .upload(path, picture, { contentType: 'image/jpeg', upsert: false })
        if (error) {
          throw new CampaignActionError(
            'image_upload_failed',
            'That picture was not saved. It may be too large; try a smaller one.',
          )
        }
      }
      await call(
        client.rpc('set_campaign_image', {
          p_campaign_id: campaignId,
          // Null takes the picture off; the generated type does not say so.
          p_image_path: path as string,
        }),
      )
      return after(campaignId)
    },

    async schedule(campaignId) {
      // No start time (proposal, decision 11): when a batch goes is the owner's, on the laptop.
      await call(client.rpc('schedule_campaign', { p_campaign_id: campaignId }))
      return after(campaignId)
    },

    async pause(campaignId) {
      await call(client.rpc('pause_campaign', { p_campaign_id: campaignId }))
      return after(campaignId)
    },

    async resume(campaignId) {
      await call(client.rpc('resume_campaign', { p_campaign_id: campaignId }))
      return after(campaignId)
    },

    async stop(campaignId) {
      await call(client.rpc('stop_campaign', { p_campaign_id: campaignId }))
      return after(campaignId)
    },

    async stopped() {
      const { data, error } = await client.rpc('marketing_stopped_list')
      if (error) throw toCampaignError(error)
      return (data ?? []).map(toStopped)
    },

    async addStopped(phone) {
      const { data, error } = await client.rpc('marketing_stopped_add', { p_phone: phone })
      if (error) throw toCampaignError(error)
      const row = data?.[0]
      if (!row) throw new CampaignActionError('no_such_customer', REFUSALS['no_such_customer']!)
      return toStopped(row)
    },

    async removeStopped(customerId) {
      await call(client.rpc('marketing_stopped_remove', { p_customer_id: customerId }))
    },

    async setTestNumbers(campaignId, phones) {
      const { data, error } = await client.rpc('set_campaign_test_numbers', {
        p_campaign_id: campaignId,
        p_phones: phones,
      })
      if (error) throw toCampaignError(error)
      return data ?? []
    },

    async sendTest(campaignId) {
      const { data, error } = await client.rpc('send_campaign_test', {
        p_campaign_id: campaignId,
      })
      if (error) throw toCampaignError(error)
      return data ?? 0
    },

    async testNumberSuggestions() {
      const { data, error } = await client.rpc('campaign_test_number_suggestions')
      if (error) throw toCampaignError(error)
      return data ?? []
    },
  }
}
