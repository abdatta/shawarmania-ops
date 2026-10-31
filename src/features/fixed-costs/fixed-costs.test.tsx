import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DataAdapters } from '@/data-access/adapters'
import { AdaptersContext } from '@/data-access/adapters-context'
import {
  createDemoData,
  createMockAdapters,
  OUTLET_KALYANI_ID as KAL,
  personaFixtures,
} from '@/data-access/mock'
import { demoFixedCostFacts, demoOutletFixedCosts } from '@/data-access/mock/fixed-costs'
import type { OverviewMonth } from '@/data-access/overview'
import {
  addMonths,
  dailySpreadPaise,
  monthCost,
  monthOf,
  readProRata,
  thisMonthStatus,
} from '@/domain/fixed-costs'
import { formatPaise } from '@/domain/money'
import { LedgerStatementSurface } from '@/features/cash/ledger-statement-surface'
import { OutletExpensesSurface } from '@/features/expenses/outlet-expenses-surface'
import { OutletsOverview } from '@/features/overview/outlets-overview'
import { SessionContext } from '@/session/context'
import { deriveSessionScope, type Session } from '@/session/session'
import { ChangeGatesForTest, describeChangeGate } from '@/test/change-gates'
import { FixedCostPage, FixedCostsSurface } from './fixed-costs-surface'
import { currentProRata, ProRataRows } from './ledger-fixed-costs'
import { overdueTone, overdueWords, shortMonths } from './words'
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
      <ChangeGatesForTest on={{ 'pro-rata-pnl': proRata }}>
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
      expect(within(card).getByTestId(`pro-rata-expenses-${KAL}`)).toHaveTextContent('₹6.63L')
      // The margin beside the figure, and ₹1,89,806 less all ₹3,22,700 beneath it.
      expect(within(card).getByTestId(`margin-${KAL}`)).toHaveTextContent('0.4%')
      expect(within(card).getByTestId(`covering-${KAL}`).parentElement).toHaveTextContent(
        /· Short ₹1\.33L$/,
      )
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
    const lookalike = await adapters.expenses.createExpense({
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
    // Asserted on the two rows made here, never on a count: a payment of the
    // demo's own falls in the days shown near a month's turn (found 2026-10-20).
    expect(screen.queryByTestId(`expense-fixed-${lookalike.id}`)).toBeNull()
    if (on) expect(screen.getByTestId(`expense-fixed-${paymentId}`)).toBeInTheDocument()
    else expect(screen.queryAllByTestId(/^expense-fixed-/)).toHaveLength(0)
  })
})

it('lists each fixed cost with this month, and overdue and ahead apart from it', async () => {
  const { data, adapters } = withFixedCosts()
  renderWith(false, <FixedCostsSurface />, adapters, 'super_admin', `/?outlet=${KAL}`)
  const list = await screen.findByTestId('fixed-cost-list')
  const santu = within(list).getByText('Santu').closest('tr')!
  expect(within(santu).getByTestId(/^status-/)).toHaveTextContent('₹10,000 paid')
  const nayan = within(list).getByText('Nayan').closest('tr')!
  expect(within(nayan).getByTestId(/^status-/)).toHaveTextContent('₹4,000 of ₹12,000 paid')
  const priyanka = within(list).getByText('Priyanka').closest('tr')!
  // She joined on last month's 20th, so what she is owed, and its month, move
  // with the demo's today: read from the demo's own facts, never a date's.
  const joined = data.store.fixedCosts.find((c) => c.name === 'Priyanka')!
  const owed = thisMonthStatus(demoFixedCostFacts(data.store, joined), data.store.today).overdue
  expect(within(priyanka).getByTestId(/^status-/)).toHaveTextContent(
    `+ ${formatPaise(owed[0]!.paise)} overdue from ${shortMonths([owed[0]!.month])}`,
  )
  const totals = screen.getByTestId('fixed-costs-totals')
  expect(within(totals).getByText('This month')).toBeInTheDocument()
  // Paid gave way to what the month's fixed costs come to a day, in whole rupees.
  expect(within(totals).queryByText('Paid')).toBeNull()
  const perDay = dailySpreadPaise(demoOutletFixedCosts(data.store, KAL), data.store.today)
  expect(within(totals).getByText('Per day').parentElement).toHaveTextContent(
    formatPaise(perDay - (perDay % 100)),
  )
  expect(within(totals).getByText('Left to pay')).toBeInTheDocument()
  // Overdue is said on its row alone, not again above the list (owner, 2026-10-20).
  expect(screen.queryByTestId('fixed-costs-overdue')).toBeNull()
})

it('rings what is paid of what is owed, overdue included, and ticks a cost paid in full', async () => {
  const { data, adapters } = withFixedCosts()
  renderWith(false, <FixedCostsSurface />, adapters, 'super_admin', `/?outlet=${KAL}`)
  const list = await screen.findByTestId('fixed-cost-list')
  const ring = (name: string) =>
    within(within(list).getByText(name).closest('tr')!).getByTestId(/^paid-ring-/)
  // Paid in full: the attendance list's Present tick, an outline, not a disc.
  expect(ring('Santu')).toHaveAttribute('data-paid', 'all')
  expect(ring('Santu').querySelector('.lucide-circle-check')).toHaveClass('text-success')
  // ₹4,000 of ₹12,000: a third of the ring.
  expect(ring('Nayan')).toHaveAttribute('data-paid', String(4_000 / 12_000))
  // Nothing paid this month and a month overdue: an empty ring of the whole.
  const joined = data.store.fixedCosts.find((c) => c.name === 'Priyanka')!
  const status = thisMonthStatus(demoFixedCostFacts(data.store, joined), data.store.today)
  expect(status.paidPaise).toBe(0)
  expect(ring('Priyanka')).toHaveAttribute('data-paid', '0')
})

it('pays from the row, starting at what is owed, and says where it was recorded', async () => {
  const user = userEvent.setup()
  const { data, adapters } = withFixedCosts()
  const nayan = data.store.fixedCosts.find((c) => c.name === 'Nayan')!
  renderWith(false, <FixedCostsSurface />, adapters, 'super_admin', `/?outlet=${KAL}`)
  await user.click(await screen.findByTestId(`pay-row-${nayan.id}`))
  // The row stays lit for a moment before its sheet opens (owner, 2026-10-21).
  await screen.findByTestId('fixed-cost-pay-amount')
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

it('says how far the month is short of covering its fixed costs, then how far ahead', () => {
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
  const proRata = currentProRata('2026-10', reading)!
  const { rerender } = render(
    <MemoryRouter>
      <ProRataRows pnlPaise={18_936_800} proRata={proRata} fixedCostsPath="x" />
    </MemoryRouter>,
  )
  expect(screen.getByTestId('month-covering')).toHaveTextContent(
    'Short of covering October, explain: what short of covering means₹1,33,332',
  )
  expect(screen.getByTestId('month-pro-rata-covered')).toHaveTextContent('58%')
  rerender(
    <MemoryRouter>
      <ProRataRows pnlPaise={35_000_000} proRata={proRata} fixedCostsPath="x" />
    </MemoryRouter>,
  )
  expect(screen.getByTestId('month-covering')).toHaveTextContent(
    'Ahead of covering October, explain: what ahead of covering means₹27,300',
  )
  expect(screen.getByTestId('month-pro-rata-covered')).toHaveTextContent('100%')
})

it('reads no fixed costs for a month that is not the current one', () => {
  expect(currentProRata('2026-09', { today: '2026-10-18', costs: [] })).toBeNull()
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
  // The row stays lit for a moment before its sheet opens (owner, 2026-10-21).
  await screen.findByTestId('fixed-cost-pay-amount')
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
  // The row stays lit for a moment before its sheet opens (owner, 2026-10-21).
  await screen.findByTestId('fixed-cost-pay-amount')
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
  // The row stays lit for a moment before its sheet opens (owner, 2026-10-21).
  await screen.findByTestId('fixed-cost-pay-amount')
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

  it('is due in the days last month is paid in, and late from the 6th or once older months are owed', () => {
    expect(overdueTone({ months: ['2026-10-01'], today: '2026-11-01' })).toBe('due')
    expect(overdueTone({ months: ['2026-10-01'], today: '2026-11-05' })).toBe('due')
    expect(overdueTone({ months: ['2026-10-01'], today: '2026-11-06' })).toBe('late')
    expect(overdueTone({ months: ['2026-09-01', '2026-10-01'], today: '2026-11-02' })).toBe('late')
  })

  it('lists it first, tinted, above attendance, which stays plain', async () => {
    const { adapters } = withFixedCosts()
    adapters.fixedCosts.unpaid = async () => ({ ...owed, today: '2026-11-02' })
    renderWith(false, <NeedsAttention />, adapters)
    const money = await screen.findByTestId('overview-attention-fixed-costs-unpaid')
    expect(money).toHaveTextContent('₹57,300 overdue · 3 salaries, 1 rent · from October')
    expect(money).toHaveAttribute('data-tone', 'due')
    const attendance = await screen.findByTestId('overview-attention-attendance-waiting')
    expect(attendance).toHaveAttribute('data-tone', 'plain')
    const rows = screen.getAllByTestId(/^overview-attention-/)
    expect(rows[0]).toBe(money)
  })
})

it('leads the Fixed tab with what is overdue, highlighted, and badges the tab as every tab is badged', async () => {
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
  // The app's own badge, inverted on the selected tab; the due and late tones are Overview's.
  const badge = await screen.findByTestId('expense-tab-fixed-owed')
  expect(badge).toHaveTextContent('1')
  expect(badge).toHaveClass('bg-on-primary')
  expect(screen.queryByText((_, node) => node?.getAttribute('data-tone') === 'late')).toBeNull()
})

it('opens Daily on the day the address asks for, as Recorded on … · View links it', async () => {
  const { data, adapters } = withFixedCosts()
  const asked: string[][] = []
  const list = adapters.expenses.listRecentExpenses.bind(adapters.expenses)
  adapters.expenses.listRecentExpenses = async (outletId, dates) => {
    asked.push([...dates])
    return list(outletId, dates)
  }
  // Three days back from the demo's today: a day the page would never open on.
  const [y, m, d] = data.store.today.split('-').map(Number) as [number, number, number]
  const day = new Date(Date.UTC(y, m - 1, d - 3)).toISOString().slice(0, 10)
  renderWith(
    false,
    <OutletExpensesSurface />,
    adapters,
    'super_admin',
    `/?outlet=${KAL}&date=${day}`,
  )
  await waitFor(() => expect(asked.length).toBeGreaterThan(0))
  expect(asked[0]).toEqual([day])
})

it('keeps the row being paid, and its Pay, lit while the sheet is open', async () => {
  const user = userEvent.setup()
  const { data, adapters } = withFixedCosts()
  const nayan = data.store.fixedCosts.find((c) => c.name === 'Nayan')!
  renderWith(false, <FixedCostsSurface />, adapters, 'super_admin', `/?outlet=${KAL}`)
  const pay = await screen.findByTestId(`pay-row-${nayan.id}`)
  await user.click(pay)
  await screen.findByTestId('fixed-cost-pay-amount')
  expect(screen.getByTestId(`pay-row-${nayan.id}`)).toHaveAttribute('data-selected', 'true')
  // A tint, no border of its own; the pill's own border turns orange.
  const row = screen.getByTestId(`pay-row-${nayan.id}`).closest('tr')!
  expect(row).toHaveClass('bg-primary/20')
  expect(row).not.toHaveClass('ring-2')
  expect(screen.getByTestId(`pay-row-${nayan.id}`)).toHaveClass('border-primary')
  const others = screen
    .getAllByTestId(/^pay-row-/)
    .filter((b) => b !== screen.getByTestId(`pay-row-${nayan.id}`))
  expect(others.some((b) => b.hasAttribute('data-selected'))).toBe(false)
})

it('lights the tapped row for a moment before its sheet opens, so the tap is seen', async () => {
  const user = userEvent.setup()
  const { data, adapters } = withFixedCosts()
  const santu = data.store.fixedCosts.find((c) => c.name === 'Santu')!
  renderWith(false, <FixedCostsSurface />, adapters, 'super_admin', `/?outlet=${KAL}`)
  await user.click(await screen.findByTestId(`pay-row-${santu.id}`))
  // Lit at once, the sheet not yet open.
  expect(screen.getByTestId(`pay-row-${santu.id}`)).toHaveAttribute('data-selected', 'true')
  expect(screen.queryByTestId('fixed-cost-pay-amount')).toBeNull()
  // Then the sheet, with the row still lit behind it.
  await screen.findByTestId('fixed-cost-pay-amount')
  expect(screen.getByTestId(`pay-row-${santu.id}`)).toHaveAttribute('data-selected', 'true')
})

it('tints a row tapped to open its page, and leaves its Pay alone', async () => {
  const user = userEvent.setup()
  const { data, adapters } = withFixedCosts()
  const santu = data.store.fixedCosts.find((c) => c.name === 'Santu')!
  renderWith(false, <FixedCostsSurface />, adapters, 'super_admin', `/?outlet=${KAL}`)
  await user.click(await screen.findByTestId(`open-fixed-cost-${santu.id}`))
  expect(screen.getByTestId(`pay-row-${santu.id}`).closest('tr')).toHaveClass('bg-primary/20')
  expect(screen.getByTestId(`pay-row-${santu.id}`)).not.toHaveAttribute('data-selected')
  expect(screen.getByTestId(`pay-row-${santu.id}`)).not.toHaveClass('border-primary')
})

/**
 * `agreed-part-months` (part-months-cost-what-was-agreed): a part month costs
 * the figure agreed for it, stopping asks for the final payment, and a stopped
 * cost keeps its place for the month it stopped in. Off, the day share and the
 * Stopped section as before. Read on 30 October, Jayanta Da's case.
 */
describeChangeGate('agreed-part-months', (on) => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-30T06:00:00Z')) // 30 Oct, 11:30 in Kolkata.
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  /** ₹6,000 a month from 1 October, ₹2,000 paid on the 21st. */
  async function jayanta(adapters: DataAdapters) {
    const cost = await adapters.fixedCosts.add({
      outletId: KAL,
      name: 'Jayanta',
      category: 'salary',
      monthlyPaise: 600_000,
      startsOn: '2026-10-01',
      note: null,
    })
    await adapters.fixedCosts.pay({
      id: crypto.randomUUID(),
      fixedCostId: cost.id,
      amountPaise: 200_000,
      paidOn: '2026-10-21',
      countsIn: '2026-10-21',
      isCash: false,
      note: 'Advance',
      choice: null,
    })
    return cost.id
  }

  function renderPage(adapters: DataAdapters, id: string) {
    return render(
      <MemoryRouter initialEntries={[`/fixed-costs/${id}?outlet=${KAL}`]}>
        <ChangeGatesForTest on={{ 'agreed-part-months': on }}>
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
  }

  function renderList(adapters: DataAdapters) {
    return render(
      <MemoryRouter initialEntries={[`/?outlet=${KAL}`]}>
        <ChangeGatesForTest on={{ 'agreed-part-months': on }}>
          <SessionContext.Provider value={sessionFor('super_admin')}>
            <AdaptersContext.Provider value={adapters}>
              <FixedCostsSurface />
            </AdaptersContext.Provider>
          </SessionContext.Provider>
        </ChangeGatesForTest>
      </MemoryRouter>,
    )
  }

  it('Stop asks for the final payment and closes October at what was paid plus it, or keeps the day share', async () => {
    const user = userEvent.setup()
    const { data, adapters } = withFixedCosts()
    const id = await jayanta(adapters)
    renderPage(adapters, id)
    await user.click(await screen.findByTestId('stop-fixed-cost'))
    fireEvent.change(screen.getByLabelText('Last day'), { target: { value: '2026-10-28' } })
    if (!on) {
      expect(screen.queryByTestId('fixed-cost-final')).toBeNull()
      expect(screen.getByText(/In October we pay ₹5,419\.35, then nothing more\./)).toBeVisible()
      return
    }
    // Empty to start, and the month said as it is typed.
    expect(screen.getByTestId('fixed-cost-final')).toHaveValue('')
    expect(screen.getByText('On top of ₹2,000 already paid in October.')).toBeVisible()
    expect(screen.getByLabelText('Any final payment at close? (₹)')).toBeVisible()
    // Typed every time, 0 for nothing: no shortcut, no paying later (owner, 2026-10-31).
    expect(screen.queryByText('Nothing more')).toBeNull()
    expect(screen.queryByText('Paying later')).toBeNull()
    await user.click(screen.getByTestId('save-fixed-cost-stop'))
    expect(await screen.findByText(/or 0 if nothing was/)).toBeVisible()
    await user.type(screen.getByTestId('fixed-cost-final'), '2000')
    expect(screen.getByTestId('fixed-cost-comes-to')).toHaveTextContent('October comes to ₹4,000')
    await user.selectOptions(screen.getByTestId('fixed-cost-final-paid-with'), 'other')
    await user.click(screen.getByTestId('save-fixed-cost-stop'))

    expect(await screen.findByTestId('fixed-cost-recorded')).toHaveTextContent('28 Oct')
    const row = data.store.fixedCosts.find((c) => c.id === id)!
    expect(monthCost(demoFixedCostFacts(data.store, row), '2026-10-01')).toBe(400_000)
    const final = data.store.expenses.find((e) => e.description === 'Jayanta · Final payment')
    expect(final).toMatchObject({ amount_paise: 200_000, business_date: '2026-10-28' })
    // The month reads as its closing, with Change, and no day count.
    const october = await screen.findByTestId('month-2026-10-01')
    expect(october).toHaveTextContent('Paid · closing')
    expect(october).not.toHaveTextContent('days')
    expect(
      within(october).getByRole('button', { name: /Change what October comes to/ }),
    ).toBeVisible()
    // Stopped is done: no Stop again, and nothing to Pay (owner, 2026-10-31).
    expect(screen.queryByTestId('stop-fixed-cost')).toBeNull()
    expect(screen.queryByTestId('pay-fixed-cost')).toBeNull()
    expect(screen.getByTestId('fixed-cost-stopped')).toHaveTextContent('Stopped')
  })

  it('0 at close closes at what was paid, closes a short earlier month too, and stops once', async () => {
    const { data, adapters } = withFixedCosts()
    const nothing = await jayanta(adapters)
    const facts = (id: string) =>
      demoFixedCostFacts(
        data.store,
        data.store.fixedCosts.find((c) => c.id === id)!,
      )
    if (!on) {
      // The day share, untouched.
      await adapters.fixedCosts.stop(nothing, '2026-10-28', false)
      expect(monthCost(facts(nothing), '2026-10-01')).toBe(541_935)
      return
    }
    await adapters.fixedCosts.close({
      fixedCostId: nothing,
      stopsOn: '2026-10-28',
      finalPaise: 0,
      payment: null,
    })
    expect(monthCost(facts(nothing), '2026-10-01')).toBe(200_000)
    await expect(
      adapters.fixedCosts.close({
        fixedCostId: nothing,
        stopsOn: '2026-10-28',
        finalPaise: 200_000,
        payment: null,
      }),
    ).rejects.toThrow('It is already stopped.')
    await expect(
      adapters.fixedCosts.close({
        fixedCostId: await jayanta(adapters),
        stopsOn: '2026-11-02',
        finalPaise: 0,
        payment: null,
      }),
    ).rejects.toThrow('It stops today or on a day already gone.')

    // Priyanka owes September in the demo: stopping in October closes it at what it covered.
    const listed = await adapters.fixedCosts.list(KAL)
    const priyanka = listed.costs.find((c) => c.name === 'Priyanka')!
    expect(thisMonthStatus(priyanka, '2026-10-30').overdue).not.toHaveLength(0)
    await adapters.fixedCosts.close({
      fixedCostId: priyanka.id,
      stopsOn: '2026-10-30',
      finalPaise: 0,
      payment: null,
    })
    const after = thisMonthStatus(facts(priyanka.id), '2026-10-30')
    expect(after.overdue).toHaveLength(0)
    expect(after.leftPaise).toBe(0)
  })

  it('stopping today is done at once', async () => {
    const { adapters } = withFixedCosts()
    const id = await jayanta(adapters)
    if (!on) return
    await adapters.fixedCosts.close({
      fixedCostId: id,
      stopsOn: '2026-10-30',
      finalPaise: 0,
      payment: null,
    })
    renderList(adapters)
    const row = within(await screen.findByTestId('fixed-cost-list'))
      .getByText('Jayanta')
      .closest('tr')!
    expect(within(row).getByTestId(`paid-ring-${id}`)).toHaveAttribute('data-paid', 'done')
    expect(within(row).queryByRole('button', { name: 'Pay Jayanta' })).toBeNull()
  })

  it('a cost stopped before the change offers Close, not Pay', async () => {
    const user = userEvent.setup()
    const { data, adapters } = withFixedCosts()
    const id = await jayanta(adapters)
    await adapters.fixedCosts.stop(id, '2026-10-28', false)
    renderList(adapters)
    const list = await screen.findByTestId('fixed-cost-list')
    if (!on) {
      expect(within(list).queryByText('Jayanta')).toBeNull()
      return
    }
    expect(within(list).queryByRole('button', { name: 'Pay Jayanta' })).toBeNull()
    await user.click(within(list).getByRole('button', { name: 'Close Jayanta' }))
    void data
  })

  it('a stopped cost keeps its place this month, done with a red cross, or sits under Stopped', async () => {
    const { adapters } = withFixedCosts()
    const id = await jayanta(adapters)
    if (on)
      await adapters.fixedCosts.close({
        fixedCostId: id,
        stopsOn: '2026-10-28',
        finalPaise: 200_000,
        payment: { id: crypto.randomUUID(), isCash: false },
      })
    else await adapters.fixedCosts.stop(id, '2026-10-28', false)
    renderList(adapters)
    const list = await screen.findByTestId('fixed-cost-list')
    if (!on) {
      expect(within(list).queryByText('Jayanta')).toBeNull()
      expect(
        within(screen.getByRole('region', { name: 'Stopped' })).getByText('Jayanta'),
      ).toBeVisible()
      return
    }
    const row = within(list).getByText('Jayanta').closest('tr')!
    expect(row).toHaveTextContent('Salary · Stopped')
    expect(row).not.toHaveTextContent('28 Oct')
    expect(row).not.toHaveTextContent('days')
    expect(within(row).getByTestId(`paid-ring-${id}`)).toHaveAttribute('data-paid', 'done')
    expect(within(row).queryByRole('button', { name: 'Pay Jayanta' })).toBeNull()
    expect(screen.queryByTestId('stopped-fixed-costs')).toBeNull()
  })

  it('a stopped cost keeps the place it was added in, though the read lists it last', async () => {
    const { adapters } = withFixedCosts()
    const listed = await adapters.fixedCosts.list(KAL)
    const nayan = listed.costs.find((c) => c.name === 'Nayan')!
    await adapters.fixedCosts.close({
      fixedCostId: nayan.id,
      stopsOn: '2026-10-28',
      finalPaise: 0,
      payment: null,
    })
    renderList(adapters)
    const list = await screen.findByTestId('fixed-cost-list')
    const names = within(list)
      .getAllByRole('link')
      .map((link) => link.querySelector('span')?.textContent)
    if (on) expect(names.indexOf('Nayan')).toBeLessThan(names.indexOf('Santu'))
    else expect(names).not.toContain('Nayan')
  })

  it('a cost stopped last month waits behind one line', async () => {
    const user = userEvent.setup()
    const { adapters } = withFixedCosts()
    // Garbage, paid in full for September in the demo, stopped on its last day.
    const listed = await adapters.fixedCosts.list(KAL)
    const garbage = listed.costs.find((c) => c.name === 'Garbage')!
    if (on)
      await adapters.fixedCosts.close({
        fixedCostId: garbage.id,
        stopsOn: '2026-09-30',
        finalPaise: 0,
        payment: null,
      })
    else await adapters.fixedCosts.stop(garbage.id, '2026-09-30', false)
    renderList(adapters)
    const list = await screen.findByTestId('fixed-cost-list')
    expect(within(list).queryByText('Garbage')).toBeNull()
    if (!on) {
      expect(
        within(screen.getByRole('region', { name: 'Stopped' })).getByText('Garbage'),
      ).toBeVisible()
      return
    }
    const line = screen.getByTestId('show-stopped-fixed-costs')
    expect(line).toHaveTextContent('Stopped · 1 · Show')
    expect(screen.queryByText('Garbage')).toBeNull()
    await user.click(line)
    expect(within(screen.getByTestId('stopped-fixed-costs')).getByText('Garbage')).toBeVisible()
  })

  it('a mid-month start asks what that month comes to', async () => {
    const user = userEvent.setup()
    const { data, adapters } = withFixedCosts()
    renderList(adapters)
    await screen.findByTestId('fixed-cost-list')
    await user.click(screen.getByRole('button', { name: 'Add a fixed cost' }))
    await user.type(await screen.findByTestId('fixed-cost-name'), 'Ravi')
    await user.selectOptions(screen.getByTestId('fixed-cost-category'), 'salary')
    await user.type(screen.getByTestId('fixed-cost-amount'), '10000')
    fireEvent.change(screen.getByTestId('fixed-cost-starts'), { target: { value: '2026-10-20' } })
    if (!on) {
      expect(screen.queryByTestId('fixed-cost-first-month')).toBeNull()
      expect(screen.getByText(/we pay only for the days from/)).toBeVisible()
      return
    }
    expect(screen.queryByText(/we pay only for the days from/)).toBeNull()
    expect(screen.getByText('From November, ₹10,000 a month.')).toBeVisible()
    await user.click(screen.getByTestId('save-fixed-cost'))
    expect(await screen.findByText('Say what October comes to, in whole rupees.')).toBeVisible()
    await user.type(screen.getByTestId('fixed-cost-first-month'), '3500')
    await user.click(screen.getByTestId('save-fixed-cost'))
    await waitFor(() => expect(data.store.fixedCosts.some((c) => c.name === 'Ravi')).toBe(true))
    const ravi = data.store.fixedCosts.find((c) => c.name === 'Ravi')!
    expect(monthCost(demoFixedCostFacts(data.store, ravi), '2026-10-01')).toBe(350_000)
  })
})
