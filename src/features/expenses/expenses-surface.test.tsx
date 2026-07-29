import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'

import type { DataAdapters } from '@/data-access/adapters'
import { AdaptersContext } from '@/data-access/adapters-context'
import { createMockAdapters, OUTLET_KALYANI_ID } from '@/data-access/mock'
import { expenseSeeds } from '@/data-access/mock/fixtures/operations'
import { personaFixtures } from '@/data-access/mock/fixtures/personas'
import { formatPaise } from '@/domain'
import { SessionContext } from '@/session/context'
import type { Session } from '@/session/session'

import { ExpensesSurface } from './expenses-surface'

/** Today's expenses at the persona's outlet, straight from the seeds. */
function todaysExpenses() {
  return expenseSeeds.filter(
    (seed) => seed.daysAgo === 0 && (seed.outletId ?? OUTLET_KALYANI_ID) === OUTLET_KALYANI_ID,
  )
}

const managerSession: Session = {
  mode: 'demo',
  userId: personaFixtures.franchise_admin.profile.id,
  role: 'franchise_admin',
  outletId: personaFixtures.franchise_admin.profile.outlet_id,
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

    const cashRows = rows.filter((row) => within(row).queryByText(/Cash — from the drawer/))
    expect(cashRows.length).toBeGreaterThan(0)

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
    await user.selectOptions(screen.getByLabelText('Category'), 'salaries')
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
