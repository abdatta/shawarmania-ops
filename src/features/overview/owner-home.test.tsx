import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'

import type { DataAdapters } from '@/data-access/adapters'
import { AdaptersContext } from '@/data-access/adapters-context'
import { createMockAdapters, OUTLET_KALYANI_ID, OUTLET_KANCHRAPARA_ID } from '@/data-access/mock'
import { personaFixtures } from '@/data-access/mock/fixtures/personas'
import { createDemoStore } from '@/data-access/mock/store'
import { createSupabaseInsightsAdapter } from '@/data-access/supabase-adapters/oversight'
import { formatPaise } from '@/domain'
import { SessionContext } from '@/session/context'
import type { Session } from '@/session/session'
import { deriveSessionScope } from '@/session/session'

import { OwnerHome } from './owner-home'

/**
 * The owner console. Two things carry these tests: the figures on it are the
 * rows behind them, and an outlet whose figures cannot be resolved is still
 * listed with the absence stated — because the real adapter answers `null`
 * today and will until #13.
 */

const ownerSession: Session = {
  mode: 'demo',
  userId: personaFixtures.super_admin.profile.id,
  assignments: personaFixtures.super_admin.assignments,
  ...deriveSessionScope(personaFixtures.super_admin.assignments),
  displayName: personaFixtures.super_admin.profile.full_name,
  persona: personaFixtures.super_admin,
}

function renderConsole(
  adapters: DataAdapters = createMockAdapters('super_admin'),
  session: Session = ownerSession,
) {
  return {
    adapters,
    ...render(
      <MemoryRouter>
        <SessionContext.Provider value={session}>
          <AdaptersContext.Provider value={adapters}>
            <OwnerHome />
          </AdaptersContext.Provider>
        </SessionContext.Provider>
      </MemoryRouter>,
    ),
  }
}

describe('OwnerHome — the console', () => {
  it('shows every outlet side by side with its own figures', async () => {
    renderConsole()

    const kalyani = await screen.findByTestId(`outlet-card-${OUTLET_KALYANI_ID}`)
    const kanchrapara = await screen.findByTestId(`outlet-card-${OUTLET_KANCHRAPARA_ID}`)

    expect(within(kalyani).getByRole('heading')).toHaveTextContent('Shawarmania Kalyani')
    expect(within(kanchrapara).getByRole('heading')).toHaveTextContent('Shawarmania Kanchrapara')

    // Different outlets, genuinely different numbers — the whole reason the
    // console exists is that they can be compared at a glance.
    expect(screen.getByTestId(`sales-${OUTLET_KALYANI_ID}`).textContent).not.toBe(
      screen.getByTestId(`sales-${OUTLET_KANCHRAPARA_ID}`).textContent,
    )
  })

  it('shows a sales figure that is the sum of the bills behind it', async () => {
    const store = createDemoStore()
    renderConsole()

    const expected = store.bills
      .filter(
        (bill) =>
          bill.outlet_id === OUTLET_KALYANI_ID &&
          bill.business_date === store.today &&
          bill.status === 'settled',
      )
      .reduce((running, bill) => running + bill.total_paise, 0)

    expect(await screen.findByTestId(`sales-${OUTLET_KALYANI_ID}`)).toHaveTextContent(
      formatPaise(expected),
    )
  })

  it('names what needs attention, and only where it needs it', async () => {
    renderConsole()

    const kalyani = await screen.findByTestId(`attention-${OUTLET_KALYANI_ID}`)
    expect(kalyani).toHaveTextContent(/open alert/i)
    expect(kalyani).toHaveTextContent(/low on stock/i)
    // Yesterday's mismatch, surfaced on the console — today's difference is
    // null until somebody counts, so an owner would otherwise have to go
    // looking for it outlet by outlet.
    expect(kalyani).toHaveTextContent(/short/i)

    // The quiet outlet. It carries one low-priority alert on purpose, so the
    // owner's inbox is genuinely cross-outlet — but nothing is short and
    // nothing has run down, which is what makes Kalyani's row read as a
    // problem rather than as how the app always looks.
    const kanchrapara = await screen.findByTestId(`attention-${OUTLET_KANCHRAPARA_ID}`)
    expect(kanchrapara).not.toHaveTextContent(/low on stock/i)
    expect(kanchrapara).not.toHaveTextContent(/short|over/i)
  })

  it('says plainly when an outlet needs nothing at all', async () => {
    const base = createMockAdapters('super_admin')
    const adapters: DataAdapters = {
      ...base,
      insights: {
        ...base.insights,
        // A day with nothing wrong with it. The scenario deliberately has no
        // such outlet — every one of them carries at least an alert — so the
        // calm copy needs staging to be reviewed at all.
        async outletDay(outletId, businessDate) {
          const real = await base.insights.outletDay(outletId, businessDate)
          return real && { ...real, lowStockCount: 0, openAlertCount: 0, checkedInCount: 2 }
        },
      },
    }
    renderConsole(adapters)

    expect(await screen.findByTestId(`attention-${OUTLET_KANCHRAPARA_ID}`)).toHaveTextContent(
      /2 people checked in · nothing needs attention/i,
    )
  })

  it('scopes the console to one outlet, and offers only the outlets it was given', async () => {
    const user = userEvent.setup()
    renderConsole()

    const scope = await screen.findByTestId('outlet-scope')
    // Every option is an outlet the adapter returned, plus "all". Nothing here
    // can name an outlet the caller was not handed.
    const values = [...scope.querySelectorAll('option')].map((option) => option.value)
    expect(values).toContain('all')
    expect(values).toContain(OUTLET_KALYANI_ID)
    expect(values).toContain(OUTLET_KANCHRAPARA_ID)

    await user.selectOptions(scope, OUTLET_KANCHRAPARA_ID)
    expect(screen.getByTestId(`outlet-card-${OUTLET_KANCHRAPARA_ID}`)).toBeInTheDocument()
    expect(screen.queryByTestId(`outlet-card-${OUTLET_KALYANI_ID}`)).not.toBeInTheDocument()
  })

  it('links into each outlet at its own address', async () => {
    renderConsole()

    const link = await screen.findByTestId(`open-outlet-${OUTLET_KALYANI_ID}`)
    expect(link).toHaveAttribute('href', `/demo/owner/outlet/${OUTLET_KALYANI_ID}`)
  })

  it('lists an outlet whose figures are unavailable, rather than showing a zero', async () => {
    // Exactly what a signed-in owner meets today: real outlets, and an
    // insights adapter that honestly has nothing to report yet.
    const adapters: DataAdapters = {
      ...createMockAdapters('super_admin'),
      insights: createSupabaseInsightsAdapter(),
    }
    renderConsole(adapters, { ...ownerSession, mode: 'real' })

    const card = await screen.findByTestId(`outlet-card-${OUTLET_KALYANI_ID}`)
    expect(within(card).getByRole('heading')).toHaveTextContent('Shawarmania Kalyani')
    expect(screen.getByTestId(`no-figures-${OUTLET_KALYANI_ID}`)).toHaveTextContent(
      /not connected to live trading data/i,
    )
    // No fabricated figure anywhere on the card — an owner reading ₹0 would
    // conclude they took nothing today.
    expect(screen.queryByTestId(`sales-${OUTLET_KALYANI_ID}`)).not.toBeInTheDocument()

    // And the real-mode links stay outside /demo.
    expect(screen.getByTestId(`open-outlet-${OUTLET_KALYANI_ID}`)).toHaveAttribute(
      'href',
      `/owner/outlet/${OUTLET_KALYANI_ID}`,
    )
  })
})
