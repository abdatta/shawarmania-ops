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

  it('offers only the date stepper, verification and explanations as controls', async () => {
    renderLedger()
    await waitFor(() => expect(screen.getByTestId('ledger-revenue')).toBeInTheDocument())

    // The accessible name, not the text: the date stepper is icon-only and names
    // itself with `aria-label`, while a `Why` names itself with `sr-only` text.
    const buttons = screen
      .getAllByRole('button')
      .map((button) => (button.getAttribute('aria-label') ?? button.textContent ?? '').trim())

    // Every control accounted for, and note what the allowed set does NOT
    // contain: anything that writes a figure. The rest are `Why` disclosures,
    // which reveal prose and change nothing.
    expect(buttons.length).toBeGreaterThan(0)
    for (const label of buttons) {
      expect(label).toMatch(/^(previous day|next day|verify this day|wh(y|at) .+)$/i)
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
    const user = userEvent.setup()
    renderLedger()
    await waitFor(() => expect(screen.getByTestId('ledger-drawer')).toBeInTheDocument())

    // Step back to a date that was actually counted. `left ≠ next opening` is a
    // fact about a count, so on a `carried` date it is deliberately absent —
    // there is no float left to distinguish from anything.
    await user.click(screen.getByTestId('day-back'))
    await waitFor(() => expect(screen.queryByTestId('drawer-carried')).not.toBeInTheDocument())

    // No word boundaries, deliberately: a retired term should not survive inside
    // a longer word either.
    expect(screen.getByTestId('ledger-drawer').textContent ?? '').not.toMatch(/kept/i)

    // `left ≠ next opening` states it; the sentence behind it explains it.
    expect(screen.getByTestId('left-is-not-opening').textContent).toMatch(/left.*opening/i)
    await user.click(
      screen.getByRole('button', { name: /why what was left is not the next opening/i }),
    )
    expect(screen.getByText(/not the next day.s opening/i)).toBeInTheDocument()
  })
})

describe('an uncounted day says its balances are unchecked', () => {
  it('marks them carried and names when the drawer was last confirmed', async () => {
    const user = userEvent.setup()
    renderLedger()
    await waitFor(() => expect(screen.getByTestId('ledger-drawer')).toBeInTheDocument())

    // `carried` is the only word on this surface that says how much the numbers
    // can be trusted, so it is a chip rather than a buried sentence.
    const carried = await screen.findByTestId('drawer-carried')
    expect(carried.textContent).toMatch(/carried/i)

    await user.click(screen.getByRole('button', { name: /what carried means/i }))
    expect(
      screen.getByText(/what the app believes rather than what anybody checked/i),
    ).toBeInTheDocument()
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
      expect(screen.getAllByTestId(/^verification-/).length).toBeGreaterThan(0)
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
