import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import type { ExpenseRecord } from '@/data-access/adapters'
import { AdaptersContext } from '@/data-access/adapters-context'
import { createMockAdapters, OUTLET_KALYANI_ID } from '@/data-access/mock'
import { shiftBusinessDate } from '@/domain'

import { ExpenseList } from './expense-list'

/**
 * The expense list (a-check-in-at-the-shop-approves-itself, design D9): days
 * under headings, the reader's own rows tagged, the Cash label kept, and the
 * form asking the amount first. The same list the counter tablet draws.
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

function renderList() {
  render(
    <AdaptersContext.Provider value={createMockAdapters('employee')}>
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
    </AdaptersContext.Provider>,
  )
}

describe('the expense list', () => {
  it('puts the days under headings and tags my rows', () => {
    renderList()

    expect(screen.getByTestId(`expense-day-${today}`)).toHaveTextContent('Today')
    expect(screen.getByTestId(`expense-day-${yesterday}`)).toHaveTextContent('Yesterday')
    expect(screen.queryByTestId('ledger-expense-date-a')).not.toBeInTheDocument()
    expect(screen.getByTestId('expense-you-a')).toHaveTextContent('You')
    expect(screen.queryByTestId('expense-you-b')).not.toBeInTheDocument()
    // Every staff row is cash, and says so (owner, 2026-10-25).
    expect(screen.getByTestId('ledger-cash-a')).toHaveTextContent('Cash')
  })

  it('asks the amount first, then the category, then what it was for', async () => {
    const user = userEvent.setup()
    renderList()

    await user.click(screen.getByTestId('add-ledger-expense'))
    const sheet = await screen.findByRole('dialog', { name: 'Add expense' })
    const [firstTile] = await within(sheet).findAllByRole('radio')
    const fields = within(sheet)
      .getAllByRole('textbox')
      .map((field) => field.id)

    expect(fields[0]).toBe('expense-amount')
    const amount = within(sheet).getByTestId('expense-amount')
    const note = within(sheet).getByTestId('expense-description')
    expect(
      amount.compareDocumentPosition(firstTile!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(firstTile!.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(note).toHaveAttribute('placeholder', 'What was it for?')
  })
})
