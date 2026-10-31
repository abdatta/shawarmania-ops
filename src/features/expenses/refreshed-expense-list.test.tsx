import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'

import type { ExpenseRecord } from '@/data-access/adapters'
import { AdaptersContext } from '@/data-access/adapters-context'
import { createMockAdapters, OUTLET_KALYANI_ID } from '@/data-access/mock'
import { shiftBusinessDate } from '@/domain'
import { ChangeGatesForTest, describeChangeGate } from '@/test/change-gates'

import { ExpenseList } from './expense-list'

/**
 * The expense list on the refreshed screens (a-check-in-at-the-shop-approves-
 * itself, design D9): days under headings, the reader's own rows tagged, the
 * Cash label kept, and the form asking the amount first. The same list the
 * counter tablet draws.
 */

const today = '2026-10-26'
const yesterday = shiftBusinessDate(today, -1)
const ME = 'me'

function expense(id: string, businessDate: string, category: string, mine = false): ExpenseRecord {
  return {
    id,
    outletId: OUTLET_KALYANI_ID,
    businessDate,
    category,
    isCash: true,
    amountPaise: 45_000,
    note: null,
    occurredAt: null,
    createdAt: `${businessDate}T06:00:00.000Z`,
    updatedAt: `${businessDate}T06:00:00.000Z`,
    recordedBy: mine ? { id: ME, name: 'Me' } : { id: 'someone', name: 'Someone' },
    source: null,
    updatedBy: null,
    recordedAway: false,
    voidedAt: null,
    voidedBy: null,
    voidedReason: null,
  }
}

const rows = [
  expense('a', today, 'Chicken', true),
  expense('b', today, 'Maintenance'),
  expense('c', yesterday, 'Chicken'),
]

function renderList(on: boolean) {
  const base = createMockAdapters('employee')
  const adapters = {
    ...base,
    expenseCategories: {
      ...base.expenseCategories,
      names: vi.fn(async () => ['Chicken', 'Electricity', 'Maintenance', 'Other', 'Vegetables']),
    },
  }
  render(
    <ChangeGatesForTest
      on={{
        'auto-approve-at-the-shop': true,
        'refreshed-staff-screens': on,
      }}
    >
      <AdaptersContext.Provider value={adapters}>
        <ExpenseList
          expenses={rows}
          outletId={OUTLET_KALYANI_ID}
          businessDate={today}
          currentBusinessDate={today}
          viewer={{ id: ME, mayTouchAnyRow: false }}
          showDates
          heading={null}
          emptyTitle="Nothing spent yet."
          onChanged={() => {}}
        />
      </AdaptersContext.Provider>
    </ChangeGatesForTest>,
  )
}

describeChangeGate('refreshed-staff-screens', (on) => {
  it(on ? 'puts the days under headings and tags my rows' : 'dates each row, as before', () => {
    renderList(on)

    if (on) {
      expect(screen.getByTestId(`expense-day-${today}`)).toHaveTextContent('Today')
      expect(screen.getByTestId(`expense-day-${yesterday}`)).toHaveTextContent('Yesterday')
      expect(screen.queryByTestId('ledger-expense-date-a')).not.toBeInTheDocument()
      expect(screen.getByTestId('expense-you-a')).toHaveTextContent('You')
      expect(screen.queryByTestId('expense-you-b')).not.toBeInTheDocument()
    } else {
      expect(screen.queryByTestId(`expense-day-${today}`)).not.toBeInTheDocument()
      expect(screen.getByTestId('ledger-expense-date-a')).toBeInTheDocument()
      expect(screen.queryByTestId('expense-you-a')).not.toBeInTheDocument()
    }
    // Every staff row is cash, and says so either way (owner, 2026-10-25).
    expect(screen.getByTestId('ledger-cash-a')).toHaveTextContent('Cash')
  })

  it(on ? 'asks the amount first, then the typed category' : 'asks the amount last', async () => {
    const user = userEvent.setup()
    renderList(on)

    await user.click(screen.getByTestId('add-ledger-expense'))
    const sheet = await screen.findByRole('dialog', { name: 'Add expense' })
    const fields = within(sheet)
      .getAllByRole('textbox')
      .map((field) => field.id)

    if (on) {
      expect(fields[0]).toBe('expense-amount')
      // Then the category, typed as it always was (a 28-day replay found
      // tap buttons would rarely have held what was typed).
      const category = within(sheet).getByTestId('expense-category')
      const note = within(sheet).getByTestId('expense-description')
      expect(category.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(within(sheet).queryByTestId('expense-category-choice')).not.toBeInTheDocument()
      expect(note).toHaveAttribute('placeholder', 'What was it for?')
    } else {
      // As it was: category, note, and the amount last.
      expect(fields.indexOf('expense-amount')).toBeGreaterThan(
        fields.indexOf('expense-description'),
      )
    }
  })
})
