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

describe('manager billing history status', () => {
  it('puts Cash and UPI aggregates before sync activity in one Status view', async () => {
    const user = userEvent.setup()
    const adapters = createMockAdapters('franchise_admin')

    render(
      <MemoryRouter>
        <SessionContext.Provider value={managerSession()}>
          <AdaptersContext.Provider value={adapters}>
            <ManagerBillingHistory />
          </AdaptersContext.Provider>
        </SessionContext.Provider>
      </MemoryRouter>,
    )

    const statusTab = await screen.findByRole('tab', { name: 'Status' })
    expect(screen.queryByRole('heading', { name: 'Payment totals' })).not.toBeInTheDocument()

    await user.click(statusTab)

    const paymentTotals = screen.getByRole('heading', { name: 'Payment totals' })
    expect(paymentTotals).toBeVisible()
    expect(within(screen.getByTestId('billing-total-cash')).getByText('Cash')).toBeVisible()
    expect(within(screen.getByTestId('billing-total-cash')).getByText('₹3,711')).toBeVisible()
    expect(within(screen.getByTestId('billing-total-upi')).getByText('UPI')).toBeVisible()
    const syncStatus = screen.getByRole('heading', { name: 'Tablet sync status' })
    expect(syncStatus).toBeVisible()
    expect(
      paymentTotals.compareDocumentPosition(syncStatus) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(within(screen.getByTestId('billing-total-upi')).getByText('₹1,772')).toBeVisible()
    expect(screen.queryByText('Bills rung')).not.toBeInTheDocument()
    expect(screen.queryByText('Drawer cash')).not.toBeInTheDocument()
    expect(screen.queryByTestId('manager-bill-list')).not.toBeInTheDocument()
  })

  it('reads the day’s takings and its average bill beside the tender split', async () => {
    const user = userEvent.setup()
    renderHistory()

    // The bills the surface is showing are the ones these figures are about, so
    // the divisor is counted off the screen rather than written down here.
    const list = await screen.findByTestId('manager-bill-list')
    const bills = within(list).getAllByRole('button', { name: /^Bill \d+Paid/ })
    expect(bills.length).toBeGreaterThan(0)

    await user.click(screen.getByRole('tab', { name: 'Status' }))

    // ₹3,711 cash and ₹1,772 UPI, so the total is their sum and cannot drift
    // from the two cards beside it.
    expect(within(screen.getByTestId('billing-total-combined')).getByText('Total')).toBeVisible()
    expect(within(screen.getByTestId('billing-total-combined')).getByText('₹5,483')).toBeVisible()

    // And the average is that total over the bills that were paid, in whole
    // paise — `formatPaise` throws on a float, so a division that leaked one
    // would fail here rather than render.
    const average = screen.getByTestId('billing-total-average')
    expect(within(average).getByText('Average bill')).toBeVisible()
    expect(
      within(average).getByText(formatPaise(averageBillPaise(548_300, bills.length))),
    ).toBeVisible()
  })
})
