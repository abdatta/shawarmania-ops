import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'

import type { DataAdapters } from '@/data-access/adapters'
import { AdaptersContext } from '@/data-access/adapters-context'
import { createMockAdapters, OUTLET_KALYANI_ID, OUTLET_KANCHRAPARA_ID } from '@/data-access/mock'
import { personaFixtures } from '@/data-access/mock/fixtures/personas'
import { PROFIT_BASIS_LABELS } from '@/domain'
import { SessionContext } from '@/session/context'
import type { Session } from '@/session/session'

import { ComparisonSurface } from './comparison-surface'
import { OutletDayView } from './outlet-day-view'
import { PnlSurface } from './pnl-surface'
import { ReportsSurface } from './reports-surface'

/**
 * The owner's period surfaces. The assertion that matters most across all of
 * them: **a profit figure never appears without the basis it was computed on**,
 * because the two bases answer different questions and mixing them is the
 * classic error in this domain.
 */

const ownerSession: Session = {
  mode: 'demo',
  userId: personaFixtures.super_admin.profile.id,
  role: 'super_admin',
  outletId: null,
  displayName: personaFixtures.super_admin.profile.full_name,
  persona: personaFixtures.super_admin,
}

const managerSession: Session = {
  mode: 'demo',
  userId: personaFixtures.franchise_admin.profile.id,
  role: 'franchise_admin',
  outletId: personaFixtures.franchise_admin.profile.outlet_id,
  displayName: personaFixtures.franchise_admin.profile.full_name,
  persona: personaFixtures.franchise_admin,
}

function renderSurface(
  ui: React.ReactNode,
  session: Session = ownerSession,
  adapters: DataAdapters = createMockAdapters(session.role),
  entry = '/',
) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <SessionContext.Provider value={session}>
        <AdaptersContext.Provider value={adapters}>{ui}</AdaptersContext.Provider>
      </SessionContext.Provider>
    </MemoryRouter>,
  )
}

/** `₹2,561` back to 256100 paise. */
function paiseFrom(text: string): number {
  return Math.round(Number(text.replace(/[₹,]/g, '')) * 100)
}

describe('ComparisonSurface', () => {
  it('puts both outlets side by side with different figures', async () => {
    renderSurface(<ComparisonSurface />)

    expect(await screen.findByText('Shawarmania Kalyani')).toBeInTheDocument()
    expect(screen.getByText('Shawarmania Kanchrapara')).toBeInTheDocument()

    const rows = screen.getAllByRole('row').slice(1)
    expect(rows).toHaveLength(2)
    // Two outlets of genuinely different sizes: a comparison of identical
    // shapes demonstrates nothing.
    const sales = rows.map((row) => within(row).getAllByRole('cell')[1]?.textContent ?? '')
    expect(sales[0]).not.toBe(sales[1])
  })

  it('states the period and the basis on screen, and restates them when they change', async () => {
    const user = userEvent.setup()
    renderSurface(<ComparisonSurface />)

    await screen.findByText('Shawarmania Kalyani')
    expect(screen.getByTestId('comparison-basis-note')).toHaveTextContent(PROFIT_BASIS_LABELS.cash)

    await user.selectOptions(screen.getByTestId('comparison-basis'), 'consumption')
    await waitFor(() =>
      expect(screen.getByTestId('comparison-basis-note')).toHaveTextContent(
        PROFIT_BASIS_LABELS.consumption,
      ),
    )
    expect(screen.getByTestId('comparison-basis-note')).toHaveTextContent(
      /food bought and food used are never both subtracted/i,
    )
  })

  it('changes the figures when the basis changes', async () => {
    const user = userEvent.setup()
    renderSurface(<ComparisonSurface />)

    await screen.findByText('Shawarmania Kalyani')
    const before = screen.getByTestId('comparison-total-profit').textContent

    await user.selectOptions(screen.getByTestId('comparison-basis'), 'consumption')
    await waitFor(() =>
      expect(screen.getByTestId('comparison-total-profit').textContent).not.toBe(before),
    )
  })
})

describe('PnlSurface', () => {
  it('never shows a profit figure without its basis', async () => {
    renderSurface(<PnlSurface />)

    const figure = await screen.findByTestId('pnl-profit')
    expect(figure).toHaveAttribute('data-basis', 'consumption')
    expect(screen.getByTestId('pnl-profit-basis')).toHaveTextContent(
      PROFIT_BASIS_LABELS.consumption,
    )
    expect(screen.getByTestId('pnl-profit-amount')).toBeInTheDocument()
  })

  it('restates the basis and recomputes the figure when it is switched', async () => {
    const user = userEvent.setup()
    renderSurface(<PnlSurface />)

    await screen.findByTestId('pnl-profit')
    const before = screen.getByTestId('pnl-profit-amount').textContent

    await user.selectOptions(screen.getByTestId('pnl-basis'), 'cash')
    await waitFor(() =>
      expect(screen.getByTestId('pnl-profit')).toHaveAttribute('data-basis', 'cash'),
    )
    expect(screen.getByTestId('pnl-profit-basis')).toHaveTextContent(PROFIT_BASIS_LABELS.cash)
    expect(screen.getByTestId('pnl-profit-amount').textContent).not.toBe(before)
  })

  it('shows the working, and it adds up to the figure', async () => {
    renderSurface(<PnlSurface />)

    const figure = await screen.findByTestId('pnl-profit')
    const amounts = within(figure)
      .getAllByRole('definition')
      .map((node) => paiseFrom(node.textContent ?? '0'))
    const total = paiseFrom(screen.getByTestId('pnl-profit-amount').textContent ?? '0')

    expect(amounts.reduce((running, value) => running + value, 0)).toBe(total)
  })

  it('says which expense the consumption basis is not subtracting', async () => {
    renderSurface(<PnlSurface />)

    const expenses = await screen.findByTestId('pnl-expenses')
    expect(expenses).toHaveTextContent(/not subtracted on this basis/i)
    expect(expenses).toHaveTextContent(/charge this period for the same food twice/i)
  })

  it('gives a manager their own outlet without an outlet picker', async () => {
    renderSurface(<PnlSurface />, managerSession)

    await screen.findByTestId('pnl-profit')
    // The owner belongs to no outlet and has to choose; a manager's is already
    // decided, so offering a control that can only pick one thing would be
    // offering a decision they do not have.
    expect(screen.queryByTestId('pnl-outlet')).not.toBeInTheDocument()
  })
})

describe('ReportsSurface', () => {
  it('summarises the period and breaks it down by day', async () => {
    renderSurface(<ReportsSurface />)

    expect(await screen.findByTestId('report-sales')).toBeInTheDocument()
    expect(screen.getByTestId('report-expenses-total')).toBeInTheDocument()
    expect(screen.getByTestId('report-profit-figure-basis')).toBeInTheDocument()
    expect(within(screen.getByTestId('report-days')).getAllByRole('row').length).toBeGreaterThan(1)
  })

  it('offers no way to export fabricated figures, and says why', async () => {
    renderSurface(<ReportsSurface />)

    await screen.findByTestId('report-sales')
    expect(screen.getByTestId('export-unavailable')).toHaveTextContent(/cannot be exported/i)

    // Not a disabled button — genuinely absent. There is nothing to press,
    // which is what makes exporting invented revenue impossible by
    // construction rather than by discipline.
    expect(screen.queryByRole('button', { name: /export|download/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /export|download/i })).not.toBeInTheDocument()
    expect(document.querySelector('a[download]')).toBeNull()
  })
})

describe('OutletDayView', () => {
  function renderOutlet(outletId: string) {
    return renderSurface(
      <Routes>
        <Route path="/owner/outlet/:outletId" element={<OutletDayView />} />
      </Routes>,
      ownerSession,
      createMockAdapters('super_admin'),
      `/owner/outlet/${outletId}`,
    )
  }

  it('states that it is read-only rather than implying it with missing buttons', async () => {
    renderOutlet(OUTLET_KALYANI_ID)

    expect(await screen.findByTestId('read-only-notice')).toHaveTextContent(
      /looking at this outlet, not working in it/i,
    )
  })

  it('shows the outlet’s day, its low stock and its open alerts', async () => {
    renderOutlet(OUTLET_KALYANI_ID)

    expect(await screen.findByTestId('outlet-day-sales')).toBeInTheDocument()
    expect(screen.getByTestId('outlet-day-stock')).toHaveTextContent('Pita bread')
    expect(screen.getByTestId('outlet-day-alerts')).toHaveTextContent(
      'Pita bread will not last tomorrow',
    )
  })

  it('shows the closed day’s difference when the day is closed', async () => {
    const user = userEvent.setup()
    renderOutlet(OUTLET_KALYANI_ID)

    const picker = await screen.findByTestId('outlet-day')
    const yesterday = [...picker.querySelectorAll('option')][1]?.value ?? ''
    await user.selectOptions(picker, yesterday)

    await waitFor(() =>
      expect(screen.getByTestId('outlet-day-difference')).toHaveAttribute(
        'data-difference',
        'short',
      ),
    )
  })

  it('shows the quiet outlet as quiet', async () => {
    renderOutlet(OUTLET_KANCHRAPARA_ID)

    expect(await screen.findByTestId('outlet-day-stock')).toHaveTextContent(
      /nothing is at its threshold/i,
    )
  })
})
