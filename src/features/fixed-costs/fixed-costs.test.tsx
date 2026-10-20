import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'

import type { DataAdapters } from '@/data-access/adapters'
import { AdaptersContext } from '@/data-access/adapters-context'
import {
  createDemoData,
  createMockAdapters,
  OUTLET_KALYANI_ID as KAL,
  personaFixtures,
} from '@/data-access/mock'
import { demoFixedCostFacts } from '@/data-access/mock/fixed-costs'
import type { OverviewMonth } from '@/data-access/overview'
import { addMonths, monthCost, monthOf, readProRata } from '@/domain/fixed-costs'
import { LedgerStatementSurface } from '@/features/cash/ledger-statement-surface'
import { OutletExpensesSurface } from '@/features/expenses/outlet-expenses-surface'
import { OutletsOverview } from '@/features/overview/outlets-overview'
import { SessionContext } from '@/session/context'
import { deriveSessionScope, type Session } from '@/session/session'
import { ChangeGatesForTest, describeChangeGate } from '@/test/change-gates'
import { FixedCostPage, FixedCostsSurface } from './fixed-costs-surface'
import { ProRataCard } from './ledger-fixed-costs'
import { overdueTone, overdueWords } from './words'
import { NeedsAttention } from '@/features/attention/needs-attention'

/**
 * The Fixed costs page, and `pro-rata-pnl`'s three toggle points: Overview's
 * P&L tile, the Ledger's month and the Fixed chip on Expenses
 * (fixed-costs-are-spread-over-the-month). Off, each reads as before.
 */
function sessionFor(role: 'super_admin' | 'franchise_admin'): Session {
  const persona = personaFixtures[role]
  return {
    mode: 'demo',
    userId: persona.profile.id,
    assignments: persona.assignments,
    ...deriveSessionScope(persona.assignments),
    displayName: persona.profile.full_name,
    persona,
  }
}

function renderWith(
  proRata: boolean,
  node: React.ReactNode,
  adapters: DataAdapters,
  role: 'super_admin' | 'franchise_admin' = 'super_admin',
  path = '/',
) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ChangeGatesForTest on={{ 'one-revenue': true, 'pro-rata-pnl': proRata }}>
        <SessionContext.Provider value={sessionFor(role)}>
          <AdaptersContext.Provider value={adapters}>{node}</AdaptersContext.Provider>
        </SessionContext.Provider>
      </ChangeGatesForTest>
    </MemoryRouter>,
  )
}

function withFixedCosts(role: 'super_admin' | 'franchise_admin' = 'super_admin') {
  const data = createDemoData({ fixedCosts: true })
  return { data, adapters: createMockAdapters(role, data) }
}

const month: OverviewMonth = {
  month: '2026-10',
  from: '2026-10-01',
  through: '2026-10-18',
  revenuePaise: 66_591_100,
  cashPaise: 30_000_000,
  upiPaise: 36_591_100,
  deliveryPaise: 0,
  commissionPaise: 0,
  waitingDays: 0,
  recordedExpensesPaise: 47_610_500,
  expensesPaise: 47_610_500,
  profitPaise: 18_980_600,
  hasSales: true,
  previous: {
    from: '2026-09-01',
    through: '2026-09-18',
    cutAt: null,
    revenuePaise: 0,
    hasSales: false,
  },
  fixedCosts: readProRata(
    [
      {
        id: 'f',
        name: 'Rent',
        category: 'rent',
        note: null,
        startsOn: '2026-10-01',
        stopsOn: null,
        amounts: [{ fromMonth: '2026-10-01', amountPaise: 32_270_000, createdAt: 'a' }],
        settlements: [],
        payments: [],
      },
    ],
    '2026-10-18',
  ),
}

describeChangeGate('pro-rata-pnl', (on) => {
  it('Overview leads with P&L (Pro-rata) and counts the unpaid share among expenses, or reads as before', async () => {
    const base = createMockAdapters('super_admin')
    const adapters: DataAdapters = {
      ...base,
      overview: {
        ...base.overview,
        month: async () => month,
        today: async () => ({ cashPaise: 0, upiPaise: 0, deliveryPaise: 0, openPaise: 0 }),
      },
    }
    renderWith(on, <OutletsOverview />, adapters)
    const card = await screen.findByTestId(`outlet-card-${KAL}`)
    const profit = await within(card).findByTestId(`profit-${KAL}`)
    if (on) {
      expect(within(card).getByText('October P&L (Pro-rata)')).toBeInTheDocument()
      // ₹1,89,806 less 18/31 of ₹3,22,700 (₹1,87,374.19) is ₹2,431.81.
      expect(profit).toHaveTextContent('₹2,431')
      expect(within(card).getByTestId(`pro-rata-expenses-${KAL}`)).toHaveTextContent('₹6.6L')
    } else {
      expect(within(card).getByText('October P&L · est.')).toBeInTheDocument()
      expect(profit).toHaveTextContent('₹1,89,806')
      expect(within(card).queryByTestId(`pro-rata-expenses-${KAL}`)).toBeNull()
    }
  })

  it('an outlet without fixed costs keeps its tile either way', async () => {
    const base = createMockAdapters('super_admin')
    const adapters: DataAdapters = {
      ...base,
      overview: {
        ...base.overview,
        month: async () => ({ ...month, fixedCosts: null }),
        today: async () => ({ cashPaise: 0, upiPaise: 0, deliveryPaise: 0, openPaise: 0 }),
      },
    }
    renderWith(on, <OutletsOverview />, adapters)
    const card = await screen.findByTestId(`outlet-card-${KAL}`)
    expect(await within(card).findByTestId(`profit-${KAL}`)).toHaveTextContent('₹1,89,806')
    expect(within(card).queryByText(/Pro-rata/)).toBeNull()
  })

  it('the Ledger’s current month carries P&L (Pro-rata) and the Fixed chip, or reads as before', async () => {
    const user = userEvent.setup()
    renderWith(
      on,
      <LedgerStatementSurface />,
      withFixedCosts('franchise_admin').adapters,
      'franchise_admin',
    )
    await waitFor(() => expect(screen.getByTestId('ledger-revenue')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'The month' }))
    await screen.findByTestId('month-profit')
    if (on) {
      const card = await screen.findByTestId('month-pro-rata')
      expect(within(card).getByText('P&L (Pro-rata)')).toBeInTheDocument()
      expect(
        within(screen.getByTestId('month-fixed-costs')).getByText(/Nayan \(Salary\)/),
      ).toBeInTheDocument()
    } else {
      expect(screen.queryByTestId('month-pro-rata')).toBeNull()
      expect(screen.queryByText(/Fixed$/)).toBeNull()
    }
  })

  it('Expenses marks a fixed-cost payment by its link and never a typed lookalike', async () => {
    const { data, adapters } = withFixedCosts()
    // A real payment today: the garbage, paid exactly.
    const garbage = data.store.fixedCosts.find((c) => c.name === 'Garbage')!
    const paymentId = 'a1000000-0000-4000-a000-000000000001'
    await adapters.fixedCosts.pay({
      id: paymentId,
      fixedCostId: garbage.id,
      amountPaise: 60_000,
      paidOn: data.store.today,
      countsIn: data.store.today,
      isCash: false,
      note: null,
      choice: null,
    })
    // A lookalike typed the same day, saying everything a payment says.
    await adapters.expenses.createExpense({
      outletId: KAL,
      businessDate: data.store.today,
      category: 'Salary',
      amountPaise: 400_000,
      isCash: false,
      note: 'Nayan [fixed]',
    })
    renderWith(on, <OutletExpensesSurface />, adapters, 'super_admin', `/?outlet=${KAL}`)
    await screen.findAllByText(/Salary|Nayan/)
    await screen.findByTestId('ledger-expense-list').catch(() => null)
    const chips = screen.queryAllByTestId(/^expense-fixed-/)
    if (on) {
      expect(screen.getByTestId(`expense-fixed-${paymentId}`)).toBeInTheDocument()
      expect(chips).toHaveLength(1)
    } else {
      expect(chips).toHaveLength(0)
    }
  })
})

it('lists each fixed cost with this month, and overdue and ahead apart from it', async () => {
  renderWith(
    false,
    <FixedCostsSurface />,
    withFixedCosts().adapters,
    'super_admin',
    `/?outlet=${KAL}`,
  )
  const list = await screen.findByTestId('fixed-cost-list')
  const santu = within(list).getByText('Santu').closest('tr')!
  expect(within(santu).getByTestId(/^status-/)).toHaveTextContent('₹10,000 paid')
  const nayan = within(list).getByText('Nayan').closest('tr')!
  expect(within(nayan).getByTestId(/^status-/)).toHaveTextContent('₹4,000 of ₹12,000 paid')
  const priyanka = within(list).getByText('Priyanka').closest('tr')!
  expect(within(priyanka).getByTestId(/^status-/)).toHaveTextContent('+ ₹3,300 overdue from Sep')
  const totals = screen.getByTestId('fixed-costs-totals')
  expect(within(totals).getByText('This month')).toBeInTheDocument()
  expect(within(totals).getByText('Paid')).toBeInTheDocument()
  expect(within(totals).getByText('Left to pay')).toBeInTheDocument()
  expect(screen.getByTestId('fixed-costs-overdue')).toHaveTextContent('Overdue from September')
})

it('pays from the row, starting at what is owed, and says where it was recorded', async () => {
  const user = userEvent.setup()
  const { data, adapters } = withFixedCosts()
  const nayan = data.store.fixedCosts.find((c) => c.name === 'Nayan')!
  renderWith(false, <FixedCostsSurface />, adapters, 'super_admin', `/?outlet=${KAL}`)
  await user.click(await screen.findByTestId(`pay-row-${nayan.id}`))
  expect(screen.getByTestId('fixed-cost-pay-amount')).toHaveValue('8000')
  await user.selectOptions(screen.getByTestId('fixed-cost-paid-with'), 'other')
  await user.click(screen.getByTestId('save-fixed-cost-payment'))
  expect(await screen.findByTestId('fixed-cost-recorded')).toHaveTextContent('Nayan recorded on')
})

it('asks why a payment differs from what was due, and makes Other say it', async () => {
  const user = userEvent.setup()
  const { data, adapters } = withFixedCosts()
  const nayan = data.store.fixedCosts.find((c) => c.name === 'Nayan')!
  render(
    <MemoryRouter initialEntries={[`/fixed-costs/${nayan.id}?outlet=${KAL}`]}>
      <ChangeGatesForTest on={{}}>
        <SessionContext.Provider value={sessionFor('super_admin')}>
          <AdaptersContext.Provider value={adapters}>
            <Routes>
              <Route path="/fixed-costs/:fixedCostId" element={<FixedCostPage />} />
            </Routes>
          </AdaptersContext.Provider>
        </SessionContext.Provider>
      </ChangeGatesForTest>
    </MemoryRouter>,
  )
  await user.click(await screen.findByTestId('pay-fixed-cost'))
  // What is owed sits above everything, and the amount starts at it.
  expect(screen.getByTestId('fixed-cost-pay-owed')).toHaveTextContent('Owes ₹8,000')
  expect(screen.getByTestId('fixed-cost-pay-amount')).toHaveValue('8000')
  expect(screen.queryByTestId('fixed-cost-pay-reasons')).toBeNull()

  await user.clear(screen.getByTestId('fixed-cost-pay-amount'))
  await user.type(screen.getByTestId('fixed-cost-pay-amount'), '1000')
  const reasons = await screen.findByTestId('fixed-cost-pay-reasons')
  // Part of a month still running: an advance from it, the month closed, or a cut for good.
  expect(within(reasons).getByText(/^Advance from /)).toBeInTheDocument()
  expect(within(reasons).getByText(/^That's all for /)).toBeInTheDocument()
  expect(within(reasons).getByText('Permanent pay cut')).toBeInTheDocument()

  await user.selectOptions(screen.getByTestId('fixed-cost-paid-with'), 'other')
  await user.click(within(reasons).getByTestId('pay-reason-other'))
  await user.click(screen.getByTestId('save-fixed-cost-payment'))
  expect(await screen.findByText('Say what it was.')).toBeInTheDocument()

  await user.type(screen.getByTestId('fixed-cost-pay-note'), 'Medical help')
  await user.click(screen.getByTestId('save-fixed-cost-payment'))
  await screen.findByTestId('fixed-cost-recorded')
  const expense = data.store.expenses.find((e) => e.description?.includes('Medical help'))
  expect(expense?.amount_paise).toBe(100_000)
})

it('names how far the month is from covering its fixed costs, and drops the line once covered', () => {
  const reading = {
    today: '2026-10-18',
    costs: [
      {
        id: 'f',
        name: 'Rent',
        category: 'rent' as const,
        note: null,
        startsOn: '2026-10-01',
        stopsOn: null,
        amounts: [{ fromMonth: '2026-10-01', amountPaise: 32_270_000, createdAt: 'a' }],
        settlements: [],
        payments: [],
      },
    ],
  }
  const { rerender } = render(
    <MemoryRouter>
      <ProRataCard month="2026-10" pnlPaise={18_936_800} reading={reading} fixedCostsPath="x" />
    </MemoryRouter>,
  )
  expect(screen.getByTestId('month-short-of-covering')).toHaveTextContent(
    'Short of covering October₹1,33,332',
  )
  rerender(
    <MemoryRouter>
      <ProRataCard month="2026-10" pnlPaise={40_000_000} reading={reading} fixedCostsPath="x" />
    </MemoryRouter>,
  )
  expect(screen.queryByTestId('month-short-of-covering')).toBeNull()
})

it('edits every field of a fixed cost from the title row', async () => {
  const user = userEvent.setup()
  const { data, adapters } = withFixedCosts()
  const garbage = data.store.fixedCosts.find((c) => c.name === 'Garbage')!
  render(
    <MemoryRouter initialEntries={[`/fixed-costs/${garbage.id}?outlet=${KAL}`]}>
      <ChangeGatesForTest on={{}}>
        <SessionContext.Provider value={sessionFor('super_admin')}>
          <AdaptersContext.Provider value={adapters}>
            <Routes>
              <Route path="/fixed-costs/:fixedCostId" element={<FixedCostPage />} />
            </Routes>
          </AdaptersContext.Provider>
        </SessionContext.Provider>
      </ChangeGatesForTest>
    </MemoryRouter>,
  )
  await user.click(await screen.findByTestId('edit-fixed-cost'))
  await user.clear(screen.getByTestId('fixed-cost-edit-name'))
  await user.type(screen.getByTestId('fixed-cost-edit-name'), 'Garbage pickup')
  await user.selectOptions(screen.getByTestId('fixed-cost-edit-category'), 'utility')
  await user.click(screen.getByTestId('save-fixed-cost-edit'))
  await waitFor(() => expect(garbage.name).toBe('Garbage pickup'))
  expect(garbage.category).toBe('utility')
})

it('starts on Exact, and Less or More is chosen on purpose or follows what is typed', async () => {
  const user = userEvent.setup()
  const { data, adapters } = withFixedCosts()
  const nayan = data.store.fixedCosts.find((c) => c.name === 'Nayan')!
  renderWith(false, <FixedCostsSurface />, adapters, 'super_admin', `/?outlet=${KAL}`)
  await user.click(await screen.findByTestId(`pay-row-${nayan.id}`))
  const amount = screen.getByTestId('fixed-cost-pay-amount')
  expect(screen.getByTestId('pay-aim-exact')).toHaveAttribute('aria-checked', 'true')
  expect(amount).toHaveValue('8000')

  // More on purpose: the amount above stays, selected, so the next keys replace it.
  await user.click(screen.getByTestId('pay-aim-more'))
  expect(screen.getByTestId('pay-aim-more')).toHaveAttribute('aria-checked', 'true')
  expect(amount).toHaveValue('8000')
  expect(amount).toHaveFocus()
  expect(screen.getByTestId('fixed-cost-pay-type-amount')).toBeInTheDocument()

  // What is typed decides: ₹6,000 is less than the ₹8,000 due.
  await user.keyboard('6000')
  expect(amount).toHaveValue('6000')
  expect(screen.getByTestId('pay-aim-less')).toHaveAttribute('aria-checked', 'true')

  await user.click(screen.getByTestId('pay-aim-exact'))
  expect(amount).toHaveValue('8000')
  expect(screen.queryByTestId('fixed-cost-pay-reasons')).toBeNull()
})

it('names the figures in every reason, and puts the switch back when the amount was not changed', async () => {
  const user = userEvent.setup()
  const { data, adapters } = withFixedCosts()
  const nayan = data.store.fixedCosts.find((c) => c.name === 'Nayan')!
  renderWith(false, <FixedCostsSurface />, adapters, 'super_admin', `/?outlet=${KAL}`)
  await user.click(await screen.findByTestId(`pay-row-${nayan.id}`))
  const amount = screen.getByTestId('fixed-cost-pay-amount')

  // ₹10,000 against ₹8,000 due on a ₹12,000 salary.
  await user.clear(amount)
  await user.type(amount, '10000')
  const reasons = await screen.findByTestId('fixed-cost-pay-reasons')
  expect(within(reasons).getByText(/owes ₹10,000 instead of ₹12,000/)).toBeInTheDocument()
  expect(within(reasons).getByText(/^Includes advance from /)).toBeInTheDocument()
  expect(within(reasons).getByText('Includes one-time bonus')).toBeInTheDocument()
  expect(within(reasons).getByText(/₹2,000 of it is bonus/)).toBeInTheDocument()
  expect(within(reasons).getByText('Permanent pay raise')).toBeInTheDocument()
  expect(within(reasons).getByText(/we pay ₹14,000 a month/)).toBeInTheDocument()

  // ₹1,000 of it now: the rest is named.
  await user.clear(amount)
  await user.type(amount, '1000')
  expect(
    within(screen.getByTestId('fixed-cost-pay-reasons')).getAllByText(
      /₹1,000 now, ₹7,000 of \w+ later/,
    ),
  ).not.toHaveLength(0)

  // Less chosen, then left without a new figure: the switch cannot say Less for ₹8,000.
  await user.click(screen.getByTestId('pay-aim-exact'))
  await user.click(screen.getByTestId('pay-aim-less'))
  expect(screen.getByTestId('pay-aim-less')).toHaveAttribute('aria-checked', 'true')
  await user.click(screen.getByTestId('fixed-cost-pay-owed'))
  expect(screen.getByTestId('pay-aim-exact')).toHaveAttribute('aria-checked', 'true')
})

it('points a refused Save at the field it was refused for, outlined, with the message under it', async () => {
  const user = userEvent.setup()
  const { data, adapters } = withFixedCosts()
  const nayan = data.store.fixedCosts.find((c) => c.name === 'Nayan')!
  renderWith(false, <FixedCostsSurface />, adapters, 'super_admin', `/?outlet=${KAL}`)
  await user.click(await screen.findByTestId(`pay-row-${nayan.id}`))
  await user.clear(screen.getByTestId('fixed-cost-pay-amount'))
  await user.type(screen.getByTestId('fixed-cost-pay-amount'), '18000')
  await user.click(screen.getByTestId('save-fixed-cost-payment'))

  // The reasons are the part to fix: outlined, shaken, and saying so beneath.
  const reasons = screen.getByTestId('fixed-cost-pay-reasons').parentElement!
  expect(reasons).toHaveAttribute('data-invalid')
  expect(within(reasons).getByRole('alert')).toHaveTextContent(
    'Say why it is different from what was due.',
  )

  // Choosing one clears it; the next refusal points at the next field.
  await user.click(screen.getByTestId('pay-reason-advance-next'))
  expect(reasons).not.toHaveAttribute('data-invalid')
  await user.click(screen.getByTestId('save-fixed-cost-payment'))
  const paidWith = screen.getByTestId('fixed-cost-paid-with').closest('[data-invalid]')
  expect(paidWith).not.toBeNull()
  expect(paidWith).toHaveTextContent('Choose what it was paid with.')
})

it('undoes a payment, taking back the new monthly amount and the settled month it recorded', async () => {
  const user = userEvent.setup()
  const { data, adapters } = withFixedCosts()
  const garbage = data.store.fixedCosts.find((c) => c.name === 'Garbage')!
  const facts = () => demoFixedCostFacts(data.store, garbage)
  const thisMonth = monthOf(data.store.today)
  const nextMonth = addMonths(thisMonth, 1)
  const paymentId = 'a1000000-0000-4000-a000-000000000002'
  // ₹800 against ₹600 owed, answered "Permanent new amount".
  await adapters.fixedCosts.pay({
    id: paymentId,
    fixedCostId: garbage.id,
    amountPaise: 80_000,
    paidOn: data.store.today,
    countsIn: data.store.today,
    isCash: false,
    note: null,
    choice: 'new-amount',
  })
  expect(monthCost(facts(), nextMonth)).toBe(80_000)
  expect(facts().settlements.some((s) => s.month === thisMonth && !s.voidedAt)).toBe(true)
  const link = data.store.fixedCostPayments.find((p) => p.expense_id === paymentId)!

  render(
    <MemoryRouter initialEntries={[`/fixed-costs/${garbage.id}?outlet=${KAL}`]}>
      <ChangeGatesForTest on={{}}>
        <SessionContext.Provider value={sessionFor('super_admin')}>
          <AdaptersContext.Provider value={adapters}>
            <Routes>
              <Route path="/fixed-costs/:fixedCostId" element={<FixedCostPage />} />
            </Routes>
          </AdaptersContext.Provider>
        </SessionContext.Provider>
      </ChangeGatesForTest>
    </MemoryRouter>,
  )
  await user.click(await screen.findByTestId(`undo-payment-${link.id}`))
  const dialog = await screen.findByRole('dialog')
  expect(dialog).toHaveTextContent('withdraws the ₹800 paid')
  expect(dialog).toHaveTextContent(`back to ₹600 a month`)
  await user.click(within(dialog).getByRole('button', { name: 'Undo' }))

  await waitFor(() => expect(monthCost(facts(), nextMonth)).toBe(60_000))
  expect(facts().settlements.some((s) => s.month === thisMonth && !s.voidedAt)).toBe(false)
  expect(data.store.expenses.find((e) => e.id === paymentId)?.voided_at).not.toBeNull()
})

it('offers a fixed-cost payment on Expenses only its note and its fixed cost’s page', async () => {
  const user = userEvent.setup()
  const { data, adapters } = withFixedCosts()
  const garbage = data.store.fixedCosts.find((c) => c.name === 'Garbage')!
  const paymentId = 'a1000000-0000-4000-a000-000000000003'
  await adapters.fixedCosts.pay({
    id: paymentId,
    fixedCostId: garbage.id,
    amountPaise: 60_000,
    paidOn: data.store.today,
    countsIn: data.store.today,
    isCash: false,
    note: 'October',
    choice: null,
  })
  renderWith(true, <OutletExpensesSurface />, adapters, 'super_admin', `/?outlet=${KAL}`)
  await screen.findByTestId(`expense-fixed-${paymentId}`)
  await user.click(screen.getByRole('button', { name: 'Actions for Other' }))
  expect(screen.getByTestId(`open-fixed-cost-of-${paymentId}`)).toHaveTextContent(
    "Change on Garbage's page",
  )
  expect(screen.queryByTestId(`withdraw-expense-${paymentId}`)).toBeNull()
  await user.click(screen.getByTestId(`edit-expense-${paymentId}`))
  expect(screen.queryByTestId('expense-amount')).toBeNull()
  const note = screen.getByTestId('expense-description')
  expect(note).toHaveValue('October')
  await user.clear(note)
  await user.type(note, 'October, late')
  await user.click(screen.getByRole('button', { name: /save/i }))
  await waitFor(() =>
    expect(data.store.expenses.find((e) => e.id === paymentId)?.description).toBe(
      'Garbage · October, late',
    ),
  )
  expect(data.store.expenses.find((e) => e.id === paymentId)?.amount_paise).toBe(60_000)
})

describe('money owed in Needs attention (owner, 2026-10-20)', () => {
  const owed = {
    count: 4,
    months: ['2026-10-01'],
    paise: 5_730_000,
    categories: { salary: 3, rent: 1 },
  }

  it('leads with the money, then each kind with its count, then the months', () => {
    expect(overdueWords(owed)).toBe('₹57,300 overdue · 3 salaries, 1 rent · from October')
    expect(overdueWords({ ...owed, count: 1, paise: 330_000, categories: { salary: 1 } })).toBe(
      '₹3,300 overdue · 1 salary · from October',
    )
    // A prorated month owes paise; Overview reads whole rupees.
    expect(overdueWords({ ...owed, count: 1, paise: 348_387, categories: { salary: 1 } })).toBe(
      '₹3,483 overdue · 1 salary · from October',
    )
  })

  it('is amber in the days last month is paid in, and red from the 6th or once older months are owed', () => {
    expect(overdueTone({ months: ['2026-10-01'], today: '2026-11-01' })).toBe('warning')
    expect(overdueTone({ months: ['2026-10-01'], today: '2026-11-05' })).toBe('warning')
    expect(overdueTone({ months: ['2026-10-01'], today: '2026-11-06' })).toBe('danger')
    expect(overdueTone({ months: ['2026-09-01', '2026-10-01'], today: '2026-11-02' })).toBe(
      'danger',
    )
  })

  it('lists it first, tinted, above attendance, which stays plain', async () => {
    const { adapters } = withFixedCosts()
    adapters.fixedCosts.unpaid = async () => ({ ...owed, today: '2026-11-02' })
    renderWith(false, <NeedsAttention />, adapters)
    const money = await screen.findByTestId('overview-attention-fixed-costs-unpaid')
    expect(money).toHaveTextContent('₹57,300 overdue · 3 salaries, 1 rent · from October')
    expect(money).toHaveAttribute('data-tone', 'warning')
    const attendance = await screen.findByTestId('overview-attention-attendance-waiting')
    expect(attendance).toHaveAttribute('data-tone', 'plain')
    const rows = screen.getAllByTestId(/^overview-attention-/)
    expect(rows[0]).toBe(money)
  })
})

it('leads the Fixed tab with what is overdue, named, and badges the tab as every tab is badged', async () => {
  const { adapters } = withFixedCosts()
  renderWith(false, <FixedCostsSurface />, adapters, 'super_admin', `/?outlet=${KAL}`)
  const list = await screen.findByTestId('fixed-cost-list')
  const rows = within(list).getAllByRole('row').slice(1)
  // Priyanka owes last month, so her row comes first whatever the order added.
  expect(rows[0]).toHaveTextContent('Priyanka')
  // Highlighted in the app's own orange, and only that row.
  expect(rows[0]).toHaveClass('bg-primary/10')
  expect(rows.slice(1).some((row) => row.classList.contains('bg-primary/10'))).toBe(false)
  // Pay is filled only where a month is overdue; owed this month is still Pay, outlined.
  expect(within(rows[0]!).getByRole('button', { name: 'Pay Priyanka' })).toHaveClass('bg-primary')
  expect(within(list).getByRole('button', { name: 'Pay Nayan' })).not.toHaveClass('bg-primary')
  expect(screen.getByTestId('fixed-costs-overdue')).toHaveTextContent(
    'Overdue from September · Priyanka',
  )
  // The app's own badge, inverted on the selected tab; amber and red are Overview's.
  const badge = await screen.findByTestId('expense-tab-fixed-owed')
  expect(badge).toHaveTextContent('1')
  expect(badge).toHaveClass('bg-on-primary')
  expect(screen.queryByText((_, node) => node?.getAttribute('data-tone') === 'danger')).toBeNull()
})
