import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'

import type { DataAdapters, LedgerStatementMonth } from '@/data-access/adapters'
import { AdaptersContext } from '@/data-access/adapters-context'
import { createMockAdapters } from '@/data-access/mock'
import { personaFixtures } from '@/data-access/mock/fixtures/personas'
import { SessionContext } from '@/session/context'
import type { Session } from '@/session/session'
import { deriveSessionScope } from '@/session/session'

import { readMonth, type MonthDayInput } from '@/domain'

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
    // themselves with `aria-label`, while an explanation trigger names itself
    // with its own visible content plus `sr-only` text saying what it explains.
    const buttons = screen
      .getAllByRole('button')
      .map((button) => (button.getAttribute('aria-label') ?? button.textContent ?? '').trim())

    // Every control accounted for, and note what the allowed set does NOT
    // contain: anything that writes a figure. The rest reveal prose or move the
    // period, and change nothing.
    expect(buttons.length).toBeGreaterThan(0)
    for (const label of buttons) {
      expect(label).toMatch(
        /^(one day|the month|previous day|next day|previous month|next month|verify this day|day — .+|.+, explain: .+)$/i,
      )
    }
  })
})

describe('a measured figure says when it was last confirmed', () => {
  /**
   * The Ledger is the surface an owner actually opens, and it was the one this
   * stamp missed: it renders its own settlement chip from a flattened reading
   * and never saw the settlement object the notebook's chip was built against.
   */
  it('shows the freshness chip beside the channel’s source chip', async () => {
    const user = userEvent.setup()
    renderLedger()
    await waitFor(() => expect(screen.getByTestId('ledger-revenue')).toBeInTheDocument())

    // Back to a day the reader has actually covered; today has no channel rows.
    await user.click(screen.getByTestId('statement-step-back'))
    await waitFor(() =>
      expect(screen.queryAllByTestId(/^channel-gross-/).length).toBeGreaterThan(0),
    )

    const chips = screen.queryAllByTestId(/^channel-as-of-/)
    expect(chips.length).toBeGreaterThan(0)
    for (const chip of chips) {
      // A bare time is today; anything older carries its date. Never empty,
      // which is what shipped: production has no `as_of_at` and the chip
      // rendered nothing at all.
      //
      // The month is `[A-Za-z]+` and the hour `\d{1,2}` because that is what
      // `formatFreshness` can actually produce. `en-IN` abbreviates September
      // to **Sept**, four letters where every other month takes three, and it
      // renders a single-digit hour as `9:05 am` whatever `hour: '2-digit'`
      // asks for. A stricter pattern passes for eleven months and for hours
      // after ten, which is why this only came up in September.
      expect(chip).toHaveTextContent(/^(\d{1,2} [A-Za-z]+, )?\d{1,2}:\d{2} [ap]m$/)
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

describe('a carried notebook count stays in the derived reader', () => {
  it('renders a pre-bill date through the same surface, with no hour and no apology', async () => {
    const user = userEvent.setup()
    renderLedger()

    await screen.findByTestId('ledger-drawer')
    for (let step = 0; step < 7; step += 1) {
      await user.click(screen.getByTestId('statement-step-back'))
    }

    // The count reads `Count` and stops there. **Scoped to the observation
    // block on purpose**: this date also carries a drawer spend, which has a
    // real recorded instant and rightly shows it, so asserting across the whole
    // section would pass on the wrong row's time.
    const observation = await waitFor(() => {
      const row = document.querySelector('[data-testid^="timeline-observation-"]')
      if (!row) throw new Error('no observation rendered')
      return row as HTMLElement
    })
    expect(observation).toHaveTextContent(/Count/)
    // No hour, in any of the forms this app writes one.
    expect(observation.textContent).not.toMatch(/\d{1,2}:\d{2}\s?(am|pm)/i)
    // And it does not say so in words either: the missing time is the fact.
    expect(observation.textContent).not.toMatch(/never recorded/i)

    expect(screen.getByTestId('ledger-revenue')).toBeInTheDocument()
    expect(screen.getByTestId('ledger-expenses')).toBeInTheDocument()
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

// ─────────────────────────────────────────────────────────────────────────────
// The month (#52).
//
// The arithmetic behind these figures is proved in `src/domain/ledger-month.test.ts`,
// against the wrong implementations as well as the right one. What is asserted
// here is the SURFACE: that the three cards are back, that a ceiling says it is
// one, and — the two the owner's design turns on — that a date with no bills is
// named without a cause being claimed, and that a month with no sales at all
// offers no profit figure rather than a fabricated loss.

function monthDay(businessDate: string, over: Partial<MonthDayInput> = {}): MonthDayInput {
  return {
    businessDate,
    cashPaise: 0,
    upiPaise: 0,
    discountPaise: 0,
    channels: [],
    expenses: [],
    drawerState: 'counted',
    ...over,
  }
}

function unsettled(grossPaise: number) {
  return {
    channel: 'swiggy',
    grossPaise,
    commissionPaise: null,
    netPaise: null,
    asOfAt: null,
  }
}

/** Render the month view over a month reading we control exactly. */
async function renderMonth(days: MonthDayInput[]) {
  const adapters = createMockAdapters('franchise_admin')
  const month: LedgerStatementMonth = {
    outletId: 'outlet-under-test',
    month: '2026-08',
    reading: readMonth(days, { expectedChannels: ['zomato', 'swiggy'] }),
    spends: [],
  }
  const patched: DataAdapters = {
    ...adapters,
    ledgerStatement: {
      ...adapters.ledgerStatement,
      // Echo the requested outlet and month: the surface only renders once
      // `reading.month` matches the key it asked for, which is how it avoids
      // showing August's figures under September's heading mid-fetch.
      getMonth: (outletId: string, requested: string) =>
        Promise.resolve({ ...month, outletId, month: requested }),
    },
  }

  const view = renderLedger(patched)
  await waitFor(() => expect(screen.getByTestId('ledger-revenue')).toBeInTheDocument())
  await userEvent.click(screen.getByRole('button', { name: /the month/i }))
  return view
}

describe('the month reports what it earned, spent and kept', () => {
  const august = [
    monthDay('2026-08-01', {
      cashPaise: 500000,
      upiPaise: 200000,
      channels: [
        {
          channel: 'zomato',
          grossPaise: 100000,
          commissionPaise: 20000,
          netPaise: 80000,
          asOfAt: '2026-08-02T00:00:00.000Z',
        },
      ],
      expenses: [
        {
          businessDate: '2026-08-01',
          category: 'Chicken',
          note: '12 kg',
          amountPaise: 300000,
          isCash: true,
        },
      ],
    }),
    monthDay('2026-08-02', { cashPaise: 400000 }),
  ]

  it('brings back the three cards the notebook had', async () => {
    await renderMonth(august)

    await waitFor(() => expect(screen.getByTestId('month-revenue')).toBeInTheDocument())
    expect(screen.getByTestId('month-expenses')).toBeInTheDocument()
    expect(screen.getByTestId('month-profit')).toBeInTheDocument()
  })

  it('names the basis beside the profit figure', async () => {
    await renderMonth(august)

    await waitFor(() => expect(screen.getByTestId('month-profit-basis')).toBeInTheDocument())
    expect(screen.getByTestId('month-profit-basis')).toHaveTextContent(/cash basis operating/i)
  })

  it('groups expenses by category with every line beneath', async () => {
    await renderMonth(august)

    await waitFor(() => expect(screen.getByTestId('month-category-Chicken')).toBeInTheDocument())
    expect(screen.getByTestId('month-category-Chicken')).toHaveTextContent('12 kg')
  })

  it('reads as final when every commission is settled', async () => {
    await renderMonth(august)

    await waitFor(() => expect(screen.getByTestId('month-revenue')).toBeInTheDocument())
    expect(screen.queryByTestId('month-undetermined')).not.toBeInTheDocument()
    expect(screen.getByTestId('month-revenue')).toHaveTextContent(/revenue actually received/i)
  })

  it('replaces the thirty-one drawer rows with one line', async () => {
    await renderMonth([
      monthDay('2026-08-01', { cashPaise: 1, drawerState: 'counted' }),
      monthDay('2026-08-02', { cashPaise: 1, drawerState: 'carried' }),
    ])

    await waitFor(() => expect(screen.getByTestId('month-drawer-summary')).toBeInTheDocument())
    expect(screen.getByTestId('month-drawer-summary')).toHaveTextContent('1 of 2 days counted')
    // The wall of rows is gone, not merely restyled.
    expect(screen.queryByTestId('month-day-2026-08-01')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ledger-month')).not.toBeInTheDocument()
  })
})

describe('the month says how far its figures can be trusted', () => {
  it('reads as a ceiling and counts the days still waiting', async () => {
    await renderMonth([
      monthDay('2026-08-01', { cashPaise: 1, channels: [unsettled(100000)] }),
      monthDay('2026-08-02', { cashPaise: 1, channels: [unsettled(100000)] }),
    ])

    await waitFor(() => expect(screen.getByTestId('month-undetermined')).toBeInTheDocument())
    expect(screen.getByTestId('month-undetermined')).toHaveTextContent(
      /2 days are still waiting for their commission/i,
    )
    expect(screen.getByTestId('month-revenue')).toHaveTextContent(/revenue received, at most/i)
    expect(screen.getByTestId('month-profit')).toHaveTextContent(/estimated profit, at most/i)
  })
})

describe('a date with no bills is named, and no cause is claimed', () => {
  /** August at both outlets: billing began part-way through the month. */
  const straddling = [
    ...Array.from({ length: 11 }, (_, index) => {
      const date = `2026-08-${String(index + 1).padStart(2, '0')}`
      return monthDay(date, {
        expenses: [
          { businessDate: date, category: 'Gas', note: null, amountPaise: 10000, isCash: true },
        ],
      })
    }),
    ...Array.from({ length: 20 }, (_, index) =>
      monthDay(`2026-08-${String(index + 12).padStart(2, '0')}`, { cashPaise: 100000 }),
    ),
  ]

  it('says how many dates had no sales, on both the revenue and the profit', async () => {
    await renderMonth(straddling)

    await waitFor(() =>
      expect(screen.getByTestId('month-no-sales-note-revenue')).toBeInTheDocument(),
    )
    expect(screen.getByTestId('month-no-sales-note-revenue')).toHaveTextContent(
      /11 dates had no sales/i,
    )
    // The one that matters: expenses on those dates are real, so the PROFIT is
    // understated and has to say so too.
    expect(screen.getByTestId('month-no-sales-note-profit')).toHaveTextContent(
      /11 dates had no sales/i,
    )
  })

  it('names every one of those dates on a tap', async () => {
    await renderMonth(straddling)

    await waitFor(() =>
      expect(screen.getByTestId('month-no-sales-dates-revenue')).toBeInTheDocument(),
    )
    await userEvent.click(screen.getByTestId('month-no-sales-dates-revenue'))

    const dialog = await screen.findByRole('dialog')
    // Zero-padded, and asserted that way: `'1 Aug 2026'` is a substring of
    // `'01 Aug 2026'` and would pass without proving the first date rendered.
    expect(dialog).toHaveTextContent('01 Aug 2026')
    expect(dialog).toHaveTextContent('11 Aug 2026')
    expect(dialog).not.toHaveTextContent('12 Aug 2026')
    // All eleven, not a truncated sample.
    expect(dialog.querySelectorAll('li')).toHaveLength(11)
  })

  it('still reports the aggregate and still offers a profit figure', async () => {
    await renderMonth(straddling)

    await waitFor(() => expect(screen.getByTestId('month-profit-figure')).toBeInTheDocument())
    // 20 dates x 1,000 revenue, less 11 x 100 of gas.
    expect(screen.getByTestId('month-revenue-net')).toHaveTextContent('20,000')
    expect(screen.getByTestId('month-profit-figure')).toHaveTextContent('18,900')
  })

  it('claims no reason a date was empty', async () => {
    await renderMonth(straddling)

    await waitFor(() =>
      expect(screen.getByTestId('month-no-sales-dates-revenue')).toBeInTheDocument(),
    )
    await userEvent.click(screen.getByTestId('month-no-sales-dates-revenue'))
    const dialog = await screen.findByRole('dialog')

    // The assertion is the ABSENCE of a claim, in the manner #11 asserts that no
    // nearby instant is proposed. An earlier draft of this change printed "the
    // outlet was not billing yet", which the app cannot know.
    //
    // The three causes DO appear — inside the sentence that refuses to choose
    // between them, which is the point. So the test strips that sentence and
    // asserts nothing causal survives anywhere else: a later edit that promotes
    // one of them to a claim fails here.
    expect(dialog).toHaveTextContent(/it does not say whether/i)
    const withoutDisclaimer = (dialog.textContent ?? '').replace(
      /This says only what the record holds:.*?could not bill\./i,
      '',
    )
    expect(withoutDisclaimer).not.toMatch(/billing/i)
    expect(withoutDisclaimer).not.toMatch(/closed/i)
    expect(withoutDisclaimer).not.toMatch(/shut/i)
  })
})

describe('a month with no sales at all offers no profit figure', () => {
  const barren = [
    monthDay('2026-08-01', {
      expenses: [
        {
          businessDate: '2026-08-01',
          category: 'Rent',
          note: null,
          amountPaise: 4000000,
          isCash: false,
        },
      ],
    }),
    monthDay('2026-08-02'),
  ]

  it('says so, and renders no profit card', async () => {
    await renderMonth(barren)

    await waitFor(() => expect(screen.getByTestId('month-no-sales')).toBeInTheDocument())
    // Not a ceiling, and not a loss. The two must not look alike.
    expect(screen.queryByTestId('month-profit')).not.toBeInTheDocument()
    expect(screen.queryByTestId('month-profit-figure')).not.toBeInTheDocument()
    expect(screen.queryByTestId('month-revenue')).not.toBeInTheDocument()
  })

  it('still lists what was spent', async () => {
    await renderMonth(barren)

    await waitFor(() => expect(screen.getByTestId('month-expenses')).toBeInTheDocument())
    expect(screen.getByTestId('month-category-Rent')).toBeInTheDocument()
    expect(screen.getByTestId('month-expenses-total')).toHaveTextContent('40,000')
  })
})

describe('a channel that reported nothing is said, not omitted', () => {
  it('names each silent channel instead of leaving it out of the breakdown', async () => {
    // The screenshot that prompted this: September showed Cash and UPI and no
    // Zomato or Swiggy at all, so the revenue total looked complete.
    await renderMonth([monthDay('2026-08-01', { cashPaise: 55600, upiPaise: 68700 })])

    await waitFor(() => expect(screen.getByTestId('month-zomato-silent')).toBeInTheDocument())
    expect(screen.getByTestId('month-zomato-silent')).toHaveTextContent(
      /Zomato recorded nothing this month/i,
    )
    expect(screen.getByTestId('month-swiggy-silent')).toHaveTextContent(
      /Swiggy recorded nothing this month/i,
    )
    // And it does not fabricate a nought figure for them.
    expect(screen.queryByTestId('month-zomato-gross')).not.toBeInTheDocument()
  })

  it('says a silent channel could be a sync that has not run, not only no orders', async () => {
    await renderMonth([monthDay('2026-08-01', { cashPaise: 55600 })])

    await waitFor(() => expect(screen.getByTestId('month-zomato-silent-why')).toBeInTheDocument())
    await userEvent.click(screen.getByTestId('month-zomato-silent-why'))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent(/sync that has not run/i)
    expect(dialog).toHaveTextContent(/cannot tell the two apart/i)
  })

  it('renders the full block once the channel has reported', async () => {
    await renderMonth([
      monthDay('2026-08-01', {
        cashPaise: 1,
        channels: [
          {
            channel: 'zomato',
            grossPaise: 100000,
            commissionPaise: 20000,
            netPaise: 80000,
            asOfAt: null,
          },
        ],
      }),
    ])

    await waitFor(() => expect(screen.getByTestId('month-zomato-gross')).toBeInTheDocument())
    expect(screen.queryByTestId('month-zomato-silent')).not.toBeInTheDocument()
    // Swiggy still had nothing, and still says so.
    expect(screen.getByTestId('month-swiggy-silent')).toBeInTheDocument()
  })
})

describe('what the month and the day gave away', () => {
  it('reports the month’s discounts beside the revenue they already reduced', async () => {
    await renderMonth([
      monthDay('2026-08-01', { cashPaise: 500000, discountPaise: 25000 }),
      monthDay('2026-08-02', { cashPaise: 400000, discountPaise: 15000 }),
    ])

    const section = await screen.findByTestId('month-discounts')
    expect(within(section).getByTestId('month-discount-total')).toHaveTextContent('₹400')
    // The sentence that stops a promotion reading as a slump.
    expect(section).toHaveTextContent(/revenue above is already net of it/i)
  })

  it('says a month discounted nothing rather than leaving the section out', async () => {
    await renderMonth([monthDay('2026-08-01', { cashPaise: 500000 })])

    const section = await screen.findByTestId('month-discounts')
    expect(within(section).getByTestId('month-discount-total')).toHaveTextContent('₹0')
    expect(section).toHaveTextContent(/nothing was discounted this month/i)
  })

  it('carries the ceiling qualification onto the giveaway when revenue is one', async () => {
    await renderMonth([
      monthDay('2026-08-01', {
        cashPaise: 100000,
        discountPaise: 5000,
        channels: [unsettled(300000)],
      }),
    ])

    const section = await screen.findByTestId('month-discounts')
    expect(section).toHaveTextContent(/both figures are ceilings while a commission is waiting/i)
  })
})
