/**
 * WhatsApp campaigns over HTTP (a-campaign-goes-out-on-whatsapp, #85).
 *
 * The phase gate stated literally: a manager, a biller, an employee and a
 * counter tablet, each really signed in, hand-craft a request for every
 * campaign table and every campaign function, and the database refuses each
 * one. pgTAP proves the same boundary against simulated claims
 * (`99_whatsapp_campaigns_are_the_owners.sql`); this proves the deployed stack
 * carries a real token to it.
 *
 * Requires the local stack: `npm run db:start && npm run db:reset`, then
 * `npm run test:rls`.
 *
 * **Nothing here changes the seeded database.** Every write attempted is a
 * refused one, and the owner makes read-only calls only, so the file can run
 * repeatedly against one reset and leaves `test:db` nothing to trip on.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'

import type { Database } from '../../../src/data-access/database.types'

const SUPABASE_URL = process.env['SUPABASE_URL'] ?? 'http://127.0.0.1:54321'
// The Supabase CLI's well-known local demo anon key: public by design,
// identical in every local stack, useless anywhere else.
const SUPABASE_ANON_KEY =
  process.env['SUPABASE_ANON_KEY'] ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

const PASSWORD = 'shawarmania-local'

const KALYANI = '00000000-0000-4000-a000-000000000001'
/** The seeded customer with a settled bill at Kalyani. Its number ends 0001. */
const SEEDED_CUSTOMER = '80000000-0000-4000-a000-000000000001'
/** No campaign has this id. The owner check comes before any lookup. */
const NO_CAMPAIGN = 'c0000000-0000-4000-a000-000000000001'

const OWNER = 'owner@login.shawarmania.invalid'

/** Everybody who is not an owner, signed in for real. */
const REFUSED = [
  ['a Franchise Admin', 'admin.kalyani@login.shawarmania.invalid'],
  ['a Biller', 'biller.kalyani@login.shawarmania.invalid'],
  ['an Employee', 'staff.kalyani@login.shawarmania.invalid'],
  ['a counter tablet', 'tablet.kalyani@login.shawarmania.invalid'],
] as const

const TABLES = [
  'marketing_campaigns',
  'marketing_campaign_batches',
  'marketing_campaign_recipients',
  'marketing_stopped',
  'marketing_sender',
  'marketing_campaign_tests',
] as const

type Client = SupabaseClient<Database>

function anonClient(): Client {
  return createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/** One sign-in per person for the whole file: GoTrue rate-limits password grants. */
const sessions = new Map<string, Promise<Client>>()

function session(email: string): Promise<Client> {
  const existing = sessions.get(email)
  if (existing) return existing
  const opened = (async () => {
    const client = anonClient()
    const { data, error } = await client.auth.signInWithPassword({ email, password: PASSWORD })
    if (error || !data.session) {
      throw new Error(`sign-in failed for ${email}: ${error?.message ?? 'no session'}`)
    }
    return client
  })()
  sessions.set(email, opened)
  return opened
}

/** Everybody the outlet has served, all of them ticked: what Select all sets. */
const everybodyAtKalyani = { outletId: KALYANI, picked: { kind: 'all', except: [] } }

/**
 * Every campaign function a signed-in client may call, with arguments an owner
 * could send. Well formed on purpose: a refusal has to be the owner check
 * speaking, not a complaint about the request.
 */
function everyCall(client: Client) {
  return [
    [
      'campaign_sender_tick',
      client.rpc('campaign_sender_tick', { p_status: 'idle', p_installation_id: 'http-probe' }),
    ],
    [
      'campaign_claim_next',
      client.rpc('campaign_claim_next', { p_campaign_id: NO_CAMPAIGN, p_batch_no: 1 }),
    ],
    [
      'campaign_report_result',
      client.rpc('campaign_report_result', {
        p_campaign_id: NO_CAMPAIGN,
        p_customer_id: SEEDED_CUSTOMER,
        p_state: 'sent',
        p_message_id: 'PROBE',
      }),
    ],
    ['campaign_release_stale_claims', client.rpc('campaign_release_stale_claims')],
    ['campaign_report_receipts', client.rpc('campaign_report_receipts', { p_receipts: [] })],
    ['campaign_outstanding_message_ids', client.rpc('campaign_outstanding_message_ids')],
    [
      'set_campaign_test_numbers',
      client.rpc('set_campaign_test_numbers', {
        p_campaign_id: NO_CAMPAIGN,
        p_phones: ['9000000001'],
      }),
    ],
    ['send_campaign_test', client.rpc('send_campaign_test', { p_campaign_id: NO_CAMPAIGN })],
    ['campaign_test_number_suggestions', client.rpc('campaign_test_number_suggestions')],
    ['campaign_claim_next_test', client.rpc('campaign_claim_next_test')],
    ['campaign_finish_notices', client.rpc('campaign_finish_notices')],
    [
      'campaign_mark_finish_notice',
      client.rpc('campaign_mark_finish_notice', { p_campaign_id: NO_CAMPAIGN }),
    ],
    [
      'campaign_report_test_result',
      client.rpc('campaign_report_test_result', {
        p_test_id: NO_CAMPAIGN,
        p_state: 'sent',
        p_message_id: 'PROBE',
      }),
    ],
    ['pause_campaign', client.rpc('pause_campaign', { p_campaign_id: NO_CAMPAIGN })],
    ['resume_campaign', client.rpc('resume_campaign', { p_campaign_id: NO_CAMPAIGN })],
    ['stop_campaign', client.rpc('stop_campaign', { p_campaign_id: NO_CAMPAIGN })],
    ['campaigns_overview', client.rpc('campaigns_overview')],
    ['campaign_reading', client.rpc('campaign_reading', { p_campaign_id: NO_CAMPAIGN })],
    [
      'save_campaign_draft',
      client.rpc('save_campaign_draft', {
        p_campaign_id: NO_CAMPAIGN,
        p_name: 'Probe',
        p_body: 'Hello',
        p_audience: everybodyAtKalyani,
      }),
    ],
    [
      'set_campaign_image',
      client.rpc('set_campaign_image', {
        p_campaign_id: NO_CAMPAIGN,
        p_image_path: `${NO_CAMPAIGN}/probe.jpg`,
      }),
    ],
    [
      'campaign_audience_count',
      client.rpc('campaign_audience_count', { p_audience: everybodyAtKalyani }),
    ],
    [
      'campaign_audience_list',
      client.rpc('campaign_audience_list', { p_audience: everybodyAtKalyani }),
    ],
    ['schedule_campaign', client.rpc('schedule_campaign', { p_campaign_id: NO_CAMPAIGN })],
    [
      'release_campaign_batch',
      client.rpc('release_campaign_batch', { p_campaign_id: NO_CAMPAIGN, p_batch_no: 1 }),
    ],
    ['marketing_stopped_list', client.rpc('marketing_stopped_list')],
    ['marketing_stopped_add', client.rpc('marketing_stopped_add', { p_phone: '9000000001' })],
    [
      'marketing_stopped_remove',
      client.rpc('marketing_stopped_remove', { p_customer_id: SEEDED_CUSTOMER }),
    ],
    ['campaign_record_stop', client.rpc('campaign_record_stop', { p_phone: '919000000001' })],
    [
      'update_marketing_sender_settings',
      client.rpc('update_marketing_sender_settings', {
        p_batch_size: 100,
        p_window_start: '10:00',
        p_window_end: '21:00',
        p_min_gap_seconds: 45,
        p_max_gap_seconds: 90,
      }),
    ],
  ] as const
}

describe('the campaign tables, asked for by hand', () => {
  it.each(REFUSED)('%s is refused every table', async (_who, email) => {
    const client = await session(email)
    for (const table of TABLES) {
      const read = await client.from(table).select('*')
      expect(read.error?.code, `select ${table}`).toBe('42501')
      expect(read.data, `select ${table}`).toBeNull()
    }
  })

  // "How many customers are stopped" and "how many campaigns exist" are
  // disclosures too, and a HEAD request is the cheapest way to ask.
  it.each(REFUSED)('%s is refused even a count', async (_who, email) => {
    const client = await session(email)
    for (const table of TABLES) {
      const counted = await client.from(table).select('*', { count: 'exact', head: true })
      expect(counted.status, `count ${table}`).toBe(403)
      expect(counted.count, `count ${table}`).toBeNull()
    }
  })

  it.each(REFUSED)('%s cannot write one', async (_who, email) => {
    const client = await session(email)
    const stop = await client
      .from('marketing_stopped')
      .insert({ customer_id: SEEDED_CUSTOMER, source: 'owner' })
    expect(stop.error?.code).toBe('42501')
    const settings = await client
      .from('marketing_sender')
      .update({ batch_size: 1000 })
      .eq('id', true)
    expect(settings.error?.code).toBe('42501')
    const gone = await client.from('marketing_campaigns').delete().neq('name', '')
    expect(gone.error?.code).toBe('42501')
  })

  it('an anonymous caller is refused every table', async () => {
    const anon = anonClient()
    for (const table of TABLES) {
      const read = await anon.from(table).select('*')
      expect(read.error?.code, `select ${table}`).toBe('42501')
      expect(read.data, `select ${table}`).toBeNull()
    }
  })

  // The functions are the only way in, for everybody.
  it('even the owner cannot read a table directly', async () => {
    const owner = await session(OWNER)
    for (const table of TABLES) {
      const read = await owner.from(table).select('*')
      expect(read.error?.code, `select ${table}`).toBe('42501')
    }
  })
})

describe('the campaign functions, called by hand', () => {
  // When the refusals began: no tick from a refused caller may be seen after it.
  const refusalsBegan = new Date(Date.now() - 1_000)

  it.each(REFUSED)('%s is refused every function', async (_who, email) => {
    const client = await session(email)
    for (const [name, call] of everyCall(client)) {
      const { data, error } = await call
      expect(error?.code, name).toBe('42501')
      expect(data, name).toBeNull()
    }
  })

  it('an anonymous caller is refused every function', async () => {
    for (const [name, call] of everyCall(anonClient())) {
      const { data, error } = await call
      expect(error?.code, name).toBe('42501')
      expect(data, name).toBeNull()
    }
  })

  it('none of those calls left a campaign, a stop or a changed setting behind', async () => {
    const owner = await session(OWNER)
    const { data, error } = await owner.rpc('campaigns_overview')
    expect(error).toBeNull()
    const overview = data as {
      sender: { batch_size: number; last_seen_at: string | null }
      campaigns: unknown[]
      stopped_count: number
    }
    expect(overview.campaigns).toEqual([])
    expect(overview.stopped_count).toBe(0)
    expect(overview.sender.batch_size).toBe(100)
    // No tick from a refused caller was recorded as the sender being seen. The
    // owner's own tick below is, so a later run finds one from before it began.
    const seen = overview.sender.last_seen_at
    expect(seen === null || new Date(seen) < refusalsBegan).toBe(true)
  })
})

describe('the owner, over HTTP', () => {
  // The two functions that write the sender's one row. Over HTTP an UPDATE
  // with no WHERE is refused (pg_safeupdate), which pgTAP, running in psql,
  // never meets: the tick shipped that way once and was found only when the
  // laptop first called it (2026-11-18).
  it('ticks as the sender, and is answered', async () => {
    const owner = await session(OWNER)
    const { data, error } = await owner.rpc('campaign_sender_tick', {
      p_status: 'idle',
      p_installation_id: 'http-owner',
    })
    expect(error).toBeNull()
    expect(data).toMatchObject({ contract_version: 1, stand_down: false, tests_waiting: 0 })
  })

  it('changes the sender settings, and is answered', async () => {
    const owner = await session(OWNER)
    // The defaults, written back as they are: the call is what is under test.
    const { error } = await owner.rpc('update_marketing_sender_settings', {
      p_batch_size: 100,
      p_window_start: '10:00',
      p_window_end: '21:00',
      p_min_gap_seconds: 45,
      p_max_gap_seconds: 90,
    })
    expect(error).toBeNull()
  })

  it('reads the list, with the database clock beside the sender', async () => {
    const owner = await session(OWNER)
    const { data, error } = await owner.rpc('campaigns_overview')
    expect(error).toBeNull()
    const overview = data as { sender: Record<string, unknown> }
    expect(Object.keys(overview.sender).sort()).toEqual([
      'batch_size',
      'halt_reason',
      'last_seen_at',
      'linked_number_last4',
      'max_gap_seconds',
      'min_gap_seconds',
      'server_now',
      'status',
      'window_end',
      'window_start',
    ])
    expect(typeof overview.sender['server_now']).toBe('string')
  })

  it('counts an audience and looks through it without ever being sent a number', async () => {
    const owner = await session(OWNER)
    const counted = await owner.rpc('campaign_audience_count', { p_audience: everybodyAtKalyani })
    expect(counted.error).toBeNull()
    expect(counted.data).toBeGreaterThanOrEqual(1)

    const listed = await owner.rpc('campaign_audience_list', { p_audience: everybodyAtKalyani })
    expect(listed.error).toBeNull()
    const rows = listed.data ?? []
    expect(rows.length).toBe(counted.data)
    const seeded = rows.find((row) => row.customer_id === SEEDED_CUSTOMER)
    expect(seeded).toEqual({
      customer_id: SEEDED_CUSTOMER,
      name: 'Test Customer (Synthetic)',
      phone_last4: '0001',
    })
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(['customer_id', 'name', 'phone_last4'])
      expect(row.phone_last4).toMatch(/^\d{4}$/)
    }
    // The whole response, as it crossed the wire: the seeded numbers are
    // +91 90000 0000x, and none of them is in it.
    expect(JSON.stringify(listed.data)).not.toContain('90000000')
  })

  it('counts nobody until somebody is ticked, and still lists them to tick', async () => {
    const owner = await session(OWNER)
    const nobodyTicked = { outletId: KALYANI, picked: { kind: 'only', ids: [] } }
    const counted = await owner.rpc('campaign_audience_count', { p_audience: nobodyTicked })
    expect(counted.error).toBeNull()
    expect(counted.data).toBe(0)
    const found = await owner.rpc('campaign_audience_list', {
      p_audience: nobodyTicked,
      p_search: '0001',
    })
    expect(found.error).toBeNull()
    expect(found.data).toEqual([
      { customer_id: SEEDED_CUSTOMER, name: 'Test Customer (Synthetic)', phone_last4: '0001' },
    ])
  })

  it('is refused an audience with a filter the database does not know', async () => {
    const owner = await session(OWNER)
    const { error } = await owner.rpc('campaign_audience_count', {
      p_audience: { outletId: KALYANI, everybody: true },
    })
    expect(error?.code).toBe('22023')
    expect(error?.message).toBe('audience_invalid')
  })

  it('reads a campaign that does not exist as nothing, and the stopped list as empty', async () => {
    const owner = await session(OWNER)
    const reading = await owner.rpc('campaign_reading', { p_campaign_id: NO_CAMPAIGN })
    expect(reading.error).toBeNull()
    expect(reading.data).toBeNull()
    const stopped = await owner.rpc('marketing_stopped_list')
    expect(stopped.error).toBeNull()
    expect(stopped.data).toEqual([])
    const outstanding = await owner.rpc('campaign_outstanding_message_ids')
    expect(outstanding.error).toBeNull()
    expect(outstanding.data).toEqual([])
  })
})

describe('the campaign pictures, over HTTP', () => {
  const picture = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' })

  it.each(REFUSED)('%s cannot upload one, list them or fetch one', async (_who, email) => {
    const client = await session(email)
    const bucket = client.storage.from('campaign-images')
    const uploaded = await bucket.upload(`${NO_CAMPAIGN}/probe.jpg`, picture(), {
      contentType: 'image/jpeg',
    })
    expect(uploaded.error).not.toBeNull()
    expect(uploaded.data).toBeNull()
    const listed = await bucket.list(NO_CAMPAIGN)
    expect(listed.data ?? []).toEqual([])
    const signed = await bucket.createSignedUrl(`${NO_CAMPAIGN}/probe.jpg`, 60)
    expect(signed.error).not.toBeNull()
  })

  it('an anonymous caller cannot upload one', async () => {
    const uploaded = await anonClient()
      .storage.from('campaign-images')
      .upload(`${NO_CAMPAIGN}/probe.jpg`, picture(), { contentType: 'image/jpeg' })
    expect(uploaded.error).not.toBeNull()
  })

  it('the bucket is not public', async () => {
    const response = await fetch(
      `${SUPABASE_URL}/storage/v1/object/public/campaign-images/${NO_CAMPAIGN}/probe.jpg`,
    )
    expect(response.ok).toBe(false)
  })
})
