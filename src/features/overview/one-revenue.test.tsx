import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { expect, it } from 'vitest'

import type { DataAdapters } from '@/data-access/adapters'
import { AdaptersContext } from '@/data-access/adapters-context'
import { createMockAdapters, OUTLET_KALYANI_ID as KAL, personaFixtures } from '@/data-access/mock'
import type { OverviewMonth } from '@/data-access/overview'
import { LedgerStatementSurface } from '@/features/cash/ledger-statement-surface'
import { SessionContext } from '@/session/context'
import { deriveSessionScope, type Session } from '@/session/session'
import { ChangeGatesForTest, describeChangeGate } from '@/test/change-gates'
import { OutletsOverview } from './outlets-overview'

/**
 * One Revenue's toggle points on Overview and the Ledger
 * (revenue-reads-the-same-everywhere): off, each reads exactly as before; on,
 * the month runs through today, compares always, and commission is an expense.
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
  on: boolean,
  node: React.ReactNode,
  adapters: DataAdapters,
  role: 'super_admin' | 'franchise_admin',
) {
  return render(
    <MemoryRouter>
      <ChangeGatesForTest on={{ 'one-revenue': on }}>
        <SessionContext.Provider value={sessionFor(role)}>
          <AdaptersContext.Provider value={adapters}>{node}</AdaptersContext.Provider>
        </SessionContext.Provider>
      </ChangeGatesForTest>
    </MemoryRouter>,
  )
}

const month: OverviewMonth = {
  month: '2026-10',
  from: '2026-10-01',
  through: '2026-10-15',
  revenuePaise: 4_440_000,
  cashPaise: 1_000_000,
  upiPaise: 3_000_000,
  deliveryPaise: 440_000,
  commissionPaise: 120_000,
  waitingDays: 1,
  recordedExpensesPaise: 2_000_000,
  expensesPaise: 2_120_000,
  profitPaise: 2_320_000,
  hasSales: true,
  previous: {
    from: '2026-09-01',
    through: '2026-09-15',
    cutAt: '2026-09-15T10:10:00.000Z',
    revenuePaise: 4_000_000,
    hasSales: true,
  },
}

describeChangeGate('one-revenue', (on) => {
  it('Overview reads the month through today and always compares, or as before', async () => {
    const base = createMockAdapters('super_admin')
    const adapters: DataAdapters = {
      ...base,
      overview: {
        ...base.overview,
        month: async () => month,
        today: async () => ({ cashPaise: 359_500, upiPaise: 182_300, deliveryPaise: 0 }),
      },
    }
    renderWith(on, <OutletsOverview />, adapters, 'super_admin')
    const card = await screen.findByTestId(`outlet-card-${KAL}`)
    if (on) {
      expect(screen.getByText(/Month to date/)).toBeInTheDocument()
      expect(await within(card).findByTestId(`delivery-${KAL}`)).toBeInTheDocument()
      expect(await within(card).findByTestId(`revenue-${KAL}`)).toHaveTextContent('₹44,400')
      // 4,440,000 against 4,000,000 is up 11.0%, against the same dates.
      expect(await within(card).findByTestId(`comparison-${KAL}`)).toHaveTextContent(
        '11.0% vs 1–15 Sept',
      )
      expect(await within(card).findByTestId(`profit-${KAL}`)).toHaveTextContent('₹23,200')
      expect(within(card).queryByText(/Delivery data incomplete|Commission pending/)).toBeNull()
    } else {
      expect(screen.getByText(/Month through yesterday/)).toBeInTheDocument()
      await within(card).findByTestId(`sales-${KAL}`)
      expect(within(card).queryByTestId(`delivery-${KAL}`)).toBeNull()
    }
  })

  it('Overview says when the earlier dates had no sales, instead of hiding the comparison', async () => {
    const base = createMockAdapters('super_admin')
    const adapters: DataAdapters = {
      ...base,
      overview: {
        ...base.overview,
        month: async () => ({
          ...month,
          previous: { ...month.previous, revenuePaise: 0, hasSales: false },
        }),
        today: async () => ({ cashPaise: 0, upiPaise: 0, deliveryPaise: 0 }),
      },
    }
    renderWith(on, <OutletsOverview />, adapters, 'super_admin')
    const card = await screen.findByTestId(`outlet-card-${KAL}`)
    if (on)
      expect(await within(card).findByTestId(`comparison-${KAL}`)).toHaveTextContent(
        'No sales 1–15 Sept',
      )
    else expect(within(card).queryByTestId(`comparison-${KAL}`)).toBeNull()
  })

  it('the Ledger month counts delivery before commission and lists commission as an expense, or as before', async () => {
    const user = userEvent.setup()
    renderWith(
      on,
      <LedgerStatementSurface />,
      createMockAdapters('franchise_admin'),
      'franchise_admin',
    )
    await waitFor(() => expect(screen.getByTestId('ledger-revenue')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'The month' }))
    const revenue = await screen.findByTestId('month-revenue')
    if (on) {
      expect(within(revenue).getByText('Revenue')).toBeInTheDocument()
      expect(
        within(revenue).queryByText(/Revenue (actually received|received, at most)/),
      ).toBeNull()
      expect(screen.getByTestId('month-revenue-basis')).toHaveTextContent(
        'taken off once, in the expenses below',
      )
    } else {
      expect(
        within(revenue).getByText(/Revenue (actually received|received, at most)/),
      ).toBeInTheDocument()
      expect(screen.queryByTestId('month-revenue-basis')).toBeNull()
    }
  })
})
