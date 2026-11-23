import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import { AdaptersContext } from '@/data-access/adapters-context'
import { everybodyAt, type CampaignAudience } from '@/data-access/campaigns'
import { createDemoData, createMockAdapters } from '@/data-access/mock'
import {
  DEMO_CAMPAIGN_DONE_ID,
  DEMO_CAMPAIGN_DRAFT_ID,
  DEMO_CAMPAIGN_SENDING_ID,
  setDemoSenderScene,
  type DemoSenderScene,
} from '@/data-access/mock/campaigns'
import { OUTLET_KALYANI_ID } from '@/data-access/mock/fixtures/outlets'
import { personaFixtures } from '@/data-access/mock/fixtures/personas'
import { GatedSurface } from '@/routes/gated-surface'
import { SessionContext } from '@/session/context'
import { deriveSessionScope, type Role, type Session } from '@/session/session'

import { CampaignPage } from './campaign-page'
import { LEAVE_UNSAVED } from './composer'
import { CampaignsSurface } from './campaigns-surface'
import { StoppedSurface } from './stopped-surface'

/**
 * The Campaigns pages over the demo's mock (a-campaign-goes-out-on-whatsapp,
 * tasks 1.4): the list, a campaign's page, the composer, who it goes to, and
 * the stopped list. Nothing here can send, and the tests hold the pages to
 * offering no control that looks as if it could.
 */

function sessionFor(role: Role): Session {
  const persona = personaFixtures[role]
  return {
    mode: 'demo',
    userId: persona.profile.id,
    assignments: persona.assignments,
    ...deriveSessionScope(persona.assignments),
    displayName: persona.profile.full_name,
    persona,
  }
}

function open(
  path: string,
  options: { role?: Role; scene?: DemoSenderScene; draftAudience?: CampaignAudience } = {},
) {
  const role = options.role ?? 'super_admin'
  const data = createDemoData()
  if (options.scene) setDemoSenderScene(data.campaigns, options.scene)
  const draft = data.campaigns.campaigns.find((row) => row.id === DEMO_CAMPAIGN_DRAFT_ID)
  if (draft && options.draftAudience) draft.audience = options.draftAudience
  const adapters = createMockAdapters(role, data)
  const router = createMemoryRouter(
    [
      {
        path: '/demo/owner/campaigns',
        element: (
          <GatedSurface path="campaigns">
            <CampaignsSurface />
          </GatedSurface>
        ),
      },
      { path: '/demo/owner/campaigns/stopped', element: <StoppedSurface /> },
      { path: '/demo/owner/campaigns/:campaignId', element: <CampaignPage /> },
    ],
    { initialEntries: [`/demo/owner/${path}`] },
  )
  render(
    <SessionContext.Provider value={sessionFor(role)}>
      <AdaptersContext.Provider value={adapters}>
        <RouterProvider router={router} />
      </AdaptersContext.Provider>
    </SessionContext.Provider>,
  )
  return { data, adapters, router }
}

/** Open the picker's Filter, choose one option in one group, and close it again. */
async function filterBy(
  user: ReturnType<typeof userEvent.setup>,
  sheet: HTMLElement,
  group: string,
  option: string,
) {
  await user.click(within(sheet).getByTestId('audience-filter'))
  const filters = screen.getByRole('dialog', { name: 'Filter customers' })
  await user.click(
    within(within(filters).getByRole('region', { name: group })).getByRole('radio', {
      name: option,
    }),
  )
  await user.click(within(filters).getByTestId('audience-filter-done'))
}

/**
 * No page may offer to send or release to customers: that is the laptop's
 * (design D7). Send test is the one send a page has, and it reaches only the
 * test numbers [owner, 2026-11-24].
 */
function expectNoSendControl() {
  for (const control of [...screen.queryAllByRole('button'), ...screen.queryAllByRole('link')]) {
    if (control.getAttribute('data-testid') === 'send-test') continue
    expect(control.textContent ?? '').not.toMatch(/\b(send|release)\b/i)
    expect(control.getAttribute('aria-label') ?? '').not.toMatch(/\b(send|release)\b/i)
  }
}

describe('the Campaigns list', () => {
  it('shows the sender, each campaign with how far it has got, and the stopped count', async () => {
    open('campaigns')
    expect(screen.getByTestId('campaigns-loading')).toBeInTheDocument()
    const list = await screen.findByTestId('campaign-list')
    expect(screen.getByRole('heading', { name: 'Campaigns' })).toBeInTheDocument()
    expect(screen.getByTestId('sender-line')).toHaveTextContent('Sender online · sending batch 3')

    const rows = within(list).getAllByRole('link')
    expect(rows.map((row) => within(row).getByTestId('campaign-state').textContent)).toEqual([
      'draft',
      'sending',
      'done',
    ])
    expect(within(rows[1]!).getByTestId('campaign-progress')).toHaveTextContent('245 / 1,000')
    expect(within(rows[2]!).getByTestId('campaign-progress')).toHaveTextContent('414 / 418')
    // A draft has nobody yet, so it shows no count at all.
    expect(within(rows[0]!).queryByTestId('campaign-progress')).toBeNull()

    expect(screen.getByTestId('open-stopped')).toHaveTextContent('Stopped (7)')
    expect(screen.getByRole('link', { name: 'Add a campaign' })).toBeInTheDocument()
    expectNoSendControl()
  })

  it.each([
    ['waiting', 'live', 'Sender online · batch 3 waiting on the laptop'],
    ['outside_hours', 'live', 'Sender online · waiting for 10:00 am in India'],
    ['halted', 'trouble', 'Sender halted · WhatsApp logged it out · restart it on the laptop'],
    ['not_linked', 'quiet', 'Sender not linked · link it on the laptop'],
  ] as const)('says where the sender is when it is %s', async (scene, tone, words) => {
    open('campaigns', { scene })
    const line = await screen.findByTestId('sender-line')
    expect(line).toHaveTextContent(words)
    expect(line).toHaveAttribute('data-tone', tone)
  })

  it('does not call a campaign sending while the laptop has been closed since yesterday', async () => {
    open('campaigns', { scene: 'offline' })
    const line = await screen.findByTestId('sender-line')
    expect(line).toHaveTextContent(/^Sender offline since yesterday, 09:00 pm · it carries on/)
    const states = screen.getAllByTestId('campaign-state').map((chip) => chip.textContent)
    expect(states).toEqual(['draft', 'waiting', 'done'])
  })

  it('shows a sender that is not linked no code of any kind', async () => {
    open('campaigns', { scene: 'not_linked' })
    const line = await screen.findByTestId('sender-line')
    expect(line.textContent).not.toMatch(/[0-9]/)
    expect(screen.queryByRole('img')).toBeNull()
    expect(document.querySelector('canvas, svg[data-qr]')).toBeNull()
  })

  it('is not a page for a manager, a biller or an employee', async () => {
    for (const role of ['franchise_admin', 'biller', 'employee'] as const) {
      const view = open('campaigns', { role })
      expect(await screen.findByText(/not available|not found|does not exist/i)).toBeInTheDocument()
      expect(screen.queryByTestId('campaign-list')).toBeNull()
      await expect(view.adapters.campaigns.overview()).rejects.toMatchObject({
        code: 'not_permitted',
      })
      document.body.innerHTML = ''
    }
  })
})

describe('a campaign’s own page', () => {
  it('shows tiles, a row per batch, the message and who it went to', async () => {
    open(`campaigns/${DEMO_CAMPAIGN_SENDING_ID}`)
    expect(screen.getByTestId('campaign-loading')).toBeInTheDocument()
    await screen.findByTestId('batch-list')
    expect(screen.getByRole('heading', { name: 'Diwali offer' })).toBeInTheDocument()

    expect(screen.getByTestId('tile-sent')).toHaveTextContent('Sent245')
    expect(screen.getByTestId('tile-to-go')).toHaveTextContent('To go753')
    expect(screen.getByTestId('tile-stopped')).toHaveTextContent('Stopped0')
    // The two receipt figures say what kind of figure each is.
    expect(screen.getByTestId('tile-delivered')).toHaveTextContent('Delivered so far')
    expect(screen.getByTestId('tile-read')).toHaveTextContent('Read, at least')

    expect(screen.getByTestId('batch-1')).toHaveTextContent(/Batch 1done.*delivered · .*read/)
    expect(screen.getByTestId('batch-3')).toHaveTextContent('Batch 3sending47 of 100')
    expect(screen.getByTestId('batch-4')).toHaveTextContent('Batch 4waiting')
    // Ten batches: the last five say the same thing once.
    expect(screen.getByTestId('batches-rest')).toHaveTextContent('Batches 6 to 10waiting')

    const bubble = screen.getByTestId('message-bubble')
    // The preview greets whoever is signed in: here, the demo's owner.
    expect(bubble).toHaveTextContent('Happy Diwali, Demo!')
    expect(bubble).not.toHaveTextContent(/STOP/)
    expect(within(bubble).getByText('20% off every order')).toHaveClass('font-bold')
    expect(screen.getByTestId('campaign-audience')).toHaveTextContent('1,000 customers')
    expectNoSendControl()
  })

  it('points the next batch at the laptop when none is out, with nothing to press', async () => {
    open(`campaigns/${DEMO_CAMPAIGN_SENDING_ID}`, { scene: 'waiting' })
    await screen.findByTestId('batch-list')
    expect(screen.getByTestId('batch-3')).toHaveTextContent('Batch 3waitingsend from the laptop')
    expect(within(screen.getByTestId('batch-3')).queryByRole('button')).toBeNull()
    expect(screen.getByTestId('batch-4')).toHaveTextContent(/^Batch 4waiting$/)
    expectNoSendControl()
  })

  it('pauses and resumes from the header', async () => {
    const user = userEvent.setup()
    open(`campaigns/${DEMO_CAMPAIGN_SENDING_ID}`)
    await user.click(await screen.findByRole('button', { name: 'Pause' }))
    expect(await screen.findByRole('button', { name: 'Resume' })).toBeInTheDocument()
    expect(screen.getByTestId('campaign-state')).toHaveTextContent('paused')
    expect(screen.getByTestId('batch-3')).toHaveTextContent('Batch 3paused47 of 100')
    expect(screen.getByTestId('campaign-toast')).toHaveTextContent('Paused')

    await user.click(screen.getByRole('button', { name: 'Resume' }))
    expect(await screen.findByRole('button', { name: 'Pause' })).toBeInTheDocument()
    expect(screen.getByTestId('campaign-state')).toHaveTextContent('sending')
  })

  it('stops only after saying what stopping does, and then offers nothing more', async () => {
    const user = userEvent.setup()
    open(`campaigns/${DEMO_CAMPAIGN_SENDING_ID}`)
    await user.click(await screen.findByTestId('stop-campaign'))
    const dialog = screen.getByRole('dialog', { name: 'Stop Diwali offer?' })
    expect(dialog).toHaveTextContent('753 customers still waiting are sent nothing')
    expect(dialog).toHaveTextContent('cannot be resumed')
    await user.click(within(dialog).getByRole('button', { name: 'Stop' }))

    await waitFor(() => expect(screen.getByTestId('campaign-state')).toHaveTextContent('stopped'))
    expect(screen.getByTestId('tile-to-go')).toHaveTextContent('Not sent753')
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull()
    expect(screen.queryByTestId('stop-campaign')).toBeNull()
    expect(screen.queryByTestId('sender-line')).toBeNull()
  })

  it('reads a finished campaign as done, with its totals and nothing to press', async () => {
    open(`campaigns/${DEMO_CAMPAIGN_DONE_ID}`)
    await screen.findByTestId('batch-list')
    expect(screen.getByTestId('campaign-state')).toHaveTextContent('done')
    expect(screen.getByTestId('tile-sent')).toHaveTextContent('414')
    expect(screen.getByTestId('tile-to-go')).toHaveTextContent('Not sent0')
    expect(screen.getByTestId('tile-unsure')).toHaveTextContent(/^Unsure.*1$/)
    expect(screen.getAllByTestId(/^batch-[0-9]+$/)).toHaveLength(5)
    expect(screen.queryByRole('button', { name: /pause|resume|stop/i })).toBeNull()
  })

  it('explains read and unsure where the figure is, one tap away', async () => {
    const user = userEvent.setup()
    open(`campaigns/${DEMO_CAMPAIGN_DONE_ID}`)
    await screen.findByTestId('batch-list')
    await user.click(within(screen.getByTestId('tile-read')).getByRole('button'))
    expect(screen.getByRole('dialog')).toHaveTextContent('read receipts on')
    await user.click(screen.getByTestId('explain-close'))
    await user.click(within(screen.getByTestId('tile-unsure')).getByRole('button'))
    expect(screen.getByRole('dialog')).toHaveTextContent('nobody gets it twice')
  })

  it('says so when there is no campaign at that address', async () => {
    open('campaigns/not-a-campaign')
    expect(await screen.findByText(/There is no campaign here/)).toBeInTheDocument()
  })
})

describe('writing a campaign', () => {
  it('draws the message as it is typed: the name and the formatting, nothing added', async () => {
    const user = userEvent.setup()
    open('campaigns/new')
    const bubble = screen.getByTestId('message-bubble')
    expect(bubble).toHaveTextContent('Your message')

    await user.type(screen.getByTestId('campaign-body'), 'Hi {{name}, *big* news')
    expect(bubble).toHaveTextContent('Hi Demo, big news')
    expect(bubble).not.toHaveTextContent(/STOP/)
    expect(screen.getByTestId('preview-named')).toHaveTextContent('Demo')
    expect(within(bubble).getByText('big')).toHaveClass('font-bold')

    // A customer who never gave a name gets the greeting without one.
    await user.click(screen.getByTestId('preview-unnamed'))
    expect(bubble).toHaveTextContent('Hi, big news')
  })

  it('counts down the room left, and refuses a message that is too long', async () => {
    const user = userEvent.setup()
    open('campaigns/new')
    await user.type(screen.getByTestId('campaign-name'), 'Long one')
    const body = screen.getByTestId('campaign-body')
    await user.click(body)
    await user.paste('x'.repeat(1100))
    expect(screen.getByTestId('campaign-body-room')).toHaveTextContent(/too long$/)
    await user.click(screen.getByTestId('submit-campaign'))
    expect(await screen.findByRole('alert')).toHaveTextContent(/too long\. Shorten it\./)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('asks for a name, a message and customers before it will submit', async () => {
    const user = userEvent.setup()
    open('campaigns/new')
    const submit = screen.getByTestId('submit-campaign')

    await user.click(submit)
    expect(screen.getByRole('alert')).toHaveTextContent('Give the campaign a name')
    await user.type(screen.getByTestId('campaign-name'), 'Monsoon')
    await user.click(submit)
    expect(screen.getByRole('alert')).toHaveTextContent('Write the message first')
    await user.type(screen.getByTestId('campaign-body'), 'Rain offer')
    await user.click(submit)
    // No audience is suggested: Send to stays empty until somebody chooses.
    expect(screen.getByRole('alert')).toHaveTextContent('Choose the customers it goes to')
    expect(screen.getByTestId('choose-audience')).toHaveTextContent('Choose customers')
    // And there is no time to choose: a campaign is submitted, not scheduled.
    expect(screen.queryByText(/as soon as possible|not before/i)).toBeNull()
    expect(document.querySelector('input[type="datetime-local"]')).toBeNull()
    expect(screen.getByTestId('submit-means')).toHaveTextContent(
      'Sent later from the laptop, a batch at a time.',
    )
  })

  it('opens on the customers themselves, nobody ticked, with search and filters above', async () => {
    const user = userEvent.setup()
    open(`campaigns/${DEMO_CAMPAIGN_DRAFT_ID}`)
    await user.click(await screen.findByTestId('choose-audience'))
    const sheet = screen.getByRole('dialog', { name: 'Choose customers' })
    const count = within(sheet).getByTestId('audience-sheet-count')

    // The customers are on the sheet as it opens, in the order they would be
    // sent to, with nothing pressed to see them, and nobody picked for them.
    const people = await within(sheet).findByTestId('audience-people')
    const rows = within(people).getAllByRole('listitem')
    expect(rows).toHaveLength(6)
    expect(rows[0]).toHaveTextContent('Moumta Ghosh')
    expect(rows[0]).toHaveTextContent('0104')
    expect(
      within(people)
        .getAllByRole('checkbox')
        .every((box) => !(box as HTMLInputElement).checked),
    ).toBe(true)
    await waitFor(() => expect(count).toHaveTextContent('0 selected'))
    expect(within(sheet).getByTestId('audience-done')).toBeDisabled()
    // A name and four digits: there is no number on the page to read.
    expect(people.textContent).not.toMatch(/9000000|\+91/)

    // On the sheet: the search, one Filter button, the outlet as chips and the
    // order. Every other filter is behind the button.
    expect(within(sheet).getAllByRole('combobox')).toEqual([
      within(sheet).getByLabelText('Sort by'),
    ])
    expect(within(sheet).getByRole('button', { name: 'Filter' })).toBeInTheDocument()
    expect(within(sheet).queryByTestId('audience-filter-summary')).toBeNull()
    const outlets = within(sheet).getByRole('group', { name: 'Outlet' })
    expect(within(outlets).getByRole('button', { name: 'Shawarmania Kalyani' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(
      within(outlets).getByRole('button', { name: 'Shawarmania Kanchrapara' }),
    ).toHaveAttribute('aria-pressed', 'false')

    // The order is the list's order.
    await user.selectOptions(within(sheet).getByLabelText('Sort by'), 'longest_away')
    await waitFor(() =>
      expect(
        within(within(sheet).getByTestId('audience-people')).getAllByRole('listitem')[0],
      ).not.toHaveTextContent('Moumta Ghosh'),
    )
    await user.selectOptions(within(sheet).getByLabelText('Sort by'), 'most_orders')

    // Gold or not, from the Filter; what is in force is said under the search.
    await filterBy(user, sheet, 'Members', 'Gold')
    expect(within(sheet).getByTestId('audience-filter-summary')).toHaveTextContent('Gold')
    expect(within(sheet).getByRole('button', { name: 'Filter: Gold' })).toBeInTheDocument()
    await waitFor(() =>
      expect(within(sheet).getByTestId('audience-select-all').parentElement).toHaveTextContent(
        'Select all 2',
      ),
    )
    const gold = within(within(sheet).getByTestId('audience-people')).getAllByRole('listitem')
    expect(gold.map((row) => row.textContent)).toEqual([
      expect.stringContaining('Ritika Sen'),
      expect.stringContaining('Arjun Das'),
    ])
    // Clear puts every filter back.
    await user.click(within(sheet).getByTestId('audience-filter-clear'))
    expect(within(sheet).queryByTestId('audience-filter-summary')).toBeNull()
    await waitFor(() =>
      expect(within(sheet).getByTestId('audience-select-all').parentElement).toHaveTextContent(
        'Select all 6',
      ),
    )

    // Another outlet is another outlet's customers.
    // Arjun has only ever bought at Kalyani.
    await user.click(within(outlets).getByRole('button', { name: 'Shawarmania Kanchrapara' }))
    await waitFor(() =>
      expect(within(sheet).getByTestId('audience-people')).not.toHaveTextContent('Arjun Das'),
    )
  })

  it('narrows to who ordered between two dates, and who has not been back since', async () => {
    const user = userEvent.setup()
    open(`campaigns/${DEMO_CAMPAIGN_DRAFT_ID}`)
    await user.click(await screen.findByTestId('choose-audience'))
    const sheet = screen.getByRole('dialog', { name: 'Choose customers' })
    await within(sheet).findByTestId('audience-people')

    await user.click(within(sheet).getByTestId('audience-filter'))
    const filters = screen.getByRole('dialog', { name: 'Filter customers' })
    const lastOrdered = within(filters).getByRole('region', { name: 'Last ordered' })
    expect(within(filters).queryByTestId('audience-stretch')).toBeNull()
    await user.click(within(lastOrdered).getByRole('radio', { name: 'Between dates' }))

    // Two calendars, the second never before the first, and nothing after today.
    const from = within(filters).getByTestId('audience-stretch-from') as HTMLInputElement
    const to = within(filters).getByTestId('audience-stretch-to') as HTMLInputElement
    expect(from.type).toBe('date')
    expect(from.value <= to.value).toBe(true)
    fireEvent.change(from, { target: { value: '2000-01-01' } })
    fireEvent.change(to, { target: { value: '2000-01-05' } })
    expect([from.value, to.value]).toEqual(['2000-01-01', '2000-01-05'])
    // A first date moved past the second brings the second along, and back.
    fireEvent.change(from, { target: { value: '2000-02-01' } })
    expect([from.value, to.value]).toEqual(['2000-02-01', '2000-02-01'])
    fireEvent.change(to, { target: { value: '2000-01-05' } })
    expect([from.value, to.value]).toEqual(['2000-01-05', '2000-01-05'])

    // A stretch long ago with nobody in it, and then all time, not back since.
    await waitFor(() =>
      expect(within(sheet).getByTestId('audience-select-all').parentElement).toHaveTextContent(
        'Select all 0',
      ),
    )
    fireEvent.change(from, { target: { value: '2000-01-01' } })
    fireEvent.change(to, { target: { value: to.max } })
    const since = within(filters).getByTestId('audience-not-since')
    expect(since).toHaveAttribute('aria-checked', 'false')
    await user.click(since)
    expect(since).toHaveAttribute('aria-checked', 'true')
    await user.click(within(filters).getByTestId('audience-filter-done'))

    // Nobody has ordered after today, so all time, not back since, is everybody.
    expect(within(sheet).getByTestId('audience-filter-summary')).toHaveTextContent(
      /^Ordered 01 Jan 2000 to .+, not back since$/,
    )
    await waitFor(() =>
      expect(within(sheet).getByTestId('audience-select-all').parentElement).toHaveTextContent(
        'Select all 6',
      ),
    )
  })

  it('ticks customers one by one, found by search, and keeps them through a filter', async () => {
    const user = userEvent.setup()
    open(`campaigns/${DEMO_CAMPAIGN_DRAFT_ID}`)
    await user.click(await screen.findByTestId('choose-audience'))
    const sheet = screen.getByRole('dialog', { name: 'Choose customers' })
    await within(sheet).findByTestId('audience-people')

    await user.type(within(sheet).getByTestId('audience-search'), 'rit')
    await waitFor(() =>
      expect(
        within(within(sheet).getByTestId('audience-people')).getAllByRole('listitem'),
      ).toHaveLength(1),
    )
    await user.click(within(sheet).getByRole('checkbox', { name: 'Pick Ritika Sen' }))
    await user.clear(within(sheet).getByTestId('audience-search'))
    await user.type(within(sheet).getByTestId('audience-search'), '0103')
    await waitFor(() =>
      expect(within(sheet).getByTestId('audience-people')).toHaveTextContent('Arjun Das'),
    )
    await user.click(within(sheet).getByRole('checkbox', { name: 'Pick Arjun Das' }))
    expect(within(sheet).getByTestId('audience-sheet-count')).toHaveTextContent('2 selected')

    // Too short to search: everybody shows, with a word on how much to type.
    await user.clear(within(sheet).getByTestId('audience-search'))
    await user.type(within(sheet).getByTestId('audience-search'), 'r')
    expect(within(sheet).getByText('Keep typing: at least three letters or digits.')).toBeVisible()
    await user.clear(within(sheet).getByTestId('audience-search'))

    // A filter that hides them does not untick them.
    await filterBy(user, sheet, 'Members', 'Not gold')
    await waitFor(() =>
      expect(within(sheet).getByTestId('audience-people')).not.toHaveTextContent('Ritika Sen'),
    )
    expect(within(sheet).getByTestId('audience-sheet-count')).toHaveTextContent('2 selected')
    // Select all is part-ticked, as some are picked.
    expect(
      (within(sheet).getByTestId('audience-select-all') as HTMLInputElement).indeterminate,
    ).toBe(true)

    await user.click(within(sheet).getByTestId('audience-done'))
    await waitFor(() =>
      expect(screen.getByTestId('audience-count')).toHaveTextContent('2 customers'),
    )
    expect(screen.getByTestId('choose-audience')).toHaveTextContent('picked one by one')
  })

  it('selects all the filters match, leaves one out, and picks nobody on a second press', async () => {
    const user = userEvent.setup()
    open(`campaigns/${DEMO_CAMPAIGN_DRAFT_ID}`)
    await user.click(await screen.findByTestId('choose-audience'))
    const sheet = screen.getByRole('dialog', { name: 'Choose customers' })
    const count = within(sheet).getByTestId('audience-sheet-count')
    await within(sheet).findByTestId('audience-people')
    const all = within(sheet).getByTestId('audience-select-all') as HTMLInputElement

    await waitFor(() => expect(all.parentElement).toHaveTextContent('Select all 6'))
    await user.click(all)
    await waitFor(() => expect(count).toHaveTextContent('6 selected'))
    expect(all.checked).toBe(true)

    await user.click(within(sheet).getByRole('checkbox', { name: 'Pick Imran Sheikh' }))
    await waitFor(() => expect(count).toHaveTextContent('5 selected'))
    expect(all.indeterminate).toBe(true)

    // Narrowing keeps picking whoever matches.
    await filterBy(user, sheet, 'Orders', '5 or more')
    await waitFor(() => expect(count).toHaveTextContent(/^[0-5] selected$/))
    await filterBy(user, sheet, 'Orders', 'Any number')
    await waitFor(() => expect(count).toHaveTextContent('5 selected'))

    await user.click(within(sheet).getByTestId('audience-done'))
    await waitFor(() =>
      expect(screen.getByTestId('audience-count')).toHaveTextContent('5 customers'),
    )
    expect(screen.getByTestId('choose-audience')).toHaveTextContent('1 left out')

    // Back in: the ticks are as they were, and Select all twice picks nobody.
    await user.click(screen.getByTestId('choose-audience'))
    const again = screen.getByRole('dialog', { name: 'Choose customers' })
    const box = within(again).getByTestId('audience-select-all') as HTMLInputElement
    await waitFor(() =>
      expect(within(again).getByTestId('audience-sheet-count')).toHaveTextContent('5 selected'),
    )
    await user.click(box)
    await waitFor(() =>
      expect(within(again).getByTestId('audience-sheet-count')).toHaveTextContent('6 selected'),
    )
    await user.click(box)
    expect(within(again).getByTestId('audience-sheet-count')).toHaveTextContent('0 selected')
    expect(within(again).getByTestId('audience-done')).toBeDisabled()
  })

  it('keeps a figure no preset names, and says it is in force', async () => {
    const user = userEvent.setup()
    open(`campaigns/${DEMO_CAMPAIGN_DRAFT_ID}`, {
      draftAudience: {
        ...everybodyAt(OUTLET_KALYANI_ID),
        ordered: { kind: 'within', days: 45 },
        orders: { kind: 'at_most', count: 3 },
      },
    })
    await user.click(await screen.findByTestId('choose-audience'))
    const sheet = screen.getByRole('dialog', { name: 'Choose customers' })
    expect(await within(sheet).findByTestId('audience-filter-summary')).toHaveTextContent(
      'Last 45 days · 3 or fewer orders',
    )
    await user.click(within(sheet).getByTestId('audience-filter'))
    const filters = screen.getByRole('dialog', { name: 'Filter customers' })
    expect(within(filters).getByRole('radio', { name: 'Last 45 days' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(within(filters).getByRole('radio', { name: '3 or fewer' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })

  it('submits after saying what happens next, and then every batch waits', async () => {
    const user = userEvent.setup()
    const { data } = open(`campaigns/${DEMO_CAMPAIGN_DRAFT_ID}`)
    await user.click(await screen.findByTestId('choose-audience'))
    await screen.findByTestId('audience-people')
    await user.click(screen.getByTestId('audience-select-all'))
    await waitFor(() =>
      expect(screen.getByTestId('audience-sheet-count')).toHaveTextContent('6 selected'),
    )
    await user.click(screen.getByTestId('audience-done'))

    await user.click(screen.getByTestId('submit-campaign'))
    const dialog = await screen.findByRole('dialog', { name: 'Submit New menu?' })
    expect(dialog).toHaveTextContent('6 customers in 1 batch')
    expect(dialog).toHaveTextContent('Nothing goes out yet: each batch is sent from the laptop')
    expect(dialog).toHaveTextContent('between 10:00 am and 9:00 pm in India')
    await user.click(within(dialog).getByRole('button', { name: 'Submit' }))

    await screen.findByTestId('batch-list')
    expect(screen.getByTestId('campaign-toast')).toHaveTextContent('Submitted')
    expect(screen.getByTestId('campaign-state')).toHaveTextContent('submitted')
    expect(screen.getByTestId('tile-sent')).toHaveTextContent('Sent0')
    expect(screen.getByTestId('tile-to-go')).toHaveTextContent('To go6')
    // Another campaign's batch is out, so this one waits its turn.
    expect(screen.getByTestId('campaign-behind')).toHaveTextContent('after Diwali offer')
    expect(screen.getByTestId('sender-line')).toHaveTextContent(
      'Sender online · Diwali offer goes first',
    )
    expect(screen.getByTestId('batch-1')).toHaveTextContent(/^Batch 1waiting$/)
    // Nothing left the page: every recipient row is still waiting.
    const cut = data.campaigns.recipients.filter(
      (row) => row.campaign_id === DEMO_CAMPAIGN_DRAFT_ID,
    )
    expect(cut).toHaveLength(6)
    expect(cut.every((row) => row.state === 'waiting' && row.sent_at === null)).toBe(true)
    expectNoSendControl()
  })

  it('has Save and Submit side by side at the bottom, and Save in the header no more', async () => {
    open('campaigns/new')
    const save = await screen.findByTestId('save-campaign')
    const submit = screen.getByTestId('submit-campaign')
    expect(save.parentElement).toBe(submit.parentElement)
    expect(screen.getByRole('banner')).not.toContainElement(save)
  })

  it('asks before leaving with unsaved typing, and stays when told to', async () => {
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { router } = open('campaigns/new')
    await user.type(await screen.findByTestId('campaign-name'), 'Monsoon')

    await user.click(screen.getByRole('button', { name: /back/i }))
    expect(confirm).toHaveBeenCalledWith(LEAVE_UNSAVED)
    expect(router.state.location.pathname).toBe('/demo/owner/campaigns/new')
    expect(screen.getByTestId('campaign-name')).toHaveValue('Monsoon')

    confirm.mockReturnValue(true)
    await user.click(screen.getByRole('button', { name: /back/i }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/demo/owner/campaigns'))
    confirm.mockRestore()
  })

  it('leaves without asking once everything is saved', async () => {
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    // Arrived from the list, as the owner does: back is then the phone's back.
    const { router } = open('campaigns')
    await screen.findByRole('heading', { name: 'Campaigns' })
    await router.navigate('/demo/owner/campaigns/new')
    await user.type(await screen.findByTestId('campaign-name'), 'Monsoon')
    await user.click(screen.getByTestId('save-campaign'))
    expect(await screen.findByRole('heading', { name: 'Monsoon' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /back/i }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/demo/owner/campaigns'))
    expect(confirm).not.toHaveBeenCalled()
    confirm.mockRestore()
  })

  it('has the browser ask before a refresh or a closed tab, only while something is unsaved', async () => {
    const user = userEvent.setup()
    open('campaigns/new')
    const asked = () => {
      const event = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(event)
      return event.defaultPrevented
    }
    await screen.findByTestId('campaign-name')
    expect(asked()).toBe(false)
    await user.type(screen.getByTestId('campaign-name'), 'Monsoon')
    expect(asked()).toBe(true)
    await user.click(screen.getByTestId('save-campaign'))
    await screen.findByRole('heading', { name: 'Monsoon' })
    expect(asked()).toBe(false)
  })

  it('saves a new campaign once, and keeps what is typed when it gets its address', async () => {
    const user = userEvent.setup()
    const { adapters } = open('campaigns/new')
    await user.type(screen.getByTestId('campaign-name'), 'Monsoon')
    await user.type(screen.getByTestId('campaign-body'), 'Rain offer')
    await user.click(screen.getByTestId('save-campaign'))

    expect(await screen.findByRole('heading', { name: 'Monsoon' })).toBeInTheDocument()
    expect(screen.getByTestId('campaign-body')).toHaveValue('Rain offer')
    await user.type(screen.getByTestId('campaign-body'), ' today')
    await user.click(screen.getByTestId('save-campaign'))
    await waitFor(async () => {
      const { campaigns } = await adapters.campaigns.overview()
      const saved = campaigns.filter((campaign) => campaign.name === 'Monsoon')
      expect(saved).toHaveLength(1)
      const detail = await adapters.campaigns.campaign(saved[0]!.id)
      expect(detail?.campaign.body).toBe('Rain offer today')
    })
  })
})

describe('test numbers', () => {
  it('adds numbers typed or used before, removes one, and keeps them on the draft', async () => {
    const user = userEvent.setup()
    const { adapters } = open(`campaigns/${DEMO_CAMPAIGN_DRAFT_ID}`)
    const part = await screen.findByTestId('test-numbers')

    // Used before: the invented numbers the demo's earlier campaigns were tried on.
    const used = await within(part).findByTestId('test-number-suggestions')
    expect(
      within(used)
        .getAllByRole('button')
        .map((chip) => chip.textContent),
    ).toEqual(['+91 90000 00901', '+91 90000 00902', '+1 202 555 0142'])
    await user.click(within(used).getByRole('button', { name: 'Add +1 202 555 0142' }))
    await waitFor(() => expect(within(part).getByTestId('test-number-+12025550142')).toBeVisible())
    // An added number is no longer offered.
    expect(within(used).queryByRole('button', { name: 'Add +1 202 555 0142' })).toBeNull()

    // Typed: a ten-digit mobile, and Enter adds it rather than submitting.
    await user.type(within(part).getByTestId('test-number-input'), '90000 00903{Enter}')
    await waitFor(() => expect(within(part).getByTestId('test-number-+919000000903')).toBeVisible())
    expect(screen.queryByRole('dialog')).toBeNull()

    // A number that would have to be guessed is refused, and says why.
    await user.type(within(part).getByTestId('test-number-input'), '2025550142')
    await user.click(within(part).getByTestId('test-number-add'))
    expect(within(part).getByRole('alert')).toHaveTextContent('country code')
    // Typing again takes the refusal away.
    await user.type(within(part).getByTestId('test-number-input'), '{Backspace}')
    expect(within(part).queryByRole('alert')).toBeNull()
    await user.clear(within(part).getByTestId('test-number-input'))

    await user.click(within(part).getByRole('button', { name: 'Remove +1 202 555 0142' }))
    await waitFor(() => expect(within(part).queryByTestId('test-number-+12025550142')).toBeNull())

    const { campaign } = (await adapters.campaigns.campaign(DEMO_CAMPAIGN_DRAFT_ID))!
    expect(campaign.testPhones).toEqual(['+919000000903'])
  })

  it('stops offering to add at five', async () => {
    const user = userEvent.setup()
    open(`campaigns/${DEMO_CAMPAIGN_DRAFT_ID}`)
    const part = await screen.findByTestId('test-numbers')
    for (const n of ['01', '02', '03', '04', '05']) {
      await user.type(
        within(part).getByTestId('test-number-input'),
        `+91900000090${n.slice(1)}{Enter}`,
      )
      await waitFor(() =>
        expect(within(part).getByTestId(`test-number-+91900000090${n.slice(1)}`)).toBeVisible(),
      )
    }
    expect(within(part).queryByTestId('test-number-input')).toBeNull()
    expect(within(part).queryByTestId('test-number-suggestions')).toBeNull()
  })

  it('sends a test with no press on the laptop, says so, and waits for it', async () => {
    const user = userEvent.setup()
    const { data } = open(`campaigns/${DEMO_CAMPAIGN_DRAFT_ID}`)
    const part = await screen.findByTestId('test-numbers')
    // Nothing to send to yet.
    expect(within(part).getByTestId('send-test')).toBeDisabled()
    await user.click(
      within(await within(part).findByTestId('test-number-suggestions')).getByRole('button', {
        name: 'Add +91 90000 00901',
      }),
    )
    await waitFor(() => expect(within(part).getByTestId('send-test')).toBeEnabled())
    await user.click(within(part).getByTestId('send-test'))

    await waitFor(() =>
      expect(screen.getByTestId('campaign-toast')).toHaveTextContent(
        'Test for 1 number. It goes out when the laptop is on.',
      ),
    )
    expect(within(part).getByTestId('test-waiting')).toHaveTextContent(
      'A test is waiting for the laptop.',
    )
    expect(within(part).getByTestId('send-test')).toBeDisabled()
    // Queued for the laptop, and sent by nothing here.
    const queued = data.campaigns.tests.filter(
      (test) => test.campaign_id === DEMO_CAMPAIGN_DRAFT_ID,
    )
    expect(queued.map((test) => [test.phone, test.state])).toEqual([['+919000000901', 'waiting']])
  })

  it('tells Submit that the test numbers get it first', async () => {
    const user = userEvent.setup()
    open(`campaigns/${DEMO_CAMPAIGN_DRAFT_ID}`)
    const part = await screen.findByTestId('test-numbers')
    await user.click(
      within(await within(part).findByTestId('test-number-suggestions')).getByRole('button', {
        name: 'Add +91 90000 00901',
      }),
    )
    await waitFor(() => expect(within(part).getByTestId('test-number-+919000000901')).toBeVisible())
    await user.click(screen.getByTestId('choose-audience'))
    await screen.findByTestId('audience-people')
    await user.click(screen.getByTestId('audience-select-all'))
    await waitFor(() =>
      expect(screen.getByTestId('audience-sheet-count')).toHaveTextContent('6 selected'),
    )
    await user.click(screen.getByTestId('audience-done'))
    await user.click(screen.getByTestId('submit-campaign'))
    const dialog = await screen.findByRole('dialog', { name: 'Submit New menu?' })
    expect(dialog).toHaveTextContent(
      /^Submit New menu\?The test numbers get it first\. 6 customers/,
    )
    await user.click(within(dialog).getByRole('button', { name: 'Submit' }))

    // The submitted page lists the test, waiting for the laptop.
    const tests = await screen.findByTestId('test-list')
    expect(tests).toHaveTextContent('+91 90000 00901waiting for the laptop')
  })

  it('sends a test from a submitted campaign, and no customer anything', async () => {
    const user = userEvent.setup()
    const { data } = open(`campaigns/${DEMO_CAMPAIGN_SENDING_ID}`, { scene: 'waiting' })
    const part = await screen.findByTestId('test-numbers')
    const sentBefore = data.campaigns.recipients.filter((row) => row.state === 'sent').length
    await user.type(within(part).getByTestId('test-number-input'), '90000 00909{Enter}')
    await waitFor(() => expect(within(part).getByTestId('test-number-+919000000909')).toBeVisible())
    await user.click(within(part).getByTestId('send-test'))

    await waitFor(() =>
      expect(screen.getByTestId('campaign-toast')).toHaveTextContent(
        /^Test for \d numbers?\. It goes out when the laptop is on\.$/,
      ),
    )
    expect(within(part).getByTestId('send-test')).toBeDisabled()
    const queued = data.campaigns.tests.filter(
      (test) => test.campaign_id === DEMO_CAMPAIGN_SENDING_ID && test.state === 'waiting',
    )
    expect(queued.map((test) => test.phone)).toContain('+919000000909')
    // The batch still waits for the laptop, and no customer was sent anything.
    expect(screen.getByTestId('batch-3')).toHaveTextContent('send from the laptop')
    expect(data.campaigns.recipients.filter((row) => row.state === 'sent')).toHaveLength(sentBefore)
  })

  it('offers no test once a campaign is finished', async () => {
    open(`campaigns/${DEMO_CAMPAIGN_DONE_ID}`)
    await screen.findByTestId('batch-list')
    expect(screen.queryByTestId('test-numbers')).toBeNull()
    expect(screen.queryByTestId('send-test')).toBeNull()
  })

  it('lists a submitted campaign’s tests by number and state, outside its figures', async () => {
    open(`campaigns/${DEMO_CAMPAIGN_SENDING_ID}`)
    const tests = await screen.findByTestId('test-list')
    const rows = within(tests).getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveTextContent(/^\+91 90000 00901sent /)
    expect(tests).toHaveTextContent('+91 90000 00902not on WhatsApp')
    // The figures are customers alone.
    expect(screen.getByTestId('tile-sent')).toHaveTextContent('Sent245')
  })
})

describe('the stopped list', () => {
  it('lists who said stop, how, and never their number', async () => {
    open('campaigns/stopped')
    expect(screen.getByTestId('stopped-loading')).toBeInTheDocument()
    const list = await screen.findByTestId('stopped-list')
    const rows = within(list).getAllByRole('listitem')
    expect(rows).toHaveLength(7)
    expect(list).not.toHaveTextContent('replied STOP')
    expect(list).toHaveTextContent('added by Demo Owner')
    expect(list).toHaveTextContent('Sourav Pal')
    expect(list.textContent).not.toMatch(/9000000|\+91/)
  })

  it('adds a customer by their whole number, and refuses one nobody ordered with', async () => {
    const user = userEvent.setup()
    open('campaigns/stopped')
    await screen.findByTestId('stopped-list')
    await user.click(screen.getByRole('button', { name: 'Add a number' }))
    const sheet = screen.getByRole('dialog', { name: 'Add a number' })
    expect(sheet).toHaveTextContent('Campaigns only. Their receipts and points carry on.')

    await user.type(within(sheet).getByTestId('stopped-phone'), '9812345678')
    await user.click(within(sheet).getByTestId('save-stopped'))
    expect(await within(sheet).findByTestId('form-sheet-error')).toHaveTextContent(
      'Nobody with that number has ordered',
    )

    await user.clear(within(sheet).getByTestId('stopped-phone'))
    await user.type(within(sheet).getByTestId('stopped-phone'), '9000000104')
    await user.click(within(sheet).getByTestId('save-stopped'))
    await waitFor(() =>
      expect(screen.getByTestId('stopped-list')).toHaveTextContent('Moumta Ghosh'),
    )
    expect(within(screen.getByTestId('stopped-list')).getAllByRole('listitem')).toHaveLength(8)
    expect(screen.getByTestId('stopped-toast')).toHaveTextContent('Added')
  })

  it('removes a customer only after saying what that means', async () => {
    const user = userEvent.setup()
    open('campaigns/stopped')
    await screen.findByTestId('stopped-list')
    await user.click(screen.getByRole('button', { name: 'Remove Sourav Pal' }))
    const dialog = screen.getByRole('dialog', { name: 'Remove Sourav Pal?' })
    expect(dialog).toHaveTextContent('They can be sent campaigns again')
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }))
    await waitFor(() =>
      expect(screen.getByTestId('stopped-list')).not.toHaveTextContent('Sourav Pal'),
    )
    expect(within(screen.getByTestId('stopped-list')).getAllByRole('listitem')).toHaveLength(6)
  })
})
