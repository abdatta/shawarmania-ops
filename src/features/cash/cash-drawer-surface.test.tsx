import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DataAdapters, DrawerObservationRecord } from '@/data-access/adapters'
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

/**
 * The geolocation stub, borrowed from `check-in-card.test.tsx` for the same
 * reason it exists there: since 2026-08-28 this surface reads a position when a
 * recording sheet opens (design D20), and whether the reason field appears at
 * all depends on the answer. Without the stub every sheet here would read as
 * `unsupported` — which is a real state and is tested below, but is not the
 * ordinary one.
 */

/** Kalyani's counter, from the outlet fixture. */
const AT_COUNTER = { latitude: 22.975, longitude: 88.4346, accuracy: 12 }
/** Far outside the 150 m fence. */
const DOWN_THE_ROAD = { latitude: 22.9765, longitude: 88.4362, accuracy: 45 }

let getCurrentPosition: ReturnType<typeof vi.fn>

function atPosition(coords: { latitude: number; longitude: number; accuracy: number }) {
  getCurrentPosition.mockImplementation((onSuccess: PositionCallback) =>
    onSuccess({ coords, timestamp: Date.parse('2026-08-28T16:30:00Z') } as GeolocationPosition),
  )
}

function positionFails(code: number) {
  getCurrentPosition.mockImplementation((_ok: PositionCallback, onError: PositionErrorCallback) =>
    onError({ code } as GeolocationPositionError),
  )
}

beforeEach(() => {
  getCurrentPosition = vi.fn()
  atPosition(AT_COUNTER)
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition, watchPosition: vi.fn(), clearWatch: vi.fn() },
  })
})

afterEach(() => {
  Reflect.deleteProperty(navigator, 'geolocation')
})

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

    // The question the collector has when they walk in, in as few words as it
    // takes: this is read on a phone by somebody holding cash.
    expect(screen.getByTestId('drawer-balance').textContent).toMatch(/in the drawer now/i)

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

  it('shows the anchor as a first count, carrying no difference at all', async () => {
    const user = userEvent.setup()
    renderDrawer()
    await waitFor(() => {
      expect(screen.getByTestId('recent-counts')).toBeInTheDocument()
    })

    // The demo fixture's first observation is the anchor. It must not render a
    // difference of nought, which would be a variance it never had — and the
    // verdict is on the CLOSED row, because that is what the list is scanned for.
    const anchor = screen.getByTestId(/^anchor-/)
    expect(anchor.textContent).toMatch(/first count/i)

    // The reasoning is inside the disclosure since design D21: the fact is
    // scanned, the explanation is asked for.
    const row = anchor.closest('[data-testid^="observation-"]') as HTMLElement
    await user.click(within(row).getByRole('button', { name: /show the detail/i }))
    await user.click(screen.getByRole('button', { name: /what a first count means/i }))
    expect(screen.getByText(/the drawer began here/i)).toBeInTheDocument()
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

  it('reads a shortfall as the word short, not as a bare negative', async () => {
    const user = userEvent.setup()
    renderDrawer()
    await waitFor(() => expect(screen.getByTestId('open-count')).toBeInTheDocument())

    await user.click(screen.getByTestId('open-count'))
    // Far below anything the drawer could hold, so the direction is certain.
    await user.type(screen.getByTestId('counted-input'), '1')

    // **The direction is a word, not only a sign.** A minus is the first thing a
    // small screen loses, which is why the word sits on the chip beside the figure.
    //
    // The direction itself is not hardcoded: the demo's expected total is derived
    // from its own bills and expenses, so which way ₹1 falls depends on the day's
    // real trade. What must always hold is the PAIRING — the chip and the
    // explanation behind it name the same direction.
    await screen.findByTestId('count-difference')
    // Read the CHIP, not the block: the block also contains the `Why` button's
    // screen-reader label, which names both directions and so matches either.
    const chip = screen.getByTestId('count-direction')
    const direction = /short/i.test(chip.textContent ?? '') ? 'short' : 'over'
    expect(chip.textContent).toMatch(new RegExp(direction, 'i'))
    expect(chip.textContent).toMatch(/₹/)

    // The longer explanation is one tap away rather than always on screen.
    await user.click(screen.getByRole('button', { name: /what short and over mean here/i }))
    expect(
      screen.getByText(
        direction === 'short' ? /missing from the drawer/i : /more than expected was counted/i,
      ),
    ).toBeInTheDocument()
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

    // Cleared first: the field starts at `0` since design D22, so typing into
    // it without clearing would produce `0-1000`.
    await user.clear(screen.getByTestId('collecting-input'))
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
    await user.clear(screen.getByTestId('collecting-input'))
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

    expect(screen.getByTestId('collect-not-verified').textContent).toMatch(/nothing verified/i)
    await user.click(
      screen.getByRole('button', { name: /what collecting without counting does not do/i }),
    )
    expect(screen.getByText(/you are not counting/i)).toBeInTheDocument()

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
    expect(screen.getByTestId('spend-not-an-expense').textContent).toMatch(
      /not in the month.s expenses/i,
    )
    await user.click(screen.getByRole('button', { name: /why a spend is not an expense/i }))
    expect(screen.getByText(/a fridge is not a running cost/i)).toBeInTheDocument()
  })

  it('is reachable less prominently than a count, and still reads as a control', async () => {
    renderDrawer()
    await waitFor(() => expect(screen.getByTestId('open-count')).toBeInTheDocument())

    const count = screen.getByTestId('open-count')
    const collect = screen.getByTestId('open-collect')
    const spend = screen.getByTestId('open-spend')

    // Decision 5's separation survives: the primary action is full width and
    // alone, the two secondary ones share the quieter row beneath it.
    expect(count.className).toMatch(/w-full/)
    expect(spend.className).not.toMatch(/w-full/)

    // **Distance, not invisibility** (design D22). Rendered `ghost` this was
    // text with no boundary and the owner could not tell it was a control at
    // all, so it carries the same border its neighbour does.
    expect(collect.className).toMatch(/border/)
    expect(spend.className).toMatch(/border/)

    // And the collection sits ahead of the spend in the document.
    expect(collect.compareDocumentPosition(spend) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
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

/**
 * Where the recorder stood, which the surface reads rather than asks about
 * (design D20).
 *
 * The defect this replaced: the surface sent no position at all, so every record
 * was off-site by the database's own reckoning, and
 * `drawer_observations_away_needs_a_reason` would refuse a count whose
 * "optional" reason box was left empty — at 22:00, by somebody holding cash.
 */
describe('where the recorder stood is detected, not typed', () => {
  it('asks nothing when the position is inside the fence', async () => {
    const user = userEvent.setup()
    renderDrawer()
    await waitFor(() => expect(screen.getByTestId('open-count')).toBeInTheDocument())

    await user.click(screen.getByTestId('open-count'))

    // Not a disabled field and not an optional one: no field.
    expect(await screen.findByTestId('whereabouts-on-site')).toBeInTheDocument()
    expect(screen.queryByTestId('away-reason')).not.toBeInTheDocument()

    await user.type(screen.getByTestId('counted-input'), '8950')
    expect(screen.getByTestId('save-count')).not.toBeDisabled()
  })

  it('requires a reason from outside the fence, and says how far', async () => {
    const user = userEvent.setup()
    atPosition(DOWN_THE_ROAD)
    renderDrawer()
    await waitFor(() => expect(screen.getByTestId('open-count')).toBeInTheDocument())

    await user.click(screen.getByTestId('open-count'))
    await user.type(screen.getByTestId('counted-input'), '8950')

    const away = await screen.findByTestId('whereabouts-away')
    expect(away.dataset.kind).toBe('away')
    expect(away.textContent).toMatch(/from Shawarmania Kalyani/i)

    // Refused by the SHEET, so nothing is attempted and no constraint message
    // ever reaches the person.
    expect(screen.getByTestId('save-count')).toBeDisabled()
    expect(screen.getByText(/nothing is refused for being elsewhere/i)).toBeInTheDocument()

    await user.type(screen.getByTestId('away-reason'), 'counted at the counter, typed at home')
    expect(screen.getByTestId('save-count')).not.toBeDisabled()
  })

  it('treats no fix at all as away, and names why it could not tell', async () => {
    const user = userEvent.setup()
    positionFails(1)
    renderDrawer()
    await waitFor(() => expect(screen.getByTestId('open-count')).toBeInTheDocument())

    await user.click(screen.getByTestId('open-count'))

    const away = await screen.findByTestId('whereabouts-away')
    expect(away.dataset.kind).toBe('unlocatable')
    expect(away.textContent).toMatch(/permission is off/i)
    expect(screen.getByTestId('away-reason')).toBeInTheDocument()
  })

  it('asks the same question on the collect sheet, and invents no reason', async () => {
    const user = userEvent.setup()
    renderDrawer()
    await waitFor(() => expect(screen.getByTestId('open-collect')).toBeInTheDocument())

    await user.click(screen.getByTestId('open-collect'))

    // The hardcoded `'recorded from the app'` string this replaced satisfied the
    // constraint by writing a sentence true of every row and evidence about none.
    expect(await screen.findByTestId('whereabouts-on-site')).toBeInTheDocument()
    expect(screen.queryByTestId('away-reason')).not.toBeInTheDocument()
  })
})

describe('an earlier count is adjusted, not edited', () => {
  it('names why it is locked and requires a reason', async () => {
    const user = userEvent.setup()
    renderDrawer()
    await waitFor(() => expect(screen.getByTestId('recent-counts')).toBeInTheDocument())

    // Nothing is offered from the closed rows: the control lives inside the
    // disclosure since design D21, as a control that reads as one.
    expect(screen.queryAllByTestId(/^adjust-/)).toHaveLength(0)

    // The SECOND row: the newest observation offers no adjustment at all —
    // nothing has anchored on it, so that case is an edit.
    const rows = screen.getAllByRole('button', { name: /show the detail/i })
    await user.click(rows[1]!)

    const adjustControls = screen.getAllByTestId(/^adjust-/)
    expect(adjustControls.length).toBeGreaterThan(0)
    expect(adjustControls[0]!.tagName).toBe('BUTTON')

    await user.click(adjustControls[0]!)

    expect(await screen.findByTestId('adjust-reason')).toBeInTheDocument()
    // The lock is a chip; why it is locked, and why nothing after it moves, is
    // one tap away.
    expect(screen.getAllByText(/locked/i).length).toBeGreaterThan(0)
    await user.click(screen.getByRole('button', { name: /why this count is locked/i }))
    expect(screen.getByText(/re-anchors the balance/i)).toBeInTheDocument()
    // Refused until a reason is given.
    expect(screen.getByTestId('save-adjustment')).toBeDisabled()
  })
})

/**
 * Task 5.6, and the emphasis is on the second half: the advisory must NEVER
 * block. A count refused because a tablet is behind is a count that does not get
 * recorded at all, and the person holding the cash is the best evidence there is.
 */
describe('an unsynced tablet advises and never blocks', () => {
  it('names how many and since when, and still accepts the count', async () => {
    const user = userEvent.setup()
    const adapters = createMockAdapters('franchise_admin')

    // A tablet at this outlet reporting undelivered bills.
    const devices = await adapters.counter.listDevices()
    const atOutlet = devices.find((device) => device.lastReportedUnsent === 0) ?? devices[0]
    const behind = { ...atOutlet!, lastReportedUnsent: 3 }
    const patched: DataAdapters = {
      ...adapters,
      counter: {
        ...adapters.counter,
        listDevices: async () => [behind],
      },
    }

    renderDrawer(patched)
    await waitFor(() => expect(screen.getByTestId('open-count')).toBeInTheDocument())

    // The advisory sits on the balance itself, so it is seen before the count
    // sheet is even opened.
    const chip = await screen.findByTestId('unsynced-chip')
    expect(chip.textContent).toMatch(/1 tablet behind/i)

    await user.click(
      screen.getByRole('button', { name: /what an unsent tablet means for this figure/i }),
    )
    expect(screen.getByText(/may be understated/i)).toBeInTheDocument()
    expect(screen.getByText(/count anyway/i)).toBeInTheDocument()

    // **And it blocks nothing.** The count is still accepted.
    await user.click(screen.getByTestId('open-count'))
    await user.type(screen.getByTestId('counted-input'), '8950')
    expect(screen.getByTestId('save-count')).not.toBeDisabled()
  })
})

/**
 * The balance card, which the owner read on 2026-08-28 and could not use
 * (design D23). Each assertion here is one of the four complaints.
 */
describe('the balance card says what it means', () => {
  it('names the three figures for what they are, and shows their signs', async () => {
    renderDrawer()
    await waitFor(() => expect(screen.getByTestId('expected-now')).toBeInTheDocument())

    const card = screen.getByTestId('drawer-balance')
    expect(card.textContent).toMatch(/Last Left/i)
    expect(card.textContent).toMatch(/Cash from Bills/i)
    expect(card.textContent).toMatch(/Cash Expenses/i)

    // **The direction of a term in a running balance is the whole content of
    // that term**, and a green tint is not available to every reader.
    expect(screen.getByTestId('receipts-since').textContent).toMatch(/^\+/)
    expect(screen.getByTestId('expenses-since').textContent).toMatch(/^-|^−/)
    expect(screen.getByTestId('expenses-since').className).toMatch(/text-danger/)
  })

  it('puts the running total on the same line as its label, and the chips beneath', async () => {
    renderDrawer()
    await waitFor(() => expect(screen.getByTestId('expected-now')).toBeInTheDocument())

    // The figure sits at the right end of its own label's line rather than
    // below it at the left margin, where nothing else in this app puts money.
    const line = screen.getByTestId('expected-now').parentElement!
    expect(line.className).toMatch(/justify-between/)
    expect(line.textContent).toMatch(/in the drawer now/i)

    // And the chips that qualify the figure sit against it, above the divider
    // that separates it from the three-up strip.
    const chips = screen.getByTestId('balance-chips')
    expect(line.compareDocumentPosition(chips) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

describe('the three actions are named for what tells them apart', () => {
  it('reads Count and Collect, Only Collect, Other Spend', async () => {
    renderDrawer()
    await waitFor(() => expect(screen.getByTestId('open-count')).toBeInTheDocument())

    // The count and the collection are one physical act, and the primary
    // control was the last place still describing half of it (design D22).
    expect(screen.getByTestId('open-count').textContent).toMatch(/count & collect/i)
    expect(screen.getByTestId('open-collect').textContent).toMatch(/only collect/i)
    expect(screen.getByTestId('open-spend').textContent).toMatch(/other spend/i)
  })
})

/**
 * Every count is approximate (design D19), which reverses half of decision 6 on
 * the owner's own reasoning: counting takes minutes, the counter keeps trading,
 * and no instant a person supplies is the edge of that act.
 */
describe('every count time is approximate', () => {
  it('offers no control asserting certainty, whichever time is chosen', async () => {
    const user = userEvent.setup()
    renderDrawer()
    await waitFor(() => expect(screen.getByTestId('open-count')).toBeInTheDocument())

    await user.click(screen.getByTestId('open-count'))

    // Now, 15 min ago, 30 min ago — and the window is stated for all of them.
    expect(screen.getByTestId('when-0').textContent).toMatch(/now/i)
    expect(screen.getByTestId('when-15').textContent).toMatch(/15 min ago/i)
    expect(screen.getByTestId('when-30').textContent).toMatch(/30 min ago/i)
    expect(screen.getByTestId('tolerance-window').textContent).toMatch(/±15 min/)

    // The control that used to take the window back is gone, for good.
    expect(screen.queryByTestId('assert-certain')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /i.m sure/i })).not.toBeInTheDocument()

    await user.click(screen.getByTestId('when-30'))
    expect(screen.getByTestId('tolerance-window').textContent).toMatch(/±15 min/)
    expect(screen.queryByRole('button', { name: /i.m sure/i })).not.toBeInTheDocument()
  })

  it('takes an explicit date and time, and refuses one in the future itself', async () => {
    const user = userEvent.setup()
    renderDrawer()
    await waitFor(() => expect(screen.getByTestId('open-count')).toBeInTheDocument())

    await user.click(screen.getByTestId('open-count'))
    await user.type(screen.getByTestId('counted-input'), '8950')
    expect(screen.getByTestId('save-count')).not.toBeDisabled()

    // `fireEvent` rather than typing: a `datetime-local` field is a set of
    // segments in a real browser and one opaque value in jsdom, so keystrokes
    // land nowhere. What is under test is what the surface does with a stated
    // instant, not how the platform collects one.
    const nextYear = new Date()
    nextYear.setFullYear(nextYear.getFullYear() + 1)
    const pad = (value: number) => String(value).padStart(2, '0')
    fireEvent.change(screen.getByTestId('counted-at-picker'), {
      target: {
        value: `${nextYear.getFullYear()}-${pad(nextYear.getMonth() + 1)}-${pad(
          nextYear.getDate(),
        )}T10:00`,
      },
    })

    // Refused here, in a sentence, rather than as a Postgres message after a
    // round trip. The database refuses it too; nobody should have to find out
    // that way.
    expect(await screen.findByTestId('time-problem')).toHaveTextContent(
      /cannot be taken in the future/i,
    )
    expect(screen.getByTestId('save-count')).toBeDisabled()
  })
})

/**
 * The count history: a disclosure per row, and pages rather than a cap
 * (design D21).
 *
 * Paging is driven through the button here, not the sentinel: jsdom has no
 * `IntersectionObserver`, which is exactly the environment the button exists
 * for.
 */
describe('the count history is a paged list of disclosures', () => {
  it('carries the verdict closed and everything else inside', async () => {
    const user = userEvent.setup()
    renderDrawer()
    await waitFor(() => expect(screen.getByTestId('recent-counts')).toBeInTheDocument())

    const rows = screen.getAllByRole('button', { name: /show the detail/i })
    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0]).toHaveAttribute('aria-expanded', 'false')

    // Closed: the instant, the amount and the verdict — including `matched`,
    // because a clean night reading blank looks like a row that has not loaded.
    const list = screen.getByTestId('recent-counts')
    expect(list.textContent).toMatch(/matched|short|over|first count/i)

    // Closed: nothing else. Unmounted rather than hidden, so find-in-page
    // cannot lead a reader to text that is not on screen.
    expect(screen.queryAllByTestId(/^observation-detail-/)).toHaveLength(0)

    await user.click(rows[0]!)
    expect(rows[0]).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getAllByTestId(/^observation-detail-/).length).toBe(1)
  })

  it('loads older counts on demand and says when there are no more', async () => {
    const user = userEvent.setup()
    const adapters = createMockAdapters('franchise_admin')

    // Fourteen counts, newest first: more than one page, so there is a second
    // one to reach and an end to arrive at.
    const older: DrawerObservationRecord[] = Array.from({ length: 14 }, (_, index) => ({
      id: `paged-${index}`,
      outletId: 'outlet',
      countedAt: new Date(Date.UTC(2026, 7, 20 - index, 16, 30)).toISOString(),
      recordedAt: new Date(Date.UTC(2026, 7, 20 - index, 16, 45)).toISOString(),
      isAnchor: false,
      openingPaise: 145_000,
      expectedPaise: 895_000,
      differencePaise: 0,
      countedTotalPaise: 895_000,
      isApproximate: true,
      toleranceMinutes: 15,
      recordedBy: 'someone',
      recordedByName: 'Demo Manager',
      correctedBy: null,
      correctedByName: null,
      onSite: true,
      awayReason: null,
      note: null,
      ownCashOut: [],
      adjustments: [],
      openingBreakPaise: null,
    }))

    const patched: DataAdapters = {
      ...adapters,
      cashDrawer: {
        ...adapters.cashDrawer,
        getState: async (outletId: string) => ({
          ...(await adapters.cashDrawer.getState(outletId)),
          recentObservations: older.slice(0, 10),
        }),
        listObservations: async (_outletId: string, query = {}) => {
          const after = older.filter((row) => !query.before || row.countedAt < query.before)
          return { observations: after.slice(0, 10), hasMore: after.length > 10 }
        },
      },
    }

    renderDrawer(patched)
    await waitFor(() => expect(screen.getByTestId('recent-counts')).toBeInTheDocument())

    expect(screen.getAllByRole('button', { name: /show the detail/i })).toHaveLength(10)

    await user.click(screen.getByTestId('load-older-counts'))

    // Continued from the oldest row already shown, so nothing repeats and
    // nothing is skipped.
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /show the detail/i })).toHaveLength(14)
    })

    // And the end of the list says it is the end rather than going quiet.
    expect(await screen.findByTestId('counts-exhausted')).toBeInTheDocument()
    expect(screen.queryByTestId('load-older-counts')).not.toBeInTheDocument()
  })
})
