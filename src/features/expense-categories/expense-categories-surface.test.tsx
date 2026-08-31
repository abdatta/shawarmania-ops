import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { AdaptersContext } from '@/data-access'
import { createDemoData, createMockAdapters } from '@/data-access/mock'

import { ExpenseCategoriesSurface } from './expense-categories-surface'

describe('ExpenseCategoriesSurface', () => {
  it('states the canonical expense count before a merge and explains the result in its log', async () => {
    const user = userEvent.setup()
    const data = createDemoData()
    const adapters = createMockAdapters('super_admin', data)
    render(
      <AdaptersContext.Provider value={adapters}>
        <ExpenseCategoriesSurface />
      </AdaptersContext.Provider>,
    )

    const list = await screen.findByTestId('expense-category-list')
    const source = within(list)
      .getByRole('heading', { name: 'Maintenance' })
      .closest('[data-testid^="category-"]')
    expect(source).not.toBeNull()
    await user.click(within(source as HTMLElement).getByRole('button', { name: /merge/i }))

    expect(screen.getByText('2 expense rows')).toBeInTheDocument()
    expect(screen.getByText(/there is no undo/i)).toBeInTheDocument()
    await user.selectOptions(screen.getByRole('combobox'), 'Chicken')
    await user.click(screen.getByRole('button', { name: 'Merge permanently' }))

    expect(await screen.findByRole('status')).toHaveTextContent('2 expense rows moved')
    await waitFor(() => {
      expect(screen.getByTestId('category-operation-log')).toHaveTextContent(
        'Merged Maintenance → Chicken',
      )
    })
  })
})
