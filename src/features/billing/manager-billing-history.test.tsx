import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'

import { AdaptersContext } from '@/data-access/adapters-context'
import { createMockAdapters } from '@/data-access/mock'
import { personaFixtures } from '@/data-access/mock/fixtures/personas'
import { formatPaise } from '@/domain'
import { SessionContext } from '@/session/context'
import { deriveSessionScope, type Session } from '@/session/session'

import { averageBillPaise } from './day-totals'
import { ManagerBillingHistory } from './manager-billing-history'

function managerSession(): Session {
  const persona = personaFixtures.franchise_admin
  return {
    mode: 'demo',
    userId: persona.profile.id,
    assignments: persona.assignments,
    ...deriveSessionScope(persona.assignments),
    displayName: persona.profile.full_name,
    persona,
  }
}

function renderHistory(adapters = createMockAdapters('franchise_admin')) {
  return {
    adapters,
    ...render(
      <MemoryRouter>
        <SessionContext.Provider value={managerSession()}>
          <AdaptersContext.Provider value={adapters}>
            <ManagerBillingHistory />
          </AdaptersContext.Provider>
        </SessionContext.Provider>
      </MemoryRouter>,
    ),
  }
}

describe('manager billing history asks two questions', () => {
  it('offers a day bar with a step either side, and no status or payment picker', async () => {
    renderHistory()

    await screen.findByTestId('manager-bill-list')

    // The day, in the bar the ledger uses: the label opens the calendar and the
    // steps either side reach the days around it.
    expect(screen.getByTestId('billing-history-day-open')).toHaveTextContent('Today')
    expect(screen.getByRole('button', { name: 'Previous day' })).toBeEnabled()
    // Today is the outlet's own today, so there is no tomorrow to step into.
    expect(screen.getByRole('button', { name: 'Next day' })).toBeDisabled()

    // The two pickers that narrowed one outlet's one day are gone, and with
    // them the grid of four that held them.
    expect(screen.queryByLabelText('Bill status')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Payment method')).not.toBeInTheDocument()
    expect(screen.queryByText('All statuses')).not.toBeInTheDocument()
    expect(screen.queryByText('All payments')).not.toBeInTheDocument()
    expect(screen.queryByTestId('billing-history-filters')).not.toBeInTheDocument()
  })

  it('lists a cancelled bill beside the paid ones, with nothing to operate', async () => {
    const user = userEvent.setup()
    renderHistory()

    const list = await screen.findByTestId('manager-bill-list')
    const before = within(list).getAllByRole('button', { name: /^Bill \d+Paid/ }).length

    // Cancelling is the only way a bill becomes cancelled, so this is the state
    // under test arriving the way it arrives in the shop.
    const [firstBill] = within(list).getAllByRole('button', { name: /^Bill \d+Paid/ })
    await user.click(firstBill!)
    await user.click(await screen.findByRole('button', { name: 'Cancel this bill' }))
    await user.type(await screen.findByLabelText(/Cancellation reason/), 'Wrong item rung')
    await user.click(screen.getByRole('button', { name: 'Cancel bill' }))

    // Still listed, named Cancelled, and no filter was operated to see it.
    const cancelled = await screen.findByRole('button', { name: /^Bill \d+Cancelled/ })
    expect(cancelled).toBeVisible()
    expect(
      within(screen.getByTestId('manager-bill-list')).getAllByRole('button', {
        name: /^Bill \d+(Paid|Cancelled)/,
      }),
    ).toHaveLength(before)
  })
})

describe('the day’s figures sit outside the tabs', () => {
  /**
   * The four money cards answer the question the surface is opened for — what
   * did this outlet take today — so they are not behind a tab. They sit under
   * the day bar and above the tab strip, on screen with the Bills list the
   * surface lands on and still there through both other views. Status keeps the
   * tablet sync panel it is named for and nothing else.
   */
  it('shows all four on the view the surface lands on', async () => {
    renderHistory()

    await screen.findByTestId('manager-bill-list')

    // Bills is the landing view, and no tab was operated to reach these.
    expect(screen.getByRole('tab', { name: /^Bills/ })).toHaveAttribute('aria-selected', 'true')

    const totals = screen.getByRole('region', { name: 'Payment totals' })
    expect(within(totals).getByTestId('billing-total-cash')).toHaveTextContent('Cash')
    expect(within(totals).getByTestId('billing-total-cash')).toHaveTextContent('₹3,711')
    expect(within(totals).getByTestId('billing-total-upi')).toHaveTextContent('UPI')
    expect(within(totals).getByTestId('billing-total-upi')).toHaveTextContent('₹1,772')
    expect(within(totals).getByTestId('billing-total-combined')).toHaveTextContent('Total')
    expect(within(totals).getByTestId('billing-total-average')).toHaveTextContent('AOV')
  })

  it('keeps them through the other two views, and holds exactly one copy', async () => {
    const user = userEvent.setup()
    renderHistory()

    await screen.findByTestId('manager-bill-list')

    for (const name of [/^Open orders/, /^Status/, /^Bills/]) {
      await user.click(screen.getByRole('tab', { name }))
      // One copy, not one per view: a second row inside a tab would be two
      // readings of the same day that can disagree while one is stale.
      expect(screen.getAllByTestId('billing-total-cash')).toHaveLength(1)
      expect(screen.getAllByTestId('billing-total-average')).toHaveLength(1)
    }
  })

  it('leaves Status to the sync activity it is named for', async () => {
    const user = userEvent.setup()
    renderHistory()

    await screen.findByTestId('manager-bill-list')
    await user.click(screen.getByRole('tab', { name: /^Status/ }))

    const syncStatus = screen.getByRole('heading', { name: 'Tablet sync status' })
    expect(syncStatus).toBeVisible()
    // The heading and the sentence that framed the cards inside this view left
    // with them: the day bar sitting directly above the row says which day, and
    // the outlet selector in the header says which outlet.
    expect(screen.queryByRole('heading', { name: 'Payment totals' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('manager-bill-list')).not.toBeInTheDocument()
    expect(screen.queryByText('Bills rung')).not.toBeInTheDocument()
    expect(screen.queryByText('Drawer cash')).not.toBeInTheDocument()

    // The figures are above the panel, not repeated beneath it.
    const totals = screen.getByRole('region', { name: 'Payment totals' })
    expect(
      totals.compareDocumentPosition(syncStatus) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('reads the day’s takings and its average order value beside the tender split', async () => {
    renderHistory()

    // The bills the surface is showing are the ones these figures are about, so
    // the divisor is counted off the screen rather than written down here.
    const list = await screen.findByTestId('manager-bill-list')
    const bills = within(list).getAllByRole('button', { name: /^Bill \d+Paid/ })
    expect(bills.length).toBeGreaterThan(0)

    // ₹3,711 cash and ₹1,772 UPI, so the total is their sum and cannot drift
    // from the two cards beside it.
    expect(within(screen.getByTestId('billing-total-combined')).getByText('Total')).toBeVisible()
    expect(within(screen.getByTestId('billing-total-combined')).getByText('₹5,483')).toBeVisible()

    // And the average is that total over the bills that were paid, in whole
    // paise — `formatPaise` throws on a float, so a division that leaked one
    // would fail here rather than render. `AOV` rather than `Average bill`
    // because the full name does not fit a quarter of a phone row.
    const average = screen.getByTestId('billing-total-average')
    expect(within(average).getByText('AOV')).toBeVisible()
    expect(
      within(average).getByText(formatPaise(averageBillPaise(548_300, bills.length))),
    ).toBeVisible()
  })
})

describe('the Status tab carries its own problem count', () => {
  /**
   * The count belongs on the tab because a refusal is otherwise invisible until
   * somebody opens the tab that holds it, and nobody opens a tab that looks
   * quiet. It reads the way its two neighbours already read, in the page's own
   * parentheses, rather than as an attention badge: a manager cannot clear a
   * refusal from here, and `attention-badges` reserves badges for work the
   * reader can act on.
   */
  it('names the waiting refusal on the closed tab', async () => {
    renderHistory()

    await screen.findByTestId('manager-bill-list')

    // One refused command in the demo outlet, and the tab says so while the
    // panel behind it is still shut.
    expect(await screen.findByRole('tab', { name: 'Status (1)' })).toBeVisible()
    expect(screen.queryByRole('heading', { name: 'Tablet sync status' })).not.toBeInTheDocument()
  })

  it('stays a plain name when nothing was refused', async () => {
    const adapters = createMockAdapters('franchise_admin')

    // Delivered activity, and nothing needing a person. A count of zero would
    // say the tab is empty, which is false: the delivered rows are listed there.
    renderHistory({
      ...adapters,
      billing: {
        ...adapters.billing,
        listDeliveryDiagnostics: async () => [
          {
            reference: 'c0000000-0000-4000-a000-000000000001',
            commandType: 'pay_now',
            resultCategory: 'accepted',
            receivedAt: new Date().toISOString(),
            ageMs: 0,
            orderNumber: null,
          },
        ],
      },
    })

    await screen.findByTestId('manager-bill-list')

    expect(await screen.findByRole('tab', { name: 'Status' })).toBeVisible()
    expect(screen.queryByRole('tab', { name: /^Status \(/ })).not.toBeInTheDocument()
  })

  it('counts exactly what the panel behind it lists', async () => {
    const user = userEvent.setup()
    renderHistory()

    await screen.findByTestId('manager-bill-list')

    // The tab's number and the panel's heading are the same predicate over the
    // same array, so this fails the moment they are derived apart.
    const tab = await screen.findByRole('tab', { name: /^Status/ })
    const counted = /Status \((\d+)\)/.exec(tab.textContent ?? '')?.[1] ?? '0'

    await user.click(tab)

    expect(
      screen.getByText(
        counted === '1' ? '1 recent sync problem' : `${counted} recent sync problems`,
      ),
    ).toBeVisible()
  })
})

/**
 * The after-departure attribution exception, walkable in the demo.
 *
 * Change #50 built this and nothing could show it: the flag renders only on a
 * bill carrying it, and the demo scenario had none. The morning operator now
 * leaves at 11:00 and the tablet records one more sale at 11:45 before it
 * learns, which is the case the whole contract exists for.
 */
describe('a bill recorded after its operator left remotely', () => {
  it('is labelled, stays in the takings, and offers the three review outcomes', async () => {
    const person = userEvent.setup()
    renderHistory()

    // The list marks it before anybody opens it: a manager scanning the day
    // should see that one bill's attribution is in question without having to
    // expand thirty of them.
    const chip = await screen.findByTestId(/^after-departure-/)
    expect(chip).toHaveTextContent('After operator left')

    await person.click(chip.closest('button') ?? chip)
    const panel = await screen.findByTestId('attribution-exception')
    expect(
      within(panel).getByText(/Recorded after the operator left remotely/i),
    ).toBeInTheDocument()

    // The money is not in doubt — only who was standing at the counter. So the
    // bill keeps its place in the day's figures rather than being held back.
    expect(within(panel as HTMLElement).getByText(/included in takings/i)).toBeInTheDocument()

    // All three answers a manager can honestly give.
    expect(within(panel as HTMLElement).getByRole('button', { name: /^Confirm / })).toBeVisible()
    expect(
      within(panel as HTMLElement).getByRole('button', { name: 'Name another biller' }),
    ).toBeVisible()
    expect(
      within(panel as HTMLElement).getByRole('button', { name: 'Operator unknown' }),
    ).toBeVisible()

    // And recording one appends rather than rewriting: the flag survives.
    await person.click(within(panel as HTMLElement).getByRole('button', { name: /^Confirm / }))
    await person.click(await screen.findByRole('button', { name: 'Record review' }))

    expect(await screen.findByText(/Reviewed by/i)).toBeInTheDocument()
    expect(screen.getByText(/Recorded after the operator left remotely/i)).toBeInTheDocument()
  })
})
