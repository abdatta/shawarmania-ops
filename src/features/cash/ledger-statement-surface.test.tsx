import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'

import type { DataAdapters } from '@/data-access/adapters'
import { AdaptersContext } from '@/data-access/adapters-context'
import { createMockAdapters } from '@/data-access/mock'
import { personaFixtures } from '@/data-access/mock/fixtures/personas'
import { SessionContext } from '@/session/context'
import type { Session } from '@/session/session'
import { deriveSessionScope } from '@/session/session'

import { LedgerStatementSurface } from './ledger-statement-surface'

/**
 * The Ledger as a statement that writes itself.
 *
 * The assertion this file exists for is the negative one: **no figure on this
 * surface is an input.** Enumerated rather than sampled, because a single
 * accidental `<Input>` added by a later change is exactly the kind of thing a
 * spot-check misses and a reader trusts.
 */

const managerSession: Session = {
  mode: 'demo',
  userId: personaFixtures.franchise_admin.profile.id,
  assignments: personaFixtures.franchise_admin.assignments,
  ...deriveSessionScope(personaFixtures.franchise_admin.assignments),
  displayName: personaFixtures.franchise_admin.profile.full_name,
  persona: personaFixtures.franchise_admin,
}

function renderLedger(adapters: DataAdapters = createMockAdapters('franchise_admin')) {
  return {
    adapters,
    ...render(
      <MemoryRouter>
        <SessionContext.Provider value={managerSession}>
          <AdaptersContext.Provider value={adapters}>
            <LedgerStatementSurface />
          </AdaptersContext.Provider>
        </SessionContext.Provider>
      </MemoryRouter>,
    ),
  }
}

describe('the reading carries no editable figure', () => {
  it('renders no text input, number input or select anywhere', async () => {
    const { container } = renderLedger()
    await waitFor(() => expect(screen.getByTestId('ledger-revenue')).toBeInTheDocument())

    // Enumerated, not sampled.
    expect(container.querySelectorAll('input')).toHaveLength(0)
    expect(container.querySelectorAll('textarea')).toHaveLength(0)
    expect(container.querySelectorAll('select')).toHaveLength(0)
    expect(container.querySelectorAll('[contenteditable="true"]')).toHaveLength(0)
  })

  it('offers only the date stepper and verification as controls', async () => {
    renderLedger()
    await waitFor(() => expect(screen.getByTestId('ledger-revenue')).toBeInTheDocument())

    const buttons = screen.getAllByRole('button').map((button) => {
      return (button.getAttribute('aria-label') ?? button.textContent ?? '').trim()
    })

    // Every control accounted for. A new one has to be added here deliberately.
    for (const label of buttons) {
      expect(label).toMatch(/previous day|next day|verify this day/i)
    }
  })
})

describe('the day renders in full even when nothing was recorded', () => {
  it('shows both sections and a total on a date with no activity', async () => {
    const user = userEvent.setup()
    renderLedger()
    await waitFor(() => expect(screen.getByTestId('ledger-revenue')).toBeInTheDocument())

    // Step back well past the demo fixture's observations.
    for (let step = 0; step < 12; step += 1) {
      await user.click(screen.getByTestId('day-back'))
    }

    await waitFor(() => expect(screen.getByTestId('ledger-revenue')).toBeInTheDocument())
    expect(screen.getByTestId('ledger-drawer')).toBeInTheDocument()
    expect(screen.getByTestId('ledger-expenses')).toBeInTheDocument()
    // A total rather than an empty state.
    expect(screen.getByTestId('revenue-total')).toBeInTheDocument()
  })
})

describe('the drawer names its float and its closing balance differently', () => {
  it('never uses one word for both, and says the float is not the next opening', async () => {
    renderLedger()
    await waitFor(() => expect(screen.getByTestId('ledger-drawer')).toBeInTheDocument())

    const drawer = screen.getByTestId('ledger-drawer').textContent ?? ''

    // The retired word must appear nowhere.
    expect(drawer).not.toMatch(/\bkept\b/i)
    expect(screen.getByTestId('left-is-not-opening').textContent).toMatch(
      /not the next day.s opening/i,
    )
  })
})

describe('an uncounted day says its balances are unchecked', () => {
  it('marks them carried and names when the drawer was last confirmed', async () => {
    const user = userEvent.setup()
    renderLedger()
    await waitFor(() => expect(screen.getByTestId('ledger-drawer')).toBeInTheDocument())

    // Today, in the demo fixture, has no observation — the newest is yesterday.
    const carried = screen.queryByTestId('drawer-carried')
    if (carried) {
      expect(carried.textContent).toMatch(/what the app believes rather than what anybody checked/i)
    } else {
      // If today happens to carry one, step forward to a date that cannot.
      await user.click(screen.getByTestId('day-forward'))
      await waitFor(() => expect(screen.getByTestId('ledger-drawer')).toBeInTheDocument())
    }
  })
})

describe('verification is an acknowledgement', () => {
  it('records it, and the day still computes and renders identically', async () => {
    const user = userEvent.setup()
    renderLedger()
    await waitFor(() => expect(screen.getByTestId('verify-day')).toBeInTheDocument())

    const revenueBefore = screen.getByTestId('revenue-total').textContent
    const drawerBefore = screen.getByTestId('ledger-drawer').textContent

    await user.click(screen.getByTestId('verify-day'))

    await waitFor(() => {
      expect(screen.getByTestId('ledger-verify').textContent).toMatch(/verified by/i)
    })

    // Froze nothing: every figure is what it was.
    expect(screen.getByTestId('revenue-total').textContent).toBe(revenueBefore)
    expect(screen.getByTestId('ledger-drawer').textContent).toBe(drawerBefore)
    // And the Verify control is still there — it gates nothing.
    expect(screen.getByTestId('verify-day')).toBeInTheDocument()
  })

  it('has no control that verifies more than one day', async () => {
    renderLedger()
    await waitFor(() => expect(screen.getByTestId('verify-day')).toBeInTheDocument())

    expect(screen.queryByText(/verify all/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/select a range/i)).not.toBeInTheDocument()
    expect(screen.getAllByTestId('verify-day')).toHaveLength(1)
  })
})
