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

import { CashDrawerSurface } from './cash-drawer-surface'

/**
 * The Cash drawer, driven the way a collector drives it.
 *
 * Three things carry this file, and each is a rule the design says must hold at
 * the moment of typing rather than at submission:
 *
 *   * the difference appears on the keystroke that produces it;
 *   * a minus announces that it means money ADDED, before anything is saved;
 *   * an exact bill-run coincidence is reported, and nothing is proposed when
 *     none matches.
 *
 * The third is asserted here **in the rendered output** as well as in
 * `drawer-arithmetic.test.ts`, because task 4.4 asks for both: the helper can be
 * right while the component quietly renders something else.
 */

const managerSession: Session = {
  mode: 'demo',
  userId: personaFixtures.franchise_admin.profile.id,
  assignments: personaFixtures.franchise_admin.assignments,
  ...deriveSessionScope(personaFixtures.franchise_admin.assignments),
  displayName: personaFixtures.franchise_admin.profile.full_name,
  persona: personaFixtures.franchise_admin,
}

function renderDrawer(adapters: DataAdapters = createMockAdapters('franchise_admin')) {
  return {
    adapters,
    ...render(
      <MemoryRouter>
        <SessionContext.Provider value={managerSession}>
          <AdaptersContext.Provider value={adapters}>
            <CashDrawerSurface />
          </AdaptersContext.Provider>
        </SessionContext.Provider>
      </MemoryRouter>,
    ),
  }
}

describe('the drawer opens on a balance', () => {
  it('shows what should be in the drawer now, and no date picker', async () => {
    renderDrawer()

    await waitFor(() => {
      expect(screen.getByTestId('expected-now')).toBeInTheDocument()
    })

    // The question the collector has when they walk in.
    expect(screen.getByTestId('drawer-balance').textContent).toMatch(/should be in the drawer now/i)

    // Not a date picker. The old surface opened on one, and that was the bug.
    expect(screen.queryByLabelText(/^day$/i)).not.toBeInTheDocument()
    expect(screen.queryByTestId('cash-day')).not.toBeInTheDocument()
  })

  it('names the last count, what was left, and what has moved since', async () => {
    renderDrawer()
    await waitFor(() => {
      expect(screen.getByTestId('last-counted')).toBeInTheDocument()
    })

    expect(screen.getByTestId('left')).toBeInTheDocument()
    expect(screen.getByTestId('receipts-since')).toBeInTheDocument()
    expect(screen.getByTestId('expenses-since')).toBeInTheDocument()
  })

  it('shows the anchor as having nothing to compare against', async () => {
    renderDrawer()
    await waitFor(() => {
      expect(screen.getByTestId('recent-counts')).toBeInTheDocument()
    })

    // The demo fixture's first observation is the anchor. It must not render a
    // difference of nought, which would be a variance it never had.
    const anchor = screen.getByText(/the drawer began here/i)
    expect(anchor).toBeInTheDocument()
  })
})

describe('the difference appears as the amount is typed', () => {
  it('states the direction in words as well as by sign', async () => {
    const user = userEvent.setup()
    renderDrawer()
    await waitFor(() => expect(screen.getByTestId('open-count')).toBeInTheDocument())

    await user.click(screen.getByTestId('open-count'))
    await user.type(screen.getByTestId('counted-input'), '100')

    // Before anything is submitted.
    const difference = await screen.findByTestId('count-difference')
    expect(difference.textContent).toMatch(/short|over|balances/i)
    expect(screen.queryByTestId('drawer-error')).not.toBeInTheDocument()
  })

  it('reads a shortfall as short rather than as a bare negative', async () => {
    const user = userEvent.setup()
    renderDrawer()
    await waitFor(() => expect(screen.getByTestId('open-count')).toBeInTheDocument())

    await user.click(screen.getByTestId('open-count'))
    // Far below anything the drawer could hold, so the direction is certain.
    await user.type(screen.getByTestId('counted-input'), '1')

    const difference = await screen.findByTestId('count-difference')
    expect(difference.textContent).toMatch(/missing from the drawer/i)
  })
})

/**
 * The minus, which is the whole of decision 5's user-facing half.
 *
 * Typed rather than unit-tested through the helper, deliberately: task 6.5a asks
 * for it to be proved by typing a minus into the surface, because the failure
 * mode being guarded against is a warning that exists in a function and never
 * reaches the screen.
 */
describe('a negative amount announces itself on the keystroke', () => {
  it('says a minus means ADDING, in the count sheet, before submission', async () => {
    const user = userEvent.setup()
    renderDrawer()
    await waitFor(() => expect(screen.getByTestId('open-count')).toBeInTheDocument())

    await user.click(screen.getByTestId('open-count'))
    await user.type(screen.getByTestId('counted-input'), '450')

    expect(screen.queryByTestId('negative-warning')).not.toBeInTheDocument()

    await user.type(screen.getByTestId('collecting-input'), '-1000')

    const warning = await screen.findByTestId('negative-warning')
    expect(warning.textContent).toMatch(/ADDING money to the drawer, not taking it out/)

    // And the balance preview runs the other way: ₹450 counted, ₹1,000 put back.
    const preview = screen.getByTestId('leaving-preview')
    expect(preview.textContent).toMatch(/1,450/)
  })

  it('shows no warning for a positive amount, and reads as collecting', async () => {
    const user = userEvent.setup()
    renderDrawer()
    await waitFor(() => expect(screen.getByTestId('open-count')).toBeInTheDocument())

    await user.click(screen.getByTestId('open-count'))
    await user.type(screen.getByTestId('counted-input'), '8950')
    await user.type(screen.getByTestId('collecting-input'), '7500')

    expect(screen.queryByTestId('negative-warning')).not.toBeInTheDocument()
    expect(screen.getByTestId('leaving-preview').textContent).toMatch(/1,450/)
  })

  it('flips the standalone sheet title and its confirming control', async () => {
    const user = userEvent.setup()
    renderDrawer()
    await waitFor(() => expect(screen.getByTestId('open-collect')).toBeInTheDocument())

    await user.click(screen.getByTestId('open-collect'))
    await user.type(screen.getByTestId('movement-amount'), '-1000')

    expect(await screen.findByTestId('movement-negative-warning')).toBeInTheDocument()
    // The stated action agrees with the sign.
    expect(screen.getByTestId('save-movement').textContent).toMatch(/add to drawer/i)
  })
})

describe('collecting without counting says so', () => {
  it('states that nothing is being verified, and asks for no reason or actor', async () => {
    const user = userEvent.setup()
    renderDrawer()
    await waitFor(() => expect(screen.getByTestId('open-collect')).toBeInTheDocument())

    await user.click(screen.getByTestId('open-collect'))

    expect(screen.getByTestId('collect-not-verified').textContent).toMatch(
      /not counting.*nothing is verified/i,
    )
    // No actor picker: the actor is the session.
    expect(screen.queryByLabelText(/who took/i)).not.toBeInTheDocument()
    expect(screen.queryByTestId('movement-reason')).not.toBeInTheDocument()
  })
})

describe('a cash spend is secondary, and says it is not an operating cost', () => {
  it('requires a reason and states that the month is unchanged', async () => {
    const user = userEvent.setup()
    renderDrawer()
    await waitFor(() => expect(screen.getByTestId('open-spend')).toBeInTheDocument())

    await user.click(screen.getByTestId('open-spend'))

    expect(screen.getByTestId('movement-reason')).toBeInTheDocument()
    expect(screen.getByTestId('spend-not-an-expense').textContent).toMatch(/not.*enter the month/i)
  })

  it('is reachable less prominently than a collection', async () => {
    renderDrawer()
    await waitFor(() => expect(screen.getByTestId('open-count')).toBeInTheDocument())

    // The primary action is a button; the spend is a text link, and the
    // collection sits ahead of it.
    expect(screen.getByTestId('open-count').tagName).toBe('BUTTON')
    const links = screen.getAllByRole('button', { name: /collect cash|record a cash spend/i })
    expect(links[0]?.textContent).toMatch(/collect cash/i)
  })
})

/**
 * The refusal, in the rendered output.
 *
 * `drawer-arithmetic.test.ts` proves the helper returns nothing. This proves the
 * component renders nothing — no instant, no "try 22:04", no ranked option.
 */
describe('the surface proposes no instant', () => {
  it('emits no alternative time for a difference that matches no run of bills', async () => {
    const user = userEvent.setup()
    const { container } = renderDrawer()
    await waitFor(() => expect(screen.getByTestId('open-count')).toBeInTheDocument())

    await user.click(screen.getByTestId('open-count'))
    // A deliberately awkward figure, chosen not to land on any prefix sum.
    await user.type(screen.getByTestId('counted-input'), '7777')

    await screen.findByTestId('count-difference')

    const rendered = container.textContent ?? ''
    // Nothing anywhere offers a time to try.
    expect(rendered).not.toMatch(/try\s+\d{1,2}:\d{2}/i)
    expect(rendered).not.toMatch(/would balance/i)
    expect(rendered).not.toMatch(/nearest/i)
    expect(rendered).not.toMatch(/suggest/i)
    expect(screen.queryByText(/set the time to/i)).not.toBeInTheDocument()
  })
})

describe('an off-site count is recorded, never refused', () => {
  it('offers a reason field and says nothing is refused for being elsewhere', async () => {
    const user = userEvent.setup()
    renderDrawer()
    await waitFor(() => expect(screen.getByTestId('open-count')).toBeInTheDocument())

    await user.click(screen.getByTestId('open-count'))

    expect(screen.getByTestId('away-reason')).toBeInTheDocument()
    expect(screen.getByText(/nothing is refused for being elsewhere/i)).toBeInTheDocument()
  })
})

describe('an earlier count is adjusted, not edited', () => {
  it('names why it is locked and requires a reason', async () => {
    const user = userEvent.setup()
    renderDrawer()
    await waitFor(() => expect(screen.getByTestId('recent-counts')).toBeInTheDocument())

    // The newest observation offers no adjustment control — nothing has anchored
    // on it, so that case is an edit.
    const adjustControls = screen.getAllByTestId(/^adjust-/)
    expect(adjustControls.length).toBeGreaterThan(0)

    await user.click(adjustControls[0]!)

    expect(await screen.findByTestId('adjust-reason')).toBeInTheDocument()
    expect(screen.getByText(/locked/i)).toBeInTheDocument()
    expect(screen.getByTestId('adjust-explains-anchor').textContent).toMatch(
      /re-anchors.*nothing after it moves/i,
    )
    // Refused until a reason is given.
    expect(screen.getByTestId('save-adjustment')).toBeDisabled()
  })
})
