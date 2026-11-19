import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'

import { AUDIENCE_PAGE_SIZE, everybodyAt, nobodyAt } from '../campaigns'
import type { Database } from '../database.types'
import { createSupabaseCampaignsAdapter } from './campaigns'

/**
 * The real campaigns adapter against a stubbed client (task 3.1). What is
 * tested is the seam: how the database's documents read as the page's shapes,
 * that a write is answered by reading the campaign again, that a refusal word
 * reads as the sentence the page shows, and that a picture is signed once and
 * not on every refresh. Who may call what is proved where it lives: pgTAP and
 * the REST probes of `99_whatsapp_campaigns_are_the_owners`.
 */

const SENDER = {
  status: 'idle',
  last_seen_at: '2026-11-18T08:59:30Z',
  halt_reason: null,
  linked_number_last4: '4721',
  server_now: '2026-11-18T09:00:00Z',
  batch_size: 100,
  window_start: '10:00:00',
  window_end: '21:00:00',
  min_gap_seconds: 45,
  max_gap_seconds: 90,
}

const SUMMARY = {
  id: 'c-1',
  name: 'Diwali offer',
  state: 'scheduled',
  paused_reason: null,
  not_before: null,
  recipients: 3,
  sent: 1,
  sending_batch_no: null,
  next_batch_no: 1,
  created_at: '2026-11-18T08:00:00Z',
  scheduled_at: '2026-11-18T08:10:00Z',
  finished_at: null,
}

const COUNTS = {
  recipients: 3,
  sent: 1,
  to_go: 2,
  delivered: 1,
  read: 0,
  not_on_whatsapp: 0,
  failed: 0,
  unsure: 0,
  stopped: 0,
}

const READING = {
  sender: SENDER,
  campaign: {
    ...SUMMARY,
    body: 'Hi {name}',
    image_path: 'c-1/a.jpg',
    audience: { ...everybodyAt('o-1') },
    batch_size: 100,
    counts: COUNTS,
    batches: [{ batch_no: 1, state: 'waiting', released_at: null, finished_at: null, ...COUNTS }],
    scheduled_by_name: 'Demo Owner',
    test_phones: ['+919000000901'],
    tests: [
      {
        id: 't-1',
        phone: '+919000000901',
        state: 'sent',
        queued_at: '2026-11-18T08:10:00Z',
        sent_at: '2026-11-18T08:11:00Z',
        failure_code: null,
      },
    ],
  },
  behind_campaign_name: 'Weekend combo',
}

type Rpc = ReturnType<typeof vi.fn>

function adapterWith(
  rpc: Rpc,
  storage: {
    createSignedUrl?: Rpc
    upload?: Rpc
  } = {},
) {
  const bucket = {
    createSignedUrl:
      storage.createSignedUrl ??
      vi.fn().mockResolvedValue({ data: { signedUrl: 'https://signed/1' }, error: null }),
    upload: storage.upload ?? vi.fn().mockResolvedValue({ data: {}, error: null }),
  }
  const from = vi.fn().mockReturnValue(bucket)
  const client = { rpc, storage: { from } } as unknown as SupabaseClient<Database>
  return { adapter: createSupabaseCampaignsAdapter(client), bucket, from }
}

/** An rpc that answers each function by name. */
function answering(answers: Record<string, unknown>): Rpc {
  return vi.fn(async (name: string) => {
    const answer = answers[name]
    if (answer instanceof Error)
      return { data: null, error: { message: answer.message, code: 'P0001' } }
    return { data: answer ?? null, error: null }
  })
}

describe('reading', () => {
  it('reads the list in one call, as the page names things', async () => {
    const rpc = answering({
      campaigns_overview: { sender: SENDER, campaigns: [SUMMARY], stopped_count: 7 },
    })
    const overview = await adapterWith(rpc).adapter.overview()
    expect(rpc).toHaveBeenCalledWith('campaigns_overview')
    expect(overview).toEqual({
      sender: {
        status: 'idle',
        lastSeenAt: '2026-11-18T08:59:30Z',
        haltReason: null,
        linkedNumberLast4: '4721',
        serverNow: '2026-11-18T09:00:00Z',
        batchSize: 100,
        windowStart: '10:00:00',
        windowEnd: '21:00:00',
      },
      campaigns: [
        {
          id: 'c-1',
          name: 'Diwali offer',
          state: 'scheduled',
          pausedReason: null,
          notBefore: null,
          recipients: 3,
          sent: 1,
          sendingBatchNo: null,
          nextBatchNo: 1,
          createdAt: '2026-11-18T08:00:00Z',
          scheduledAt: '2026-11-18T08:10:00Z',
          finishedAt: null,
        },
      ],
      stoppedCount: 7,
    })
  })

  it('reads a campaign’s page: counts, batches, tests, and the picture signed', async () => {
    const rpc = answering({ campaign_reading: READING })
    const { adapter, bucket, from } = adapterWith(rpc)
    const reading = (await adapter.campaign('c-1'))!
    expect(rpc).toHaveBeenCalledWith('campaign_reading', { p_campaign_id: 'c-1' })
    expect(from).toHaveBeenCalledWith('campaign-images')
    expect(bucket.createSignedUrl).toHaveBeenCalledWith('c-1/a.jpg', 6 * 60 * 60)
    expect(reading.behindCampaignName).toBe('Weekend combo')
    expect(reading.campaign).toMatchObject({
      body: 'Hi {name}',
      imageUrl: 'https://signed/1',
      batchSize: 100,
      counts: { toGo: 2, notOnWhatsApp: 0, delivered: 1 },
      batches: [{ batchNo: 1, state: 'waiting', toGo: 2 }],
      scheduledByName: 'Demo Owner',
      testPhones: ['+919000000901'],
      tests: [{ id: 't-1', state: 'sent', sentAt: '2026-11-18T08:11:00Z' }],
    })
  })

  it('signs a picture once, so the minute’s refresh is the same address', async () => {
    const rpc = answering({ campaign_reading: READING })
    const { adapter, bucket } = adapterWith(rpc)
    const first = (await adapter.campaign('c-1'))!.campaign.imageUrl
    const second = (await adapter.campaign('c-1'))!.campaign.imageUrl
    expect(second).toBe(first)
    expect(bucket.createSignedUrl).toHaveBeenCalledTimes(1)
  })

  it('shows a page without its picture when the picture cannot be signed', async () => {
    const rpc = answering({ campaign_reading: READING })
    const { adapter } = adapterWith(rpc, {
      createSignedUrl: vi.fn().mockResolvedValue({ data: null, error: { message: 'no' } }),
    })
    expect((await adapter.campaign('c-1'))!.campaign.imageUrl).toBeNull()
  })

  it('reads no campaign, or an address that is not an id, as not there', async () => {
    expect(
      await adapterWith(answering({ campaign_reading: null })).adapter.campaign('c-9'),
    ).toBeNull()
    const malformed = vi
      .fn()
      .mockResolvedValue({ data: null, error: { code: '22P02', message: 'x' } })
    expect(await adapterWith(malformed).adapter.campaign('not-an-id')).toBeNull()
  })
})

describe('the audience', () => {
  it('counts and lists with the app’s own document, a page and one more', async () => {
    const rows = Array.from({ length: AUDIENCE_PAGE_SIZE + 1 }, (_, n) => ({
      customer_id: `k-${n}`,
      name: n === 0 ? null : `Customer ${n}`,
      phone_last4: '0101',
    }))
    const rpc = answering({ campaign_audience_count: 4, campaign_audience_list: rows })
    const { adapter } = adapterWith(rpc)
    const audience = nobodyAt('o-1')
    expect(await adapter.audienceCount(audience)).toBe(4)
    expect(rpc).toHaveBeenCalledWith('campaign_audience_count', { p_audience: audience })

    const page = await adapter.audiencePage(audience, 20, 'rit')
    expect(rpc).toHaveBeenCalledWith('campaign_audience_list', {
      p_audience: audience,
      p_offset: 20,
      p_search: 'rit',
    })
    expect(page.rows).toHaveLength(AUDIENCE_PAGE_SIZE)
    expect(page.rows[0]).toEqual({ customerId: 'k-0', name: null, phoneLast4: '0101' })
    expect(page.next).toBe(40)
  })

  it('sends no search when there is none, and ends a short page', async () => {
    const rpc = answering({ campaign_audience_list: [] })
    const page = await adapterWith(rpc).adapter.audiencePage(everybodyAt('o-1'), 0, '  ')
    expect(rpc).toHaveBeenCalledWith('campaign_audience_list', {
      p_audience: everybodyAt('o-1'),
      p_offset: 0,
    })
    expect(page).toEqual({ rows: [], next: null })
  })
})

describe('writing', () => {
  it('answers each write with the campaign as it now reads', async () => {
    const rpc = answering({ campaign_reading: READING })
    const { adapter } = adapterWith(rpc)
    const saved = await adapter.saveDraft({ id: 'c-1', name: 'D', body: 'B', audience: null })
    expect(rpc).toHaveBeenCalledWith('save_campaign_draft', {
      p_campaign_id: 'c-1',
      p_name: 'D',
      p_body: 'B',
      p_audience: null,
    })
    expect(saved.name).toBe('Diwali offer')

    await adapter.schedule('c-1', null)
    expect(rpc).toHaveBeenCalledWith('schedule_campaign', { p_campaign_id: 'c-1' })
    for (const verb of ['pause', 'resume', 'stop'] as const) {
      await adapter[verb]('c-1')
      expect(rpc).toHaveBeenCalledWith(`${verb}_campaign`, { p_campaign_id: 'c-1' })
    }
  })

  it('takes a picture off with no upload', async () => {
    const rpc = answering({ campaign_reading: READING })
    const { adapter, bucket } = adapterWith(rpc)
    await adapter.setImage('c-1', null)
    expect(bucket.upload).not.toHaveBeenCalled()
    expect(rpc).toHaveBeenCalledWith('set_campaign_image', {
      p_campaign_id: 'c-1',
      p_image_path: null,
    })
  })

  it('reads a refusal word as the sentence the page shows', async () => {
    const rpc = answering({ schedule_campaign: new Error('nobody_matches') })
    await expect(adapterWith(rpc).adapter.schedule('c-1', null)).rejects.toMatchObject({
      code: 'nobody_matches',
      message: 'Nobody is picked. Choose customers again.',
    })
    const denied = vi.fn().mockResolvedValue({ data: null, error: { code: '42501', message: '' } })
    await expect(adapterWith(denied).adapter.overview()).rejects.toMatchObject({
      code: 'not_permitted',
    })
    const unknown = vi.fn().mockResolvedValue({ data: null, error: { code: '08006', message: '' } })
    await expect(adapterWith(unknown).adapter.overview()).rejects.toMatchObject({
      code: 'failed',
    })
  })
})

describe('the stopped list and test numbers', () => {
  const STOPPED = {
    customer_id: 'k-1',
    name: 'Sourav Pal',
    phone_last4: '0105',
    stopped_at: '2026-11-13T20:22:58Z',
    source: 'owner',
    campaign_name: null,
    recorded_by_name: 'Demo Owner',
  }

  it('reads, adds and removes', async () => {
    const rpc = answering({
      marketing_stopped_list: [STOPPED],
      marketing_stopped_add: [STOPPED],
    })
    const { adapter } = adapterWith(rpc)
    expect(await adapter.stopped()).toEqual([
      {
        customerId: 'k-1',
        name: 'Sourav Pal',
        phoneLast4: '0105',
        stoppedAt: '2026-11-13T20:22:58Z',
        source: 'owner',
        campaignName: null,
        recordedByName: 'Demo Owner',
      },
    ])
    await adapter.addStopped('9000000105')
    expect(rpc).toHaveBeenCalledWith('marketing_stopped_add', { p_phone: '9000000105' })
    await adapter.removeStopped('k-1')
    expect(rpc).toHaveBeenCalledWith('marketing_stopped_remove', { p_customer_id: 'k-1' })
  })

  it('sets, sends and suggests test numbers', async () => {
    const rpc = answering({
      set_campaign_test_numbers: ['+919000000901'],
      send_campaign_test: 1,
      campaign_test_number_suggestions: ['+919000000901', '+12025550142'],
    })
    const { adapter } = adapterWith(rpc)
    expect(await adapter.setTestNumbers('c-1', ['90000 00901'])).toEqual(['+919000000901'])
    expect(rpc).toHaveBeenCalledWith('set_campaign_test_numbers', {
      p_campaign_id: 'c-1',
      p_phones: ['90000 00901'],
    })
    expect(await adapter.sendTest('c-1')).toBe(1)
    expect(await adapter.testNumberSuggestions()).toEqual(['+919000000901', '+12025550142'])
  })

  it('reads a test already waiting as the sentence the composer shows', async () => {
    const rpc = answering({ send_campaign_test: new Error('test_already_waiting') })
    await expect(adapterWith(rpc).adapter.sendTest('c-1')).rejects.toMatchObject({
      code: 'test_already_waiting',
      message: 'A test is already waiting for the laptop.',
    })
  })
})
