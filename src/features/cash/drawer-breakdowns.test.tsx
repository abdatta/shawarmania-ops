import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { DataAdapters, DrawerState, ManualLedgerExpense } from '@/data-access/adapters'
import { AdaptersContext } from '@/data-access/adapters-context'
import { createMockAdapters } from '@/data-access/mock'
import { OUTLET_KALYANI_ID } from '@/data-access/mock/fixtures/outlets'

import { ExpensesBreakdown, ReceiptsBreakdown, type BreakdownContext } from './drawer-breakdowns'

/**
 * The two readings behind the balance card's figures.
 *
 * **The claim that carries this file is arithmetic**, not a screenshot: the day
 * groups sum to the figure the breakdown was opened from. A breakdown that looks
 * right and adds up wrong is the failure the whole design is arranged to
 * prevent, and the database half of that assertion is
 * `supabase/tests/43_the_drawer_explains_its_figures.sql`.
 *
 * The rest is about the one thing a fresh reader gets backwards: **these
 * partition the INTERVAL, never the calendar day** (design D1). The interval is
 * bounded by instants, so its oldest group is a *fragment* of a business date —
 * the part after the count that cut it — and it has to say which count that was.
 */

/** 28 Aug 2026, 11:23 pm at the counter. The instant the design's example uses. */
const COUNTED_AT = '2026-08-28T17:53:00.000Z'

function drawerState(overrides: Partial<DrawerState> = {}): DrawerState {
  return {
    outletId: OUTLET_KALYANI_ID,
    lastObservation: {
      id: 'obs-newest',
      outletId: OUTLET_KALYANI_ID,
      countedAt: COUNTED_AT,
      recordedAt: COUNTED_AT,
      isAnchor: false,
      openingPaise: 100000,
      expectedPaise: 100000,
      differencePaise: 0,
      countedTotalPaise: 100000,
      isApproximate: true,
      toleranceMinutes: 15,
      recordedBy: 'person-1',
      recordedByName: 'A Manager',
      correctedBy: null,
      correctedByName: null,
      onSite: true,
      awayReason: null,
      note: null,
      ownCashOut: [],
      adjustments: [],
      openingBreakPaise: null,
    },
    expectedNowPaise: 313000,
    leftInDrawerPaise: 100000,
    cashReceiptsSincePaise: 242000,
    cashReceiptsSinceCount: 10,
    cashExpensesSincePaise: 29000,
    cashExpensesSinceCount: 3,
    receiptsByDay: [
      { businessDate: '2026-08-29', paise: 230000, bills: 9 },
      { businessDate: '2026-08-28', paise: 12000, bills: 1 },
    ],
    cashExpensesByDay: [
      { businessDate: '2026-08-29', paise: 22000, rows: 2 },
      { businessDate: '2026-08-28', paise: 7000, rows: 1 },
    ],
    cashOutSincePaise: 0,
    cashOutSinceCount: 0,
    daysCovered: 2,
    recentObservations: [],
    nearbyCashBills: [],
    unsyncedDevices: { count: 0, since: null },
    exceptions: [],
    ...overrides,
  }
}

/** The context the surface computes from the outlet's own cutover. */
function context(overrides: Partial<BreakdownContext> = {}): BreakdownContext {
  return {
    state: drawerState(),
    today: '2026-08-29',
    countBusinessDate: '2026-08-28',
    ...overrides,
  }
}

let nextExpense = 0
function expense(overrides: Partial<ManualLedgerExpense> = {}): ManualLedgerExpense {
  nextExpense += 1
  return {
    id: `expense-${nextExpense}`,
    outletId: OUTLET_KALYANI_ID,
    businessDate: '2026-08-29',
    category: `Category ${nextExpense}`,
    isCash: true,
    amountPaise: 11000,
    note: null,
    occurredAt: null,
    createdAt: '2026-08-29T10:00:00.000Z',
    updatedAt: '2026-08-29T10:00:00.000Z',
    recordedBy: { id: 'person-1', name: 'A Manager' },
    source: null,
    updatedBy: null,
    recordedAway: false,
    voidedAt: null,
    voidedBy: null,
    voidedReason: null,
    ...overrides,
  }
}

function renderWith(
  node: (adapters: DataAdapters) => React.ReactElement,
  rows: ManualLedgerExpense[] = [],
) {
  const adapters = createMockAdapters('franchise_admin')
  const listRecentExpenses = vi.fn(async () => rows)
  adapters.manualLedger.listRecentExpenses = listRecentExpenses
  return {
    adapters,
    listRecentExpenses,
    ...render(
      <AdaptersContext.Provider value={adapters}>{node(adapters)}</AdaptersContext.Provider>,
    ),
  }
}

describe('Cash from Bills opens a day-by-day reading of the interval', () => {
  it('lists each business date newest first, with its cash and its bills', async () => {
    renderWith(() => <ReceiptsBreakdown open onClose={() => undefined} context={context()} />)

    const today = screen.getByTestId('receipts-day-2026-08-29')
    const earlier = screen.getByTestId('receipts-day-2026-08-28')

    expect(today.textContent).toMatch(/2,300/)
    expect(today.textContent).toMatch(/9 bills/)
    expect(earlier.textContent).toMatch(/120/)
    expect(earlier.textContent).toMatch(/1 bill\b/)

    // Newest first.
    expect(today.compareDocumentPosition(earlier) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('labels the current business date Today, and names the count that cut the oldest', async () => {
    renderWith(() => <ReceiptsBreakdown open onClose={() => undefined} context={context()} />)

    expect(screen.getByTestId('receipts-day-2026-08-29').textContent).toMatch(/^Today/)

    // **The fragment says which count bounds it** (design D1). The interval
    // begins at 11:23 pm on 28 Aug, so that group is half a business date and
    // reading it as the whole day would put cash the previous count already
    // settled inside this one.
    expect(screen.getByTestId('receipts-day-2026-08-28').textContent).toMatch(
      /28 Aug · since the count at 11:23 pm/,
    )
  })

  it('carries no qualifier on a group wholly inside the interval', async () => {
    // A count that landed before 28 Aug's cutover: nothing on 28 Aug was
    // settled by it, so that group is the whole business date.
    renderWith(() => (
      <ReceiptsBreakdown
        open
        onClose={() => undefined}
        context={context({ countBusinessDate: '2026-08-27' })}
      />
    ))

    expect(screen.getByTestId('receipts-day-2026-08-28').textContent).not.toMatch(/since the count/)
  })

  it('states the interval total, and the groups sum to it', async () => {
    const state = drawerState()
    renderWith(() => (
      <ReceiptsBreakdown open onClose={() => undefined} context={context({ state })} />
    ))

    // **The assertion this whole design exists to make possible** (design D8).
    // Summed here, in the test, precisely because nothing in the app is allowed
    // to: the groups and the tile come from one predicate a `group by` apart.
    expect(state.receiptsByDay.reduce((sum, day) => sum + day.paise, 0)).toBe(
      state.cashReceiptsSincePaise,
    )
    expect(state.receiptsByDay.reduce((sum, day) => sum + day.bills, 0)).toBe(
      state.cashReceiptsSinceCount,
    )
    expect(screen.getByTestId('receipts-breakdown-total').textContent).toMatch(/2,420/)
  })
})

describe('Cash Expenses opens the expense list, by business date', () => {
  const rows = [
    // Inside the interval, on the current business date.
    expense({ businessDate: '2026-08-29', amountPaise: 15000 }),
    expense({ businessDate: '2026-08-29', amountPaise: 7000 }),
    // Listed and marked, and in no total: it never came out of the drawer.
    expense({ businessDate: '2026-08-29', amountPaise: 500000, isCash: false }),
    // On the bounded business date, AFTER the count.
    expense({
      businessDate: '2026-08-28',
      amountPaise: 7000,
      occurredAt: '2026-08-28T18:10:00.000Z',
    }),
    // On the same date but BEFORE it — settled by that count, so counted and
    // never listed (design D3).
    ...[1, 2, 3, 4].map((minute) =>
      expense({
        businessDate: '2026-08-28',
        amountPaise: 3000,
        occurredAt: `2026-08-28T16:0${minute}:00.000Z`,
      }),
    ),
  ]

  it('renders one list per business date, each with its own Add', async () => {
    renderWith(
      () => (
        <ExpensesBreakdown
          open
          onClose={() => undefined}
          context={context()}
          outletId={OUTLET_KALYANI_ID}
          viewerId="person-1"
          onChanged={() => undefined}
        />
      ),
      rows,
    )

    await waitFor(() => expect(screen.getByTestId('expenses-day-2026-08-28')).toBeInTheDocument())

    for (const businessDate of ['2026-08-29', '2026-08-28']) {
      const group = screen.getByTestId(`expenses-day-${businessDate}`)
      expect(within(group).getByRole('button', { name: /add expense/i })).toBeInTheDocument()
    }
  })

  it('lists only the interval, and says how many earlier ones the count settled', async () => {
    renderWith(
      () => (
        <ExpensesBreakdown
          open
          onClose={() => undefined}
          context={context()}
          outletId={OUTLET_KALYANI_ID}
          viewerId="person-1"
          onChanged={() => undefined}
        />
      ),
      rows,
    )

    const group = await screen.findByTestId('expenses-day-2026-08-28')

    // One row after the count, and the four before it are counted, never listed.
    expect(within(group).getAllByTestId(/^ledger-expense-expense-/)).toHaveLength(1)
    expect(screen.getByTestId('expenses-day-settled-2026-08-28').textContent).toMatch(
      /4 earlier expenses this day were in the last count/i,
    )

    // The current business date is wholly inside the interval, so it omits none.
    expect(screen.queryByTestId('expenses-day-settled-2026-08-29')).not.toBeInTheDocument()
  })

  it('marks a non-cash row and keeps it out of the group total', async () => {
    renderWith(
      () => (
        <ExpensesBreakdown
          open
          onClose={() => undefined}
          context={context()}
          outletId={OUTLET_KALYANI_ID}
          viewerId="person-1"
          onChanged={() => undefined}
        />
      ),
      rows,
    )

    const group = await screen.findByTestId('expenses-day-2026-08-29')
    expect(group.textContent).toMatch(/not cash/i)

    // ₹220, from the grouped reader — the ₹5,000 that did not come from the
    // drawer is on screen and in no total.
    expect(screen.getByTestId('expenses-day-total-2026-08-29').textContent).toMatch(/220/)
    expect(screen.getByTestId('expenses-breakdown-total').textContent).toMatch(/290/)
  })

  it('renders the current business date even with nothing in it, so there is somewhere to add', async () => {
    renderWith(
      () => (
        <ExpensesBreakdown
          open
          onClose={() => undefined}
          context={context({
            state: drawerState({
              cashExpensesByDay: [],
              cashExpensesSincePaise: 0,
              cashExpensesSinceCount: 0,
            }),
          })}
          outletId={OUTLET_KALYANI_ID}
          viewerId="person-1"
          onChanged={() => undefined}
        />
      ),
      [],
    )

    const today = await screen.findByTestId('expenses-day-2026-08-29')
    expect(within(today).getByRole('button', { name: /add expense/i })).toBeInTheDocument()
    // And a past date the interval holds nothing for is not rendered at all.
    expect(screen.queryByTestId('expenses-day-2026-08-28')).not.toBeInTheDocument()
  })

  it('records against the group it was added in, and reloads the drawer', async () => {
    const user = userEvent.setup()
    const onChanged = vi.fn()
    const { adapters } = renderWith(
      () => (
        <ExpensesBreakdown
          open
          onClose={() => undefined}
          context={context()}
          outletId={OUTLET_KALYANI_ID}
          viewerId="person-1"
          onChanged={onChanged}
        />
      ),
      rows,
    )
    const createExpense = vi.spyOn(adapters.manualLedger, 'createExpense')

    const group = await screen.findByTestId('expenses-day-2026-08-28')
    await user.click(within(group).getByRole('button', { name: /add expense/i }))

    await user.type(await screen.findByTestId('expense-category'), 'Vegetables')
    await user.type(screen.getByTestId('expense-amount'), '240')
    await user.click(screen.getByRole('button', { name: /record expense/i }))

    // **Dated to the group it was recorded in**, which is the whole point: an
    // expense entered now against 28 Aug carries today's recording instant, so
    // it lands inside the current interval and the balance moves at once.
    await waitFor(() => expect(createExpense).toHaveBeenCalled())
    expect(createExpense.mock.calls[0]?.[0]).toMatchObject({
      businessDate: '2026-08-28',
      outletId: OUTLET_KALYANI_ID,
      amountPaise: 24000,
    })

    // And the drawer is re-read, so `expectedNowPaise` moves without a refresh.
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })

  it('stays open when the Add form inside it is dismissed', async () => {
    const user = userEvent.setup()
    renderWith(
      () => (
        <ExpensesBreakdown
          open
          onClose={() => undefined}
          context={context()}
          outletId={OUTLET_KALYANI_ID}
          viewerId="person-1"
          onChanged={() => undefined}
        />
      ),
      rows,
    )

    const group = await screen.findByTestId('expenses-day-2026-08-29')
    await user.click(within(group).getByRole('button', { name: /add expense/i }))
    expect(await screen.findByTestId('expense-category')).toBeInTheDocument()

    // **A dialog inside a dialog** (design D7). `close` does not bubble in the
    // DOM but React's synthetic system propagates it up the REACT tree, and a
    // portalled modal's React parent may sit inside another modal — so without
    // the `stopPropagation` in `src/components/ui/modal.tsx`, dismissing this
    // form takes the breakdown with it. Escape is not testable here and
    // `e2e/dialog-escape.spec.ts` exists so nobody chases it twice.
    // The LAST Close on screen is the Add form's own: the breakdown's header
    // carries the first, and a FormSheet renders nothing while it is shut.
    const closes = screen.getAllByRole('button', { name: /^close$/i })
    expect(closes).toHaveLength(2)
    await user.click(closes.at(-1)!)

    await waitFor(() => expect(screen.queryByTestId('expense-category')).not.toBeInTheDocument())
    expect(screen.getByTestId('expenses-breakdown')).toBeInTheDocument()
  })
})
