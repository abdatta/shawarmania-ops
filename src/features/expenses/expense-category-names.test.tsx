import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { expect, it, vi } from 'vitest'

import { AdaptersContext } from '@/data-access/adapters-context'
import { createMockAdapters } from '@/data-access/mock'
import { SessionContext } from '@/session/context'
import { demoSessionFor } from '@/test/session'

import { OutletExpensesSurface } from './outlet-expenses-surface'

/**
 * Adding an expense offers the outlet's category names from `names()`, one
 * request, not `list()`, which also counts each category's use one request at a
 * time (the-app-asks-the-server-less, D5).
 */
it('offers the category names from one names request', async () => {
  const adapters = createMockAdapters('franchise_admin')
  const names = vi.spyOn(adapters.expenseCategories, 'names')
  const list = vi.spyOn(adapters.expenseCategories, 'list')
  const expected = await adapters.expenseCategories.names()
  names.mockClear()
  expect(expected.length).toBeGreaterThan(0)

  render(
    <MemoryRouter>
      <SessionContext.Provider value={demoSessionFor('franchise_admin')}>
        <AdaptersContext.Provider value={adapters}>
          <OutletExpensesSurface />
        </AdaptersContext.Provider>
      </SessionContext.Provider>
    </MemoryRouter>,
  )

  await userEvent.click(await screen.findByTestId('add-ledger-expense'))
  await userEvent.click(screen.getByRole('combobox', { name: 'Expense category' }))

  await waitFor(() => expect(names.mock.calls.length).toBeGreaterThan(0))
  expect(list.mock.calls.length).toBe(0)
  expect(await screen.findByRole('option', { name: expected[0]! })).toBeInTheDocument()
})
