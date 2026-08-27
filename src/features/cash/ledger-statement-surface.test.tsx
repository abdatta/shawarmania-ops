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
  it('renders no input, textarea or select inside any reading section', async () => {
    renderLedger()
    await waitFor(() => expect(screen.getByTestId('ledger-revenue')).toBeInTheDocument())

    // Enumerated, not sampled — and scoped to the sections that carry figures.
    // The day control's hidden native `<input type="date">` sits outside them: it
    // is the platform calendar, which is a control, not a figure. The claim is
    // that no REVENUE, DRAWER or EXPENSE figure can be typed.
    for (const section of ['ledger-revenue', 'ledger-drawer', 'ledger-expenses'] as const) {
      const card = screen.getByTestId(section)
      expect(card.querySelectorAll('input')).toHaveLength(0)
      expect(card.querySelectorAll('textarea')).toHaveLength(0)
      expect(card.querySelectorAll('select')).toHaveLength(0)
      expect(card.querySelectorAll('[contenteditable="true"]')).toHaveLength(0)
    }
  })

  it('offers only the view toggle, the period bar, Verify and explanations', async () => {
    renderLedger()
    await waitFor(() => expect(screen.getByTestId('ledger-revenue')).toBeInTheDocument())

    // The accessible name, not the text: the period steps are icon-only and name
    // themselves with `aria-label`, while a `Why` names itself with `sr-only` text.
    const buttons = screen
      .getAllByRole('button')
      .map((button) => (button.getAttribute('aria-label') ?? button.textContent ?? '').trim())

    // Every control accounted for, and note what the allowed set does NOT
    // contain: anything that writes a figure. The rest reveal prose or move the
    // period, and change nothing.
    expect(buttons.length).toBeGreaterThan(0)
    for (const label of buttons) {
      expect(label).toMatch(
        /^(one day|the month|previous day|next day|previous month|next month|verify this day|day — .+|wh(y|at) .+)$/i,
      )
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
      await user.click(screen.getByTestId('statement-step-back'))
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

    // Step back to a date that was actually counted, so the drawer section is
    // rendered in full.
    await user.click(screen.getByTestId('statement-step-back'))
    await waitFor(() => expect(screen.getByTestId('left-is-not-opening')).toBeInTheDocument())

    // No word boundaries, deliberately: a retired term should not survive inside
    // a longer word either.
    expect(screen.getByTestId('ledger-drawer').textContent ?? '').not.toMatch(/kept/i)

    // The footnote names the two figures apart, exactly as the notebook's own
    // reading does — a sentence under the column rather than a chip.
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

    // `carried` is the only word on this page that says how much the numbers can
    // be trusted, so it is a pill on the day's own header as well as a footnote.
    expect(await screen.findByTestId('drawer-state-carried')).toBeInTheDocument()
    expect(screen.getByTestId('drawer-carried').textContent).toMatch(
      /what the app believes rather than what anybody checked/i,
    )
    // And it names when the drawer was last actually confirmed.
    expect(screen.getByTestId('drawer-carried').textContent).toMatch(/last confirmed/i)

    await user.click(screen.getByRole('button', { name: /what carried means/i }))
    expect(screen.getByText(/how much the numbers can be trusted/i)).toBeInTheDocument()
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

/**
 * The day control, which #11 got wrong once.
 *
 * The first version of this surface hand-rolled a pair of chevrons and lost all
 * three things `src/components/ui/period-bar.tsx` already does: **Today** in
 * words, a hard stop at the outlet's own today, and a calendar so any earlier
 * day is one tap rather than N steps. Surfaces that ask "which day" should look
 * like each other, so this asserts it uses the shared bar rather than a second
 * idiom for the same question.
 */
describe('the day control is the shared one, and refuses the future', () => {
  it('writes Today in words rather than the date', async () => {
    renderLedger()
    const open = await screen.findByTestId('statement-day-open')
    expect(open.textContent?.trim()).toBe('Today')
  })

  it('cannot be stepped past the outlet’s own today', async () => {
    renderLedger()
    // On today, forward is refused — the database will not take a future
    // business date, so a control offering one is offering a failure.
    await waitFor(() => expect(screen.getByTestId('statement-step-forward')).toBeDisabled())

    const user = userEvent.setup()
    await user.click(screen.getByTestId('statement-step-back'))
    // One day back, forward opens again.
    await waitFor(() => expect(screen.getByTestId('statement-step-forward')).toBeEnabled())
  })

  it('offers a calendar bounded at today, so any earlier day is one tap', async () => {
    renderLedger()
    const picker = await screen.findByTestId('statement-day-picker')
    const today = picker.getAttribute('value')

    expect(picker).toHaveAttribute('type', 'date')
    // The ceiling is the outlet's today, and the floor is far enough back that
    // reading an old month is ordinary rather than blocked.
    expect(picker.getAttribute('max')).toBe(today)
    expect(picker.getAttribute('min')).toMatch(/^\d{4}-\d{2}-01$/)
    // ISO dates sort lexicographically, which is why the whole app compares them
    // as strings rather than parsing first.
    expect((picker.getAttribute('min') ?? '') < (today ?? '')).toBe(true)
  })
})
