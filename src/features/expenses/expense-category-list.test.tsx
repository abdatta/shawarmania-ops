import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'

import type { ExpenseRecord } from '@/data-access/adapters'
import { AdaptersContext } from '@/data-access/adapters-context'
import { createMockAdapters, OUTLET_KALYANI_ID } from '@/data-access/mock'
import { ChangeGatesForTest, describeChangeGate } from '@/test/change-gates'

import { ExpenseList } from './expense-list'

/**
 * The category as a tile from the owners' list (a-check-in-at-the-shop-
 * approves-itself, design D11): staff never see the managers' choices, Other
 * will not save without what it was for, and an old entry keeps its name.
 */

const today = '2026-10-29'

const maintenance: ExpenseRecord = {
  id: 'old',
  outletId: OUTLET_KALYANI_ID,
  businessDate: today,
  category: 'Maintenance',
  isCash: true,
  amountPaise: 45_000,
  note: null,
  occurredAt: null,
  createdAt: `${today}T06:00:00.000Z`,
  updatedAt: `${today}T06:00:00.000Z`,
  recordedBy: { id: 'manager', name: 'Manager' },
  source: null,
  updatedBy: null,
  recordedAway: false,
  voidedAt: null,
  voidedBy: null,
  voidedReason: null,
}

function renderList(on: boolean, mayTouchAnyRow: boolean) {
  const base = createMockAdapters(mayTouchAnyRow ? 'franchise_admin' : 'employee')
  const createExpense = vi.fn(async () => maintenance)
  const updateExpense = vi.fn(async () => maintenance)
  const adapters = {
    ...base,
    expenses: { ...base.expenses, createExpense, updateExpense },
  }
  render(
    <ChangeGatesForTest
      on={{
        'auto-approve-at-the-shop': true,
        'refreshed-staff-screens': true,
        'expense-category-list': on,
      }}
    >
      <AdaptersContext.Provider value={adapters}>
        <ExpenseList
          expenses={[maintenance]}
          outletId={OUTLET_KALYANI_ID}
          businessDate={today}
          currentBusinessDate={today}
          viewer={{ id: mayTouchAnyRow ? 'manager' : 'staff', mayTouchAnyRow }}
          heading={null}
          emptyTitle="Nothing spent yet."
          onChanged={() => {}}
        />
      </AdaptersContext.Provider>
    </ChangeGatesForTest>,
  )
  return { createExpense, updateExpense }
}

describeChangeGate('expense-category-list', (on) => {
  it(
    on ? 'offers staff the list, without the managers’ choices' : 'types the category',
    async () => {
      const user = userEvent.setup()
      renderList(on, false)

      await user.click(screen.getByTestId('add-ledger-expense'))
      const sheet = await screen.findByRole('dialog', { name: 'Add expense' })

      if (on) {
        const tiles = await within(sheet).findAllByRole('radio')
        expect(tiles.map((tile) => tile.textContent)).toEqual([
          'Chicken',
          'Raw Materials',
          'Gas',
          'Staff Food',
          'Transport',
          'Other',
        ])
        expect(tiles.every((tile) => tile.getAttribute('aria-checked') === 'false')).toBe(true)
        expect(within(sheet).queryByTestId('expense-category')).not.toBeInTheDocument()
      } else {
        expect(within(sheet).getByTestId('expense-category')).toBeInTheDocument()
        expect(within(sheet).queryByRole('radio')).not.toBeInTheDocument()
      }
    },
  )

  it.runIf(on)('refuses Other without what it was for, then records it', async () => {
    const user = userEvent.setup()
    const { createExpense } = renderList(on, false)

    await user.click(screen.getByTestId('add-ledger-expense'))
    const sheet = await screen.findByRole('dialog', { name: 'Add expense' })
    await user.type(within(sheet).getByTestId('expense-amount'), '120')
    await user.click(await within(sheet).findByRole('radio', { name: 'Other' }))
    expect(within(sheet).getByLabelText('What was it for?')).toBeRequired()

    await user.click(within(sheet).getByRole('button', { name: 'Record expense' }))
    expect(await within(sheet).findByText('Say what it was for.')).toBeInTheDocument()
    expect(createExpense).not.toHaveBeenCalled()

    await user.type(within(sheet).getByTestId('expense-description'), 'Light bulbs')
    await user.click(within(sheet).getByRole('button', { name: 'Record expense' }))
    expect(createExpense).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'Other', note: 'Light bulbs', amountPaise: 12_000 }),
    )
  })

  it.runIf(on)('keeps an old entry’s name as a chosen tile on edit', async () => {
    const user = userEvent.setup()
    const { updateExpense } = renderList(on, true)

    await user.click(screen.getByRole('button', { name: 'Actions for Maintenance' }))
    await user.click(await screen.findByTestId('edit-expense-old'))
    const sheet = await screen.findByRole('dialog', { name: 'Edit expense' })

    expect(await within(sheet).findByRole('radio', { name: 'Maintenance' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    // A manager sees the managers' choice.
    expect(within(sheet).getByRole('radio', { name: 'Wages & bonus' })).toBeInTheDocument()

    await user.click(within(sheet).getByRole('button', { name: 'Save expense' }))
    expect(updateExpense).toHaveBeenCalledWith(
      'old',
      expect.objectContaining({ category: 'Maintenance' }),
    )
  })
})
