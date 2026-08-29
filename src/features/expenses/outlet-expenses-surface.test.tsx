import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import type { DataAdapters, ManualLedgerExpense } from '@/data-access/adapters'
import { AdaptersContext } from '@/data-access/adapters-context'
import { createMockAdapters } from '@/data-access/mock'
import { OUTLET_KALYANI_ID, outletFixtures } from '@/data-access/mock/fixtures/outlets'
import { formatPaise, resolveBusinessDate, shiftBusinessDate } from '@/domain'
import { SessionContext } from '@/session/context'
import type { Role } from '@/session/session'
import { demoSessionFor } from '@/test/session'

import { OutletExpensesSurface } from './outlet-expenses-surface'

const cutover = outletFixtures.find(
  (outlet) => outlet.id === OUTLET_KALYANI_ID,
)!.business_day_cutover
const today = resolveBusinessDate(new Date(), cutover)
const yesterday = shiftBusinessDate(today, -1)

function expense(
  id: string,
  businessDate: string,
  amountPaise: number,
  options: { isCash?: boolean; voided?: boolean } = {},
): ManualLedgerExpense {
  return {
    id,
    outletId: OUTLET_KALYANI_ID,
    businessDate,
    category: `Expense ${id}`,
    isCash: options.isCash ?? true,
    amountPaise,
    note: null,
    createdAt: `${businessDate}T12:00:00.000Z`,
    updatedAt: `${businessDate}T12:00:00.000Z`,
    recordedBy: { id: 'someone-else', name: 'Another staff member' },
    source: null,
    updatedBy: null,
    recordedAway: false,
    voidedAt: options.voided ? `${businessDate}T13:00:00.000Z` : null,
    voidedBy: options.voided ? { id: 'manager', name: 'Demo Manager' } : null,
    voidedReason: null,
  }
}

function adaptersFor(
  role: Role,
  rowsFor: (dates: readonly string[]) => ManualLedgerExpense[],
): { adapters: DataAdapters; listRecentExpenses: ReturnType<typeof vi.fn> } {
  const base = createMockAdapters(role)
  const listRecentExpenses = vi.fn(async (_outletId: string, dates: readonly string[]) =>
    rowsFor(dates),
  )
  return {
    listRecentExpenses,
    adapters: {
      ...base,
      manualLedger: { ...base.manualLedger, listRecentExpenses },
    },
  }
}

function renderExpenses(role: Role, adapters: DataAdapters) {
  return render(
    <MemoryRouter>
      <SessionContext.Provider value={demoSessionFor(role)}>
        <AdaptersContext.Provider value={adapters}>
          <OutletExpensesSurface />
        </AdaptersContext.Provider>
      </SessionContext.Provider>
    </MemoryRouter>,
  )
}

describe('the outlet expenses surface', () => {
  it('lets a manager step back and correct another person’s row, and totals only live rows', async () => {
    const rows = [
      expense('cash', yesterday, 1_000),
      expense('upi', yesterday, 2_000, { isCash: false }),
      expense('withdrawn', yesterday, 4_000, { voided: true }),
    ]
    const { adapters } = adaptersFor('franchise_admin', (dates) =>
      dates.includes(yesterday) ? rows : [],
    )
    renderExpenses('franchise_admin', adapters)

    await userEvent.click(await screen.findByTestId('expenses-step-back'))
    const list = await screen.findByTestId('ledger-expense-list')
    expect(within(list).getByText('Expense cash')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Actions for Expense cash' }))
    expect(await screen.findByTestId('edit-expense-cash')).toBeInTheDocument()

    const totals = screen.getByTestId('expense-totals')
    expect(within(totals).getByText(formatPaise(3_000))).toBeInTheDocument()
    expect(screen.getByTestId('expense-cash-total')).toHaveTextContent(formatPaise(1_000))
  })

  it('keeps a Biller on two dates with no day bar, totals, or actions for another person', async () => {
    const manager = adaptersFor('franchise_admin', () => [])
    const managerView = renderExpenses('franchise_admin', manager.adapters)
    expect(await screen.findByTestId('expenses-period')).toBeInTheDocument()
    managerView.unmount()

    const otherPerson = expense('other-person', today, 1_500)
    const biller = adaptersFor('biller', () => [otherPerson])
    renderExpenses('biller', biller.adapters)
    await screen.findByTestId('ledger-expense-list')

    expect(screen.queryByTestId('expenses-period')).not.toBeInTheDocument()
    expect(screen.queryByTestId('expense-totals')).not.toBeInTheDocument()
    expect(biller.listRecentExpenses).toHaveBeenCalledWith(OUTLET_KALYANI_ID, [today, yesterday])
    expect(
      screen.queryByRole('button', { name: 'Actions for Expense other-person' }),
    ).not.toBeInTheDocument()
  })

  it('records from an empty past day against the day on screen', async () => {
    const base = adaptersFor('franchise_admin', () => [])
    const createExpense = vi.fn(base.adapters.manualLedger.createExpense)
    const adapters: DataAdapters = {
      ...base.adapters,
      manualLedger: { ...base.adapters.manualLedger, createExpense },
    }
    renderExpenses('franchise_admin', adapters)

    await userEvent.click(await screen.findByTestId('expenses-step-back'))
    expect(await screen.findByText('Nothing was recorded for this day.')).toBeInTheDocument()
    expect(screen.getByTestId('add-ledger-expense')).toBeInTheDocument()

    await userEvent.click(screen.getByTestId('add-ledger-expense'))
    await userEvent.type(screen.getByRole('combobox', { name: 'Expense category' }), 'Vegetables')
    await userEvent.type(screen.getByTestId('expense-amount'), '125')
    await userEvent.click(screen.getByRole('button', { name: 'Record expense' }))

    await waitFor(() => {
      expect(createExpense).toHaveBeenCalledWith(
        expect.objectContaining({ businessDate: yesterday }),
      )
    })
  })

  it('stops the forward step and calendar at the owner’s outlet-local today', async () => {
    const { adapters } = adaptersFor('super_admin', () => [])
    renderExpenses('super_admin', adapters)

    const picker = (await screen.findByTestId('expenses-day-picker')) as HTMLInputElement
    const forward = screen.getByTestId('expenses-step-forward')
    expect(picker).toHaveAttribute('max', today)
    expect(forward).toBeDisabled()

    fireEvent.change(picker, { target: { value: yesterday } })
    await waitFor(() => expect(forward).toBeEnabled())
    await userEvent.click(forward)
    expect(picker).toHaveValue(today)
    expect(forward).toBeDisabled()
  })
})
