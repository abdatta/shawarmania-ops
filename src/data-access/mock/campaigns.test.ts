import { describe, expect, it } from 'vitest'

import type { AppRole } from '../adapters'
import { everybodyAt, nobodyAt, type CampaignAudience } from '../campaigns'
import { createDemoData, createMockAdapters } from './index'
import {
  DEMO_CAMPAIGN_DONE_ID,
  DEMO_CAMPAIGN_DRAFT_ID,
  DEMO_CAMPAIGN_SENDING_ID,
  DEMO_SENDER_SCENES,
  setDemoSenderScene,
} from './campaigns'
import {
  customerIdForPhone,
  DEMO_LAPSED_CUSTOMER_PHONE,
  DEMO_REGULAR_CUSTOMER_PHONE,
  DEMO_RETURNING_CUSTOMER_PHONE,
} from './fixtures/customers'
import { OUTLET_KALYANI_ID, OUTLET_KANCHRAPARA_ID } from './fixtures/outlets'

/**
 * The mock campaigns (a-campaign-goes-out-on-whatsapp, design D15), held to the
 * rules the database will enforce: owners only, no full number in an audience
 * read, a stopped customer in no audience, and batches cut at scheduling.
 */

function demo(role: AppRole = 'super_admin') {
  const data = createDemoData()
  return { data, campaigns: createMockAdapters(role, data).campaigns }
}

const kalyani = everybodyAt(OUTLET_KALYANI_ID)

/** Any of the demo customers' numbers, whole: `+91…` or the ten digits. */
const DEMO_PHONE = /\+91|9000000[0-9]{3}/

describe('who may reach campaigns', () => {
  it.each(['franchise_admin', 'biller', 'employee'] as const)(
    'refuses a %s every read and every write',
    async (role) => {
      const { campaigns } = demo(role)
      const refused = { code: 'not_permitted' }
      await expect(campaigns.overview()).rejects.toMatchObject(refused)
      await expect(campaigns.campaign(DEMO_CAMPAIGN_DONE_ID)).rejects.toMatchObject(refused)
      await expect(campaigns.audienceCount(kalyani)).rejects.toMatchObject(refused)
      await expect(campaigns.audiencePage(kalyani, 0)).rejects.toMatchObject(refused)
      await expect(
        campaigns.saveDraft({ id: 'x', name: 'x', body: 'x', audience: null }),
      ).rejects.toMatchObject(refused)
      await expect(campaigns.schedule(DEMO_CAMPAIGN_DRAFT_ID, null)).rejects.toMatchObject(refused)
      await expect(campaigns.pause(DEMO_CAMPAIGN_SENDING_ID)).rejects.toMatchObject(refused)
      await expect(campaigns.stop(DEMO_CAMPAIGN_SENDING_ID)).rejects.toMatchObject(refused)
      await expect(campaigns.stopped()).rejects.toMatchObject(refused)
      await expect(campaigns.addStopped('9000000101')).rejects.toMatchObject(refused)
      await expect(campaigns.removeStopped('x')).rejects.toMatchObject(refused)
    },
  )
})

describe('the demo scenario', () => {
  it('holds a draft, one part-sent and one done, newest first', async () => {
    const { campaigns } = demo()
    const overview = await campaigns.overview()
    expect(overview.campaigns.map((campaign) => [campaign.name, campaign.state])).toEqual([
      ['New menu', 'draft'],
      ['Diwali offer', 'scheduled'],
      ['Weekend combo', 'done'],
    ])
    expect(overview.stoppedCount).toBe(7)
  })

  it('counts every figure from recipient rows, so the page’s tiles add up', async () => {
    const { campaigns } = demo()
    for (const id of [DEMO_CAMPAIGN_DONE_ID, DEMO_CAMPAIGN_SENDING_ID]) {
      const reading = await campaigns.campaign(id)
      const { counts, batches } = reading!.campaign
      // Everybody is in exactly one place. Somebody who replied STOP was sent to
      // first, so `stopped` is not one of the places.
      expect(counts.sent + counts.toGo + counts.notOnWhatsApp + counts.failed + counts.unsure).toBe(
        counts.recipients,
      )
      expect(batches.reduce((sum, batch) => sum + batch.recipients, 0)).toBe(counts.recipients)
      expect(batches.reduce((sum, batch) => sum + batch.sent, 0)).toBe(counts.sent)
      expect(batches.reduce((sum, batch) => sum + batch.stopped, 0)).toBe(counts.stopped)
      expect(counts.read).toBeLessThanOrEqual(counts.delivered)
      expect(counts.delivered).toBeLessThanOrEqual(counts.sent)
    }
  })

  it('leaves the part-sent campaign 47 into its third batch of a hundred', async () => {
    const { campaigns } = demo()
    const { campaign } = (await campaigns.campaign(DEMO_CAMPAIGN_SENDING_ID))!
    expect(campaign.counts.recipients).toBe(1000)
    expect(campaign.batches.map((batch) => batch.state)).toEqual([
      'done',
      'done',
      'released',
      ...Array<string>(7).fill('waiting'),
    ])
    expect(campaign.sendingBatchNo).toBe(3)
    expect(campaign.batches[2]).toMatchObject({ sent: 47, toGo: 53 })
    expect(campaign.counts.stopped).toBe(4)
  })

  it('finishes the done campaign with nothing left to go', async () => {
    const { campaigns } = demo()
    const { campaign } = (await campaigns.campaign(DEMO_CAMPAIGN_DONE_ID))!
    expect(campaign.counts).toMatchObject({ recipients: 418, toGo: 0, unsure: 1, failed: 1 })
    expect(campaign.batches).toHaveLength(5)
    expect(campaign.finishedAt).not.toBeNull()
  })

  it('answers null for a campaign that is not there', async () => {
    expect(await demo().campaigns.campaign('nope')).toBeNull()
  })
})

describe('the sender, in each scene the demo can show', () => {
  it('reports what the laptop last said, against the clock it was said on', async () => {
    const { data, campaigns } = demo()
    const seen = async () => (await campaigns.overview()).sender
    const age = (sender: { lastSeenAt: string | null; serverNow: string }) =>
      Date.parse(sender.serverNow) - Date.parse(sender.lastSeenAt ?? '')

    expect(await seen()).toMatchObject({ status: 'sending', linkedNumberLast4: '4721' })

    setDemoSenderScene(data.campaigns, 'offline')
    // Yesterday evening: hours ago, however early in the day the demo is opened.
    expect(age(await seen())).toBeGreaterThan(3 * 60 * 60_000)

    setDemoSenderScene(data.campaigns, 'halted')
    expect(await seen()).toMatchObject({ status: 'halted', haltReason: 'logged_out' })

    setDemoSenderScene(data.campaigns, 'not_linked')
    expect(await seen()).toMatchObject({ status: 'not_linked', linkedNumberLast4: null })

    setDemoSenderScene(data.campaigns, 'outside_hours')
    expect((await seen()).status).toBe('outside_hours')
  })

  it('puts the third batch back to waiting, and forward again, without touching the rest', async () => {
    const { data, campaigns } = demo()
    const read = async () => (await campaigns.campaign(DEMO_CAMPAIGN_SENDING_ID))!.campaign
    const before = await read()

    setDemoSenderScene(data.campaigns, 'waiting')
    const waiting = await read()
    expect(waiting.sendingBatchNo).toBeNull()
    expect(waiting.nextBatchNo).toBe(3)
    expect(waiting.batches[2]).toMatchObject({ state: 'waiting', sent: 0, toGo: 100 })
    expect(waiting.batches.slice(0, 2)).toEqual(before.batches.slice(0, 2))

    setDemoSenderScene(data.campaigns, 'sending')
    expect((await read()).batches[2]).toMatchObject({ state: 'released', sent: 47, toGo: 53 })
  })

  it('leaves a campaign an owner stopped exactly as they left it', async () => {
    const { data, campaigns } = demo()
    await campaigns.stop(DEMO_CAMPAIGN_SENDING_ID)
    for (const scene of DEMO_SENDER_SCENES) setDemoSenderScene(data.campaigns, scene)
    const { campaign } = (await campaigns.campaign(DEMO_CAMPAIGN_SENDING_ID))!
    expect(campaign.state).toBe('stopped')
    expect(campaign.batches[2]).toMatchObject({ state: 'released', sent: 47 })
  })
})

describe('an audience', () => {
  it('counts the demo’s own customers at the outlet, the stopped left out', async () => {
    const { data, campaigns } = demo()
    const count = await campaigns.audienceCount(kalyani)
    const page = await campaigns.audiencePage(kalyani, 0)
    expect(page.rows).toHaveLength(count)
    expect(page.next).toBeNull()
    // Everybody in it is somebody the Customers surface holds.
    const directory = new Set([...data.customers.byPhone.values()].map((profile) => profile.id))
    for (const row of page.rows) expect(directory.has(row.customerId)).toBe(true)
    // Sourav asked at the counter not to be messaged.
    expect(page.rows.map((row) => row.customerId)).not.toContain(
      customerIdForPhone(DEMO_LAPSED_CUSTOMER_PHONE),
    )
  })

  it('returns a name and the last four digits, and never a number', async () => {
    const { campaigns } = demo()
    const page = await campaigns.audiencePage(kalyani, 0)
    expect(page.rows.length).toBeGreaterThan(0)
    for (const row of page.rows) {
      expect(Object.keys(row).sort()).toEqual(['customerId', 'name', 'phoneLast4'])
      expect(row.phoneLast4).toMatch(/^[0-9]{4}$/)
    }
    expect(JSON.stringify(page)).not.toMatch(DEMO_PHONE)
  })

  it('narrows by each filter, and never widens', async () => {
    const { campaigns } = demo()
    const all = await campaigns.audienceCount(kalyani)
    const narrowed: CampaignAudience[] = [
      { ...kalyani, ordered: { kind: 'within', days: 7 } },
      { ...kalyani, orders: { kind: 'at_least', count: 3 } },
      { ...kalyani, gold: 'gold' },
      { ...kalyani, gold: 'not_gold' },
      { ...kalyani, spentAtLeastPaise: 100_000 },
      { ...kalyani, campaigns: { kind: 'never' } },
    ]
    for (const audience of narrowed) {
      const count = await campaigns.audienceCount(audience)
      expect(count).toBeLessThan(all)
    }
    // Within and not within split the audience between them.
    const within = await campaigns.audienceCount({
      ...kalyani,
      ordered: { kind: 'within', days: 30 },
    })
    const not = await campaigns.audienceCount({
      ...kalyani,
      ordered: { kind: 'not_within', days: 30 },
    })
    expect(within + not).toBe(all)
    const atLeast = await campaigns.audienceCount({
      ...kalyani,
      orders: { kind: 'at_least', count: 3 },
    })
    const atMost = await campaigns.audienceCount({
      ...kalyani,
      orders: { kind: 'at_most', count: 2 },
    })
    expect(atLeast + atMost).toBe(all)
  })

  it('reads one outlet’s customers, not the business’s', async () => {
    const { campaigns } = demo()
    const there = await campaigns.audiencePage(everybodyAt(OUTLET_KANCHRAPARA_ID), 0)
    const here = await campaigns.audiencePage(kalyani, 0)
    expect(there.rows.map((row) => row.customerId)).not.toEqual(
      here.rows.map((row) => row.customerId),
    )
  })

  it('puts the chosen order’s first customer first', async () => {
    const { campaigns } = demo()
    const first = async (sort: CampaignAudience['sort']) =>
      (await campaigns.audiencePage({ ...kalyani, sort }, 0)).rows[0]?.customerId
    // The demo's most frequent customer this month.
    expect(await first('most_orders')).toBe(customerIdForPhone(DEMO_REGULAR_CUSTOMER_PHONE))
    expect(await first('most_recent')).not.toBe(await first('longest_away'))
  })

  it('treats somebody already sent a campaign as sent one', async () => {
    const { campaigns } = demo()
    const never = await campaigns.audiencePage({ ...kalyani, campaigns: { kind: 'never' } }, 0)
    // Ritika was in Weekend combo.
    expect(never.rows.map((row) => row.customerId)).not.toContain(
      customerIdForPhone(DEMO_RETURNING_CUSTOMER_PHONE),
    )
    const lately = await campaigns.audiencePage(
      { ...kalyani, campaigns: { kind: 'not_within', days: 5 } },
      0,
    )
    expect(lately.rows.map((row) => row.customerId)).toContain(
      customerIdForPhone(DEMO_RETURNING_CUSTOMER_PHONE),
    )
  })
})

describe('picking customers', () => {
  it('starts with nobody picked, and counts only who is ticked', async () => {
    const { campaigns } = demo()
    expect(await campaigns.audienceCount(nobodyAt(OUTLET_KALYANI_ID))).toBe(0)
    const ritika = customerIdForPhone(DEMO_RETURNING_CUSTOMER_PHONE)
    const moumita = customerIdForPhone(DEMO_REGULAR_CUSTOMER_PHONE)
    const two = { ...nobodyAt(OUTLET_KALYANI_ID), picked: { kind: 'only', ids: [ritika, moumita] } }
    expect(await campaigns.audienceCount(two as CampaignAudience)).toBe(2)
  })

  it('keeps a customer ticked by hand whatever the filters say afterwards', async () => {
    const { campaigns } = demo()
    const ritika = customerIdForPhone(DEMO_RETURNING_CUSTOMER_PHONE)
    const picked: CampaignAudience = {
      ...nobodyAt(OUTLET_KALYANI_ID),
      // Ritika is gold, so this filter would leave her out.
      gold: 'not_gold',
      picked: { kind: 'only', ids: [ritika] },
    }
    expect(await campaigns.audienceCount(picked)).toBe(1)
    // Until she says stop.
    await campaigns.addStopped(DEMO_RETURNING_CUSTOMER_PHONE)
    expect(await campaigns.audienceCount(picked)).toBe(0)
  })

  it('picks everybody the filters match with Select all, but the ones left out', async () => {
    const { campaigns } = demo()
    const all = await campaigns.audienceCount(kalyani)
    const page = await campaigns.audiencePage(kalyani, 0)
    const first = page.rows[0]!.customerId
    const leftOut: CampaignAudience = { ...kalyani, picked: { kind: 'all', except: [first] } }
    expect(await campaigns.audienceCount(leftOut)).toBe(all - 1)
    // The list still shows everybody who matches, ticked or not.
    expect((await campaigns.audiencePage(leftOut, 0)).rows.map((row) => row.customerId)).toContain(
      first,
    )
  })

  it('cuts exactly the customers ticked, in the chosen order', async () => {
    const { data, campaigns } = demo()
    const ritika = customerIdForPhone(DEMO_RETURNING_CUSTOMER_PHONE)
    const moumita = customerIdForPhone(DEMO_REGULAR_CUSTOMER_PHONE)
    await campaigns.saveDraft({
      id: DEMO_CAMPAIGN_DRAFT_ID,
      name: 'New menu',
      body: 'Hi',
      audience: {
        ...nobodyAt(OUTLET_KALYANI_ID),
        picked: { kind: 'only', ids: [ritika, moumita] },
      },
    })
    const scheduled = await campaigns.schedule(DEMO_CAMPAIGN_DRAFT_ID, null)
    expect(scheduled.counts.recipients).toBe(2)
    const cut = data.campaigns.recipients
      .filter((row) => row.campaign_id === DEMO_CAMPAIGN_DRAFT_ID)
      .sort((a, b) => a.position - b.position)
    // Most orders first: Moumita is the most frequent customer.
    expect(cut.map((row) => row.customer_id)).toEqual([moumita, ritika])
  })

  it('finds a customer by name or by digits of their number, and shows no more of it', async () => {
    const { campaigns } = demo()
    const byName = await campaigns.audiencePage(kalyani, 0, 'ritika')
    expect(byName.rows.map((row) => row.name)).toEqual(['Ritika Sen'])
    const byDigits = await campaigns.audiencePage(kalyani, 0, '0103')
    expect(byDigits.rows.map((row) => row.name)).toEqual(['Arjun Das'])
    expect(JSON.stringify(byDigits)).not.toMatch(DEMO_PHONE)
    // Below three letters or digits, nothing narrows.
    expect((await campaigns.audiencePage(kalyani, 0, 'ri')).rows.length).toBe(
      (await campaigns.audiencePage(kalyani, 0)).rows.length,
    )
    // A search never reaches past the filters.
    const gold = await campaigns.audiencePage({ ...kalyani, gold: 'not_gold' }, 0, 'ritika')
    expect(gold.rows).toEqual([])
  })
})

describe('the demo crowd', () => {
  it('gives the demo enough customers to scroll, all last seen over 30 days ago', async () => {
    const data = createDemoData({ customerCrowd: true })
    const { campaigns } = createMockAdapters('super_admin', data)
    const everybody = await campaigns.audienceCount(kalyani)
    expect(everybody).toBeGreaterThan(150)
    // The last 30 days are the named customers alone.
    const lately = await campaigns.audienceCount({
      ...kalyani,
      ordered: { kind: 'within', days: 30 },
    })
    expect(lately).toBe(
      await demo().campaigns.audienceCount({ ...kalyani, ordered: { kind: 'within', days: 30 } }),
    )
    // Pages of twenty, to the end.
    let next: number | null = 0
    let seen = 0
    while (next !== null) {
      const page = await campaigns.audiencePage(kalyani, next)
      seen += page.rows.length
      next = page.next
    }
    expect(seen).toBe(everybody)
  })

  it('leaves the Customers walkthrough searches as they were', async () => {
    const plain = createMockAdapters('super_admin', createDemoData()).customerDirectory
    const crowded = createMockAdapters(
      'super_admin',
      createDemoData({ customerCrowd: true }),
    ).customerDirectory
    for (const query of ['ghosh', '0104', 'mmta']) {
      expect((await crowded.search(OUTLET_KALYANI_ID, query)).matches).toEqual(
        (await plain.search(OUTLET_KALYANI_ID, query)).matches,
      )
    }
    // And the thirty-day list.
    expect((await crowded.list(OUTLET_KALYANI_ID, 'regulars', 0)).rows).toEqual(
      (await plain.list(OUTLET_KALYANI_ID, 'regulars', 0)).rows,
    )
  })

  it('counts the crowd sent Weekend combo as sent a campaign', async () => {
    const { campaigns } = createMockAdapters('super_admin', createDemoData({ customerCrowd: true }))
    const all = await campaigns.audienceCount(kalyani)
    const never = await campaigns.audienceCount({ ...kalyani, campaigns: { kind: 'never' } })
    expect(all - never).toBeGreaterThan(80)
  })
})

describe('writing and scheduling', () => {
  it('creates a draft once however often it is saved', async () => {
    const { campaigns } = demo()
    const draft = { id: 'draft-1', name: '  Monsoon  ', body: 'Hi {name}', audience: null }
    await campaigns.saveDraft(draft)
    const again = await campaigns.saveDraft({ ...draft, body: 'Hello {name}' })
    expect(again).toMatchObject({ name: 'Monsoon', body: 'Hello {name}', state: 'draft' })
    const { campaigns: list } = await campaigns.overview()
    expect(list.filter((campaign) => campaign.id === 'draft-1')).toHaveLength(1)
  })

  it('refuses a draft with no name', async () => {
    await expect(
      demo().campaigns.saveDraft({ id: 'd', name: ' ', body: 'x', audience: null }),
    ).rejects.toMatchObject({ code: 'name_required' })
  })

  it('refuses to schedule without a message, an audience or anybody in it', async () => {
    const { campaigns } = demo()
    await expect(campaigns.schedule(DEMO_CAMPAIGN_DRAFT_ID, null)).rejects.toMatchObject({
      code: 'audience_required',
    })
    const save = (patch: { body?: string; audience?: CampaignAudience | null }) =>
      campaigns.saveDraft({ id: 'd', name: 'D', body: 'Hi', audience: kalyani, ...patch })
    await save({ body: '  ' })
    await expect(campaigns.schedule('d', null)).rejects.toMatchObject({ code: 'body_required' })
    await save({ body: 'x'.repeat(2000) })
    await expect(campaigns.schedule('d', null)).rejects.toMatchObject({ code: 'body_too_long' })
    await save({ audience: { ...kalyani, spentAtLeastPaise: 100_000_000 } })
    await expect(campaigns.schedule('d', null)).rejects.toMatchObject({ code: 'nobody_matches' })
  })

  it('cuts the audience into batches, all waiting, and sends nothing', async () => {
    const { data, campaigns } = demo()
    // Three to a batch, to see more than one batch out of the demo's few customers.
    data.campaigns.sender.batch_size = 3
    await campaigns.saveDraft({
      id: DEMO_CAMPAIGN_DRAFT_ID,
      name: 'New menu',
      body: 'Hi {name}',
      audience: kalyani,
    })
    const counted = await campaigns.audienceCount(kalyani)
    const order = (await campaigns.audiencePage(kalyani, 0)).rows.map((row) => row.customerId)
    const scheduled = await campaigns.schedule(DEMO_CAMPAIGN_DRAFT_ID, null)

    expect(scheduled.state).toBe('scheduled')
    expect(scheduled.batchSize).toBe(3)
    // What was counted is what was cut, in the order that was shown.
    expect(scheduled.counts).toMatchObject({ recipients: counted, toGo: counted, sent: 0 })
    expect(scheduled.batches).toHaveLength(Math.ceil(counted / 3))
    expect(scheduled.batches.every((batch) => batch.state === 'waiting')).toBe(true)
    const cut = data.campaigns.recipients
      .filter((row) => row.campaign_id === DEMO_CAMPAIGN_DRAFT_ID)
      .sort((a, b) => a.position - b.position)
    expect(cut.map((row) => row.customer_id)).toEqual(order)
    expect(cut.map((row) => row.batch_no)).toEqual(order.map((_, at) => Math.floor(at / 3) + 1))
    // A recipient row points at a customer and holds nothing of theirs.
    expect(Object.keys(cut[0] ?? {})).not.toContain('phone')
    expect(Object.keys(cut[0] ?? {})).not.toContain('name')

    // The batch size changes afterwards; this campaign keeps what it was cut at.
    data.campaigns.sender.batch_size = 100
    expect((await campaigns.campaign(DEMO_CAMPAIGN_DRAFT_ID))!.campaign.batchSize).toBe(3)
    // It waits behind the campaign whose batch is out.
    expect((await campaigns.campaign(DEMO_CAMPAIGN_DRAFT_ID))!.behindCampaignName).toBe(
      'Diwali offer',
    )
    // And once scheduled it is no longer a draft to change.
    await expect(
      campaigns.saveDraft({ id: DEMO_CAMPAIGN_DRAFT_ID, name: 'x', body: 'y', audience: kalyani }),
    ).rejects.toMatchObject({ code: 'not_a_draft' })
  })

  it('keeps the time a campaign may start from', async () => {
    const { campaigns } = demo()
    await campaigns.saveDraft({
      id: DEMO_CAMPAIGN_DRAFT_ID,
      name: 'New menu',
      body: 'Hi',
      audience: kalyani,
    })
    const scheduled = await campaigns.schedule(DEMO_CAMPAIGN_DRAFT_ID, '2026-12-01T04:30:00.000Z')
    expect(scheduled.notBefore).toBe('2026-12-01T04:30:00.000Z')
  })

  it('pauses, resumes and stops, and a stopped campaign stays stopped', async () => {
    const { campaigns } = demo()
    expect((await campaigns.pause(DEMO_CAMPAIGN_SENDING_ID)).state).toBe('paused')
    await expect(campaigns.pause(DEMO_CAMPAIGN_SENDING_ID)).rejects.toMatchObject({
      code: 'wrong_state',
    })
    expect((await campaigns.resume(DEMO_CAMPAIGN_SENDING_ID)).state).toBe('scheduled')
    const stopped = await campaigns.stop(DEMO_CAMPAIGN_SENDING_ID)
    expect(stopped.state).toBe('stopped')
    // The customers still waiting stay as they are, and read as not sent.
    expect(stopped.counts.toGo).toBe(753)
    await expect(campaigns.resume(DEMO_CAMPAIGN_SENDING_ID)).rejects.toMatchObject({
      code: 'wrong_state',
    })
    await expect(campaigns.stop(DEMO_CAMPAIGN_DONE_ID)).rejects.toMatchObject({
      code: 'wrong_state',
    })
  })
})

describe('test numbers', () => {
  it('stores up to five, as + and digits, a number from abroad included', async () => {
    const { campaigns } = demo()
    const stored = await campaigns.setTestNumbers(DEMO_CAMPAIGN_DRAFT_ID, [
      '90000 00901',
      '+1 (202) 555-0142',
      '+919000000901',
    ])
    expect(stored).toEqual(['+919000000901', '+12025550142'])
    const { campaign } = (await campaigns.campaign(DEMO_CAMPAIGN_DRAFT_ID))!
    expect(campaign.testPhones).toEqual(stored)
    await expect(
      campaigns.setTestNumbers(DEMO_CAMPAIGN_DRAFT_ID, ['2025550142']),
    ).rejects.toMatchObject({ code: 'phone_incomplete' })
    await expect(
      campaigns.setTestNumbers(
        DEMO_CAMPAIGN_DRAFT_ID,
        ['01', '02', '03', '04', '05', '06'].map((n) => `+9190000009${n}`),
      ),
    ).rejects.toMatchObject({ code: 'too_many_test_numbers' })
    await expect(
      campaigns.setTestNumbers(DEMO_CAMPAIGN_DONE_ID, ['+919000000901']),
    ).rejects.toMatchObject({ code: 'campaign_finished' })
  })

  it('queues a test for every number, once, and counts it in none of the figures', async () => {
    const { campaigns } = demo()
    await expect(campaigns.sendTest(DEMO_CAMPAIGN_DRAFT_ID)).rejects.toMatchObject({
      code: 'no_test_numbers',
    })
    await campaigns.setTestNumbers(DEMO_CAMPAIGN_DRAFT_ID, ['+919000000901', '+12025550142'])
    expect(await campaigns.sendTest(DEMO_CAMPAIGN_DRAFT_ID)).toBe(2)
    await expect(campaigns.sendTest(DEMO_CAMPAIGN_DRAFT_ID)).rejects.toMatchObject({
      code: 'test_already_waiting',
    })
    const { campaign } = (await campaigns.campaign(DEMO_CAMPAIGN_DRAFT_ID))!
    // The demo has no laptop: they wait.
    expect(campaign.tests.map((test) => [test.phone, test.state]).sort()).toEqual([
      ['+12025550142', 'waiting'],
      ['+919000000901', 'waiting'],
    ])
    expect(campaign.counts.recipients).toBe(0)
  })

  it('refuses a test of an empty message', async () => {
    const { campaigns } = demo()
    await campaigns.saveDraft({ id: 'd', name: 'D', body: ' ', audience: null })
    await campaigns.setTestNumbers('d', ['+919000000901'])
    await expect(campaigns.sendTest('d')).rejects.toMatchObject({ code: 'body_required' })
  })

  it('sends the test numbers ahead of the first batch on Submit', async () => {
    const { campaigns } = demo()
    await campaigns.saveDraft({
      id: DEMO_CAMPAIGN_DRAFT_ID,
      name: 'New menu',
      body: 'Hi',
      audience: kalyani,
    })
    await campaigns.setTestNumbers(DEMO_CAMPAIGN_DRAFT_ID, ['+919000000901'])
    const scheduled = await campaigns.schedule(DEMO_CAMPAIGN_DRAFT_ID, null)
    expect(scheduled.tests).toHaveLength(1)
    expect(scheduled.tests[0]).toMatchObject({ phone: '+919000000901', state: 'waiting' })
    // Test numbers are not customers: the figures count customers alone.
    expect(scheduled.counts.recipients).toBe(await campaigns.audienceCount(kalyani))
  })

  it('suggests numbers used before, most recent first, and only invented ones', async () => {
    const { campaigns } = demo()
    const suggested = await campaigns.testNumberSuggestions()
    expect(suggested).toEqual(['+919000000901', '+919000000902', '+12025550142'])
    for (const phone of suggested) expect(phone).toMatch(/^\+91900000|^\+1\d{3}5550[1]\d\d$/)
  })
})

describe('the stopped list', () => {
  it('lists who replied STOP and who an owner added, with no number', async () => {
    const { campaigns } = demo()
    const list = await campaigns.stopped()
    expect(list).toHaveLength(7)
    expect(list.filter((row) => row.source === 'reply')).toHaveLength(6)
    expect(list.find((row) => row.source === 'owner')).toMatchObject({
      name: 'Sourav Pal',
      phoneLast4: '0105',
      recordedByName: 'Demo Owner',
      campaignName: null,
    })
    expect(JSON.stringify(list)).not.toMatch(DEMO_PHONE)
  })

  it('takes a customer out of every audience when added, and back in when removed', async () => {
    const { campaigns } = demo()
    const before = await campaigns.audienceCount(kalyani)
    const added = await campaigns.addStopped('90000 00104')
    expect(added).toMatchObject({ name: 'Moumta Ghosh', phoneLast4: '0104', source: 'owner' })
    expect(await campaigns.audienceCount(kalyani)).toBe(before - 1)
    // Adding somebody twice is one row.
    await campaigns.addStopped('9000000104')
    expect(await campaigns.stopped()).toHaveLength(8)

    await campaigns.removeStopped(added.customerId)
    expect(await campaigns.audienceCount(kalyani)).toBe(before)
  })

  it('refuses half a number, and a number nobody has ordered with', async () => {
    const { campaigns } = demo()
    await expect(campaigns.addStopped('90000')).rejects.toMatchObject({ code: 'phone_incomplete' })
    await expect(campaigns.addStopped('9812345678')).rejects.toMatchObject({
      code: 'no_such_customer',
    })
  })

  it('leaves somebody stopped after scheduling out when the campaign is next cut', async () => {
    const { campaigns } = demo()
    await campaigns.addStopped('9000000104')
    await campaigns.saveDraft({
      id: DEMO_CAMPAIGN_DRAFT_ID,
      name: 'New menu',
      body: 'Hi',
      audience: kalyani,
    })
    const scheduled = await campaigns.schedule(DEMO_CAMPAIGN_DRAFT_ID, null)
    expect(scheduled.counts.recipients).toBe(await campaigns.audienceCount(kalyani))
  })
})
