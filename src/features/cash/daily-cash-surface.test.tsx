import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'

import type { DataAdapters } from '@/data-access/adapters'
import { AdaptersContext } from '@/data-access/adapters-context'
import { createMockAdapters } from '@/data-access/mock'
import { OUTLET_KANCHRAPARA_ID } from '@/data-access/mock/fixtures/outlets'
import { personaFixtures } from '@/data-access/mock/fixtures/personas'
import { formatPaise } from '@/domain'
import { SessionContext } from '@/session/context'
import type { Session } from '@/session/session'
import { deriveSessionScope } from '@/session/session'
import { chooseOutlet } from '@/test/outlet-scope'

import { DailyCashSurface } from './daily-cash-surface'

/**
 * The screen the business was commissioned to get right. Two things carry these
 * tests: the difference has to appear the moment a figure is typed, and a closed
 * day has to be immovable — including when a bill turns up late.
 */

const managerSession: Session = {
  mode: 'demo',
  userId: personaFixtures.franchise_admin.profile.id,
  assignments: personaFixtures.franchise_admin.assignments,
  ...deriveSessionScope(personaFixtures.franchise_admin.assignments),
  displayName: personaFixtures.franchise_admin.profile.full_name,
  persona: personaFixtures.franchise_admin,
}

function renderCash(adapters: DataAdapters = createMockAdapters('franchise_admin')) {
  return {
    adapters,
    ...render(
      <MemoryRouter>
        <SessionContext.Provider value={managerSession}>
          <AdaptersContext.Provider value={adapters}>
            <DailyCashSurface />
          </AdaptersContext.Provider>
        </SessionContext.Provider>
      </MemoryRouter>,
    ),
  }
}

/**
 * An owner holding no outlet assignment at all — the shape
 * owner-reaches-every-outlet made real. They reach this surface at every outlet
 * and manage none of them, so the drawer is nobody's but the manager's.
 */
const unassignedOwnerSession: Session = {
  mode: 'demo',
  userId: personaFixtures.super_admin.profile.id,
  assignments: [
    { id: 'a1', role: 'super_admin', outletId: null, startedOn: '2025-06-01', endedOn: null },
  ],
  ...deriveSessionScope([
    { id: 'a1', role: 'super_admin', outletId: null, startedOn: '2025-06-01', endedOn: null },
  ]),
  displayName: personaFixtures.super_admin.profile.full_name,
  persona: personaFixtures.super_admin,
}

function renderCashAsOwner(adapters: DataAdapters = createMockAdapters('super_admin')) {
  return {
    adapters,
    ...render(
      <MemoryRouter>
        <SessionContext.Provider value={unassignedOwnerSession}>
          <AdaptersContext.Provider value={adapters}>
            <DailyCashSurface />
          </AdaptersContext.Provider>
        </SessionContext.Provider>
      </MemoryRouter>,
    ),
  }
}

/** `₹2,561` back to 2561, so a test can type one rupee less than expected. */
function rupeesFrom(text: string): number {
  return Number(text.replace(/[₹,]/g, ''))
}

describe('DailyCashSurface — today', () => {
  it('shows every input to the expected closing, derived and labelled', async () => {
    renderCash()

    const figures = await screen.findByTestId('cash-figures')
    expect(within(figures).getByText('Opening float')).toBeInTheDocument()
    expect(within(figures).getByText('Cash sales')).toBeInTheDocument()
    expect(within(figures).getByText('Cash expenses')).toBeInTheDocument()
    expect(within(figures).getByText('Withdrawals')).toBeInTheDocument()
    expect(within(figures).getByText(/A UPI sale is revenue, but not drawer/)).toBeInTheDocument()
    expect(screen.getByTestId('expected-closing')).toBeInTheDocument()
  })

  it('satisfies the expected-closing equation from the figures it displays', async () => {
    renderCash()

    const figures = await screen.findByTestId('cash-figures')
    const paise = (testId: string) =>
      rupeesFrom(within(figures).getByTestId(testId).textContent!) * 100

    // Cash expenses and withdrawals are rendered already negative, which is why
    // they are added here rather than subtracted: the screen shows the direction.
    expect(paise('expected-closing')).toBe(
      paise('opening') + paise('cash-sales') + paise('cash-expenses') + paise('withdrawn'),
    )
  })

  it('shows a shortfall the moment a low count is typed, in words as well as sign', async () => {
    const user = userEvent.setup()
    renderCash()

    // ₹100 less than expected, entered in rupees.
    const expectedRupees = rupeesFrom((await screen.findByTestId('expected-closing')).textContent!)
    await user.type(screen.getByLabelText(/Count the drawer/), String(expectedRupees - 100))

    const difference = await screen.findByTestId('live-difference')
    expect(difference).toHaveAttribute('data-difference', 'short')
    expect(difference).toHaveTextContent('-₹100')
    expect(difference).toHaveTextContent(/missing from the drawer/)
  })

  it('shows an excess the same way when the count is high', async () => {
    const user = userEvent.setup()
    renderCash()

    const expectedRupees = rupeesFrom((await screen.findByTestId('expected-closing')).textContent!)
    await user.type(screen.getByLabelText(/Count the drawer/), String(expectedRupees + 50))

    const difference = await screen.findByTestId('live-difference')
    expect(difference).toHaveAttribute('data-difference', 'over')
    expect(difference).toHaveTextContent(/more than expected/)
  })

  it('says the drawer balances when it does', async () => {
    const user = userEvent.setup()
    renderCash()

    const expectedRupees = rupeesFrom((await screen.findByTestId('expected-closing')).textContent!)
    await user.type(screen.getByLabelText(/Count the drawer/), String(expectedRupees))

    expect(await screen.findByTestId('live-difference')).toHaveAttribute(
      'data-difference',
      'balanced',
    )
  })

  it('a withdrawal reduces the expected closing by exactly its amount', async () => {
    const user = userEvent.setup()
    renderCash()

    const beforeRupees = rupeesFrom((await screen.findByTestId('expected-closing')).textContent!)

    await user.click(screen.getByTestId('add-withdrawal'))
    await user.type(screen.getByLabelText('Amount (₹)'), '500')
    await user.type(screen.getByLabelText('Taken by'), 'Demo Owner')
    await user.click(screen.getByRole('button', { name: 'Record withdrawal' }))

    await waitFor(() => {
      expect(screen.getByTestId('expected-closing')).toHaveTextContent(
        formatPaise((beforeRupees - 500) * 100),
      )
    })
  })

  it('closes the day, snapshots the difference, and offers no way to do it again', async () => {
    const user = userEvent.setup()
    renderCash()

    const expectedRupees = rupeesFrom((await screen.findByTestId('expected-closing')).textContent!)
    await user.type(screen.getByLabelText(/Count the drawer/), String(expectedRupees - 240))

    await user.click(screen.getByTestId('close-day-button'))
    // Scoped to the confirmation: the trigger behind it carries the same words,
    // deliberately — the second press should read as the same decision.
    const dialog = screen.getByRole('dialog', { name: 'Close this day?' })
    await user.click(within(dialog).getByRole('button', { name: 'Close the day' }))

    const closed = await screen.findByTestId('closed-day')
    expect(within(closed).getByTestId('closed-difference')).toHaveAttribute(
      'data-difference',
      'short',
    )
    expect(within(closed).getByTestId('closed-difference')).toHaveTextContent('-₹240')

    expect(screen.queryByTestId('close-day-button')).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Count the drawer/)).not.toBeInTheDocument()
    expect(screen.queryByTestId('add-withdrawal')).not.toBeInTheDocument()
  })

  it('will not close a day with nothing counted', async () => {
    renderCash()
    await screen.findByTestId('expected-closing')
    expect(screen.getByTestId('close-day-button')).toBeDisabled()
  })
})

describe('DailyCashSurface — yesterday, closed with a mismatch', () => {
  it('shows the stored figures, the shortfall, and no way to redo it', async () => {
    const user = userEvent.setup()
    renderCash()

    await screen.findByTestId('cash-day')
    const options = within(screen.getByTestId('cash-day')).getAllByRole('option')
    await user.selectOptions(
      screen.getByTestId('cash-day'),
      (options[1] as HTMLOptionElement).value,
    )

    const closed = await screen.findByTestId('closed-day')
    expect(within(closed).getByTestId('closed-difference')).toHaveAttribute(
      'data-difference',
      'short',
    )
    expect(within(closed).getByText(/Counted twice/)).toBeInTheDocument()
    expect(screen.queryByTestId('close-day-button')).not.toBeInTheDocument()
  })

  it('reports a bill that arrived after the close, and leaves the figures alone', async () => {
    const user = userEvent.setup()
    const { adapters } = renderCash()

    await screen.findByTestId('cash-day')
    const options = within(screen.getByTestId('cash-day')).getAllByRole('option')
    const yesterday = (options[1] as HTMLOptionElement).value
    await user.selectOptions(screen.getByTestId('cash-day'), yesterday)

    const exception = await screen.findByTestId('reconciliation-exception')
    expect(exception).toHaveTextContent(/arrived after this day was closed/i)
    expect(exception).toHaveTextContent(/have .*not.* been changed/i)

    // And the stored figures really are untouched by it.
    const day = await adapters.dailyCash.getDay(managerSession.outletId!, yesterday)
    expect(day.closed!.cash_sales_paise).toBe(day.cashSalesPaise)
    expect(day.exceptions).toHaveLength(1)
  })
})

/**
 * The owner, reaching a drawer that is not theirs
 * (owner-reaches-every-outlet, design D2).
 *
 * Reaching this surface is not managing the outlet: the bound is the database's
 * — `cash_withdrawals_insert` and `close_business_day` carry no owner branch at
 * all — and what is asserted here is that the screen never offers what would be
 * refused, while still showing the figures. An owner who cannot see the day
 * cannot oversee it.
 */
describe('DailyCashSurface — an owner assigned nowhere', () => {
  it('shows the day and offers neither the close nor a withdrawal', async () => {
    renderCashAsOwner()

    // The figures are there.
    expect(await screen.findByTestId('expected-closing')).toBeInTheDocument()

    // The two writes are not, and the screen says whose they are.
    expect(screen.queryByTestId('close-day-button')).not.toBeInTheDocument()
    expect(screen.queryByTestId('add-withdrawal')).not.toBeInTheDocument()
    expect(screen.getByTestId('drawer-not-yours')).toHaveTextContent(
      /belongs to this outlet’s manager/i,
    )
  })

  it('says the same at every outlet, because the reason is the assignment', async () => {
    renderCashAsOwner()

    await screen.findByTestId('expected-closing')
    // The outlet they do not run, reached through the same switcher.
    await chooseOutlet(OUTLET_KANCHRAPARA_ID)

    expect(await screen.findByTestId('drawer-not-yours')).toBeInTheDocument()
    expect(screen.queryByTestId('close-day-button')).not.toBeInTheDocument()
  })
})
