import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { appRoutes } from '@/routes'

/**
 * "Demo state resets" is a promise `docs/DEMO_MODE.md` has made since #3, and
 * until now it was only true of a page reload. These tests are what make it
 * true of a control.
 */

function renderDemo(path: string) {
  return render(
    <RouterProvider router={createMemoryRouter(appRoutes, { initialEntries: [path] })} />,
  )
}

async function reset(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId('demo-reset'))
  await user.click(await screen.findByRole('button', { name: 'Discard and start again' }))
}

describe('demo reset', () => {
  beforeEach(() => sessionStorage.clear())
  afterEach(() => sessionStorage.clear())

  it('states what it discards before discarding it', async () => {
    const user = userEvent.setup()
    renderDemo('/demo/admin')
    await screen.findByTestId('demo-banner')

    await user.click(screen.getByTestId('demo-reset'))
    expect(await screen.findByText('Start the demo again?')).toBeInTheDocument()
    expect(screen.getByText(/is discarded/)).toBeInTheDocument()
    expect(screen.getByText(/Nothing real is affected/)).toBeInTheDocument()
  })

  it('discards what a walkthrough recorded and leaves the reader where they were', async () => {
    const user = userEvent.setup()
    renderDemo('/demo/admin/ledger/expenses')

    // Record something. Expenses is the cheapest write to make and to see.
    const list = await screen.findByTestId('ledger-expense-list')
    const before = within(list).getAllByRole('listitem').length

    await user.click(screen.getByRole('button', { name: 'Add expense' }))
    await user.type(screen.getByLabelText('Expense category'), 'Reset supplies')
    await user.type(screen.getByLabelText('Amount (₹)'), '175')
    await user.type(screen.getByLabelText('Note (optional)'), 'Reset probe')
    await user.click(screen.getByRole('button', { name: 'Record expense' }))
    await waitFor(() =>
      expect(screen.getByTestId('ledger-expense-list')).toHaveTextContent('Reset probe'),
    )

    await reset(user)

    // Gone, and back to exactly the count the walkthrough started from.
    await waitFor(() =>
      expect(screen.getByTestId('ledger-expense-list')).not.toHaveTextContent('Reset probe'),
    )
    expect(within(screen.getByTestId('ledger-expense-list')).getAllByRole('listitem')).toHaveLength(
      before,
    )

    // Still on the manager's expenses surface. A reset that sent the reader
    // back to the owner would cost them their place mid-walkthrough.
    expect(screen.getByTestId('demo-banner')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Expenses' })).toBeInTheDocument()
  })

  it('is the only thing that discards a walkthrough — a role switch is not', async () => {
    const user = userEvent.setup()
    renderDemo('/demo/admin/alerts')

    await screen.findByTestId('alert-list')
    await user.click(screen.getByTestId('raise-alert'))
    await user.type(screen.getByLabelText('Subject'), 'Freezer is not holding temperature')
    await user.type(screen.getByLabelText('What happened'), 'It read −4 this morning.')
    await user.click(screen.getByRole('button', { name: 'Raise it' }))
    await waitFor(() =>
      expect(screen.getByTestId('alert-list')).toHaveTextContent(
        'Freezer is not holding temperature',
      ),
    )

    // Flip to the owner. Several mocks are built per role, so the adapters are
    // rebuilt here — and the dataset beneath them must not be, or *"raise it as
    // the manager, answer it as the owner"* would show an empty inbox.
    await user.click(screen.getByRole('link', { name: 'Owner' }))
    await user.click(screen.getAllByRole('link', { name: 'Alerts' })[0]!)

    await waitFor(() =>
      expect(screen.getByTestId('alert-list')).toHaveTextContent(
        'Freezer is not holding temperature',
      ),
    )

    // And the reset still clears it, from the role that did not raise it.
    await reset(user)
    await waitFor(() =>
      expect(screen.getByTestId('alert-list')).not.toHaveTextContent(
        'Freezer is not holding temperature',
      ),
    )
  })

  it('is reachable from every role’s chrome, including the counter', async () => {
    const user = userEvent.setup()
    renderDemo('/demo/biller')
    await screen.findByRole('heading', { name: 'Counter tablet' })
    expect(screen.getByTestId('demo-reset')).toBeInTheDocument()

    // And it works there. The tablet draws no chrome of its own — it has no
    // navigation, no account menu and no sign-out — so the banner sits above it
    // and carries the reset, which is the only way it stays reachable from a
    // screen that deliberately offers no way out.
    await reset(user)
    expect(await screen.findByRole('heading', { name: 'Counter tablet' })).toBeInTheDocument()
  })
})
