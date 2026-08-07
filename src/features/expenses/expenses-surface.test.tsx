import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'

import type { DataAdapters } from '@/data-access/adapters'
import { AdaptersContext } from '@/data-access/adapters-context'
import { createMockAdapters, OUTLET_KALYANI_ID, OUTLET_KANCHRAPARA_ID } from '@/data-access/mock'
import { expenseSeeds } from '@/data-access/mock/fixtures/operations'
import { personaFixtures } from '@/data-access/mock/fixtures/personas'
import { formatPaise, resolveBusinessDate } from '@/domain'
import { SessionContext } from '@/session/context'
import type { Session } from '@/session/session'
import { deriveSessionScope } from '@/session/session'
import { chooseOutlet, expectOutletChosen } from '@/test/outlet-scope'

import { ExpensesSurface } from './expenses-surface'

/** The business date the surfaces resolve to, under the seeded 04:00 cutover. */
function todayBusinessDate() {
  return resolveBusinessDate(new Date(), '04:00:00')
}

/** Today's expenses at the persona's outlet, straight from the seeds. */
function todaysExpenses() {
  return expenseSeeds.filter(
    (seed) => seed.daysAgo === 0 && (seed.outletId ?? OUTLET_KALYANI_ID) === OUTLET_KALYANI_ID,
  )
}

const managerSession: Session = {
  mode: 'demo',
  userId: personaFixtures.franchise_admin.profile.id,
  assignments: personaFixtures.franchise_admin.assignments,
  ...deriveSessionScope(personaFixtures.franchise_admin.assignments),
  displayName: personaFixtures.franchise_admin.profile.full_name,
  persona: personaFixtures.franchise_admin,
}

function renderExpenses(adapters: DataAdapters = createMockAdapters('franchise_admin')) {
  return {
    adapters,
    ...render(
      <MemoryRouter>
        <SessionContext.Provider value={managerSession}>
          <AdaptersContext.Provider value={adapters}>
            <ExpensesSurface />
          </AdaptersContext.Provider>
        </SessionContext.Provider>
      </MemoryRouter>,
    ),
  }
}

describe('ExpensesSurface', () => {
  it('marks a cash expense in words, and does not mark the others', async () => {
    renderExpenses()

    const list = await screen.findByTestId('expense-list')
    const rows = within(list).getAllByRole('listitem')

    // Visibly one word, because the badge shares a line with a category and an
    // amount on a phone — and the rest of the sentence is still there for a reader
    // who cannot see it.
    const cashRows = rows.filter((row) => within(row).queryByText('Cash'))
    expect(cashRows.length).toBeGreaterThan(0)
    expect(within(cashRows[0]!).getByText(/from the drawer/)).toHaveClass('sr-only')

    const upiRow = rows.find((row) => within(row).queryByText('UPI'))
    expect(upiRow).toBeDefined()
    expect(within(upiRow!).queryByText(/from the drawer/)).not.toBeInTheDocument()
  })

  it('totals the day and separates the part that came out of the drawer', async () => {
    renderExpenses()

    const totals = await screen.findByTestId('expense-totals')
    // Derived from the fixtures rather than pinned: the demo's expenses are
    // chosen so the P&L's two bases visibly differ, and they move when that
    // does. What is asserted is that the day totals and that cash is separated.
    const today = todaysExpenses()
    const spent = today.reduce((running, expense) => running + expense.amountPaise, 0)
    const cash = today
      .filter((expense) => expense.paymentMethod === 'cash')
      .reduce((running, expense) => running + expense.amountPaise, 0)

    expect(cash).toBeLessThan(spent)
    expect(within(totals).getByText(formatPaise(spent))).toBeInTheDocument()
    expect(screen.getByTestId('expense-cash-total')).toHaveTextContent(formatPaise(cash))
  })

  it('records an expense and shows it on the day', async () => {
    const user = userEvent.setup()
    renderExpenses()

    await screen.findByTestId('expense-list')
    await user.click(screen.getByRole('button', { name: 'Add expense' }))
    await user.type(screen.getByLabelText('Expense category'), 'Staff advances')
    await user.type(screen.getByLabelText('Amount (₹)'), '3500')
    await user.selectOptions(screen.getByLabelText('Paid with'), 'cash')
    await user.type(screen.getByLabelText('Description (optional)'), 'Advance to the griller')
    await user.click(screen.getByRole('button', { name: 'Record expense' }))

    const cashBefore = todaysExpenses()
      .filter((expense) => expense.paymentMethod === 'cash')
      .reduce((running, expense) => running + expense.amountPaise, 0)

    expect(await screen.findByText('Advance to the griller')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByTestId('expense-cash-total')).toHaveTextContent(
        formatPaise(cashBefore + 350_000),
      )
    })
  })

  it('refuses a blank amount by naming the field, and records nothing', async () => {
    const user = userEvent.setup()
    const { adapters } = renderExpenses()

    const list = await screen.findByTestId('expense-list')
    const before = within(list).getAllByRole('listitem').length

    await user.click(screen.getByRole('button', { name: 'Add expense' }))
    await user.click(screen.getByRole('button', { name: 'Record expense' }))

    expect(await screen.findByTestId('form-sheet-error')).toHaveTextContent(/number of rupees/i)

    // Not merely absent from the screen — absent from the data.
    const day = await adapters.expenses.listExpenses(managerSession.outletId!, '')
    expect(day).toEqual([])
    expect(within(screen.getByTestId('expense-list')).getAllByRole('listitem').length).toBe(before)
  })

  it('shows another day when one is chosen', async () => {
    const user = userEvent.setup()
    renderExpenses()

    await screen.findByTestId('expense-list')
    const picker = screen.getByTestId('expense-day')
    const options = within(picker).getAllByRole('option')
    expect(options.length).toBe(7)

    await user.selectOptions(picker, (options[1] as HTMLOptionElement).value)

    // Yesterday's list: the electricity bill is on it and today's packaging is not.
    expect(await screen.findByText('Monthly bill')).toBeInTheDocument()
    expect(screen.queryByText('Boxes and napkins')).not.toBeInTheDocument()
  })
})

/**
 * The owner recording into an outlet they do not run.
 *
 * The bound is the database's — `expenses_insert` refuses `cash` from the
 * owner's branch — and what is asserted here is that the form never offers the
 * thing that would be refused. The refusal itself is proved in pgTAP and the
 * REST probes.
 */
describe('the owner, on an outlet they do not manage', () => {
  const ownerSession: Session = {
    mode: 'demo',
    userId: personaFixtures.super_admin.profile.id,
    assignments: personaFixtures.super_admin.assignments,
    ...deriveSessionScope(personaFixtures.super_admin.assignments),
    displayName: personaFixtures.super_admin.profile.full_name,
    persona: personaFixtures.super_admin,
  }

  function renderAsOwner() {
    const adapters = createMockAdapters('super_admin')
    return {
      adapters,
      ...render(
        <MemoryRouter>
          <SessionContext.Provider value={ownerSession}>
            <AdaptersContext.Provider value={adapters}>
              <ExpensesSurface />
            </AdaptersContext.Provider>
          </SessionContext.Provider>
        </MemoryRouter>,
      ),
    }
  }

  it('opens on the outlet they run, and can reach the other one', async () => {
    renderAsOwner()

    // The demo owner manages Kalyani, so that is where they land — not on
    // somebody else's books.
    const selector = await screen.findByTestId('surface-outlet')
    expectOutletChosen(OUTLET_KALYANI_ID)

    // Every outlet they can reach is on screen without opening anything.
    expect(selector).toHaveTextContent('Shawarmania Kanchrapara')
    await chooseOutlet(OUTLET_KANCHRAPARA_ID)
  })

  it('offers no cash there, and says why', async () => {
    const user = userEvent.setup()
    renderAsOwner()

    await chooseOutlet(OUTLET_KANCHRAPARA_ID)
    await user.click(await screen.findByTestId('add-expense'))

    expect(await screen.findByTestId('remote-entry-note')).toHaveTextContent(
      /cannot touch its drawer/i,
    )
    const methods = within(screen.getByLabelText('Paid with'))
      .getAllByRole('option')
      .map((option) => option.textContent)
    expect(methods).not.toContain('Cash')
    expect(methods).toContain('UPI')
  })

  it('still offers cash at the outlet they do run', async () => {
    const user = userEvent.setup()
    renderAsOwner()

    await screen.findByTestId('surface-outlet')
    await user.click(await screen.findByTestId('add-expense'))

    // Kalyani is theirs to run, so nothing is narrowed: that authority comes
    // from the assignment rather than from being the owner.
    expect(screen.queryByTestId('remote-entry-note')).not.toBeInTheDocument()
    const methods = within(screen.getByLabelText('Paid with'))
      .getAllByRole('option')
      .map((option) => option.textContent)
    expect(methods).toContain('Cash')
  })

  it('records the entry as the owner, at the outlet they chose', async () => {
    const user = userEvent.setup()
    const { adapters } = renderAsOwner()

    await chooseOutlet(OUTLET_KANCHRAPARA_ID)
    await user.click(await screen.findByTestId('add-expense'))
    await user.type(screen.getByLabelText('Expense category'), 'Platform fee')
    await user.type(screen.getByLabelText('Amount (₹)'), '620')
    await user.type(screen.getByLabelText(/Description/), 'Aggregator platform fee')
    await user.click(screen.getByRole('button', { name: /Record/ }))

    await waitFor(async () => {
      const rows = await adapters.expenses.listExpenses(OUTLET_KANCHRAPARA_ID, todayBusinessDate())
      expect(rows.some((row) => row.description === 'Aggregator platform fee')).toBe(true)
    })
  })
})
