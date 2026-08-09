import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router'
import { describe, expect, it } from 'vitest'

import type { DataAdapters } from '@/data-access/adapters'
import { AdaptersContext } from '@/data-access/adapters-context'
import { createMockAdapters } from '@/data-access/mock'
import { OUTLET_KALYANI_ID, OUTLET_KANCHRAPARA_ID } from '@/data-access/mock/fixtures/outlets'
import { formatBusinessDate, formatPaise, shiftBusinessDate } from '@/domain'
import { appRoutes } from '@/routes'
import { SessionContext } from '@/session/context'
import { demoSessionFor } from '@/test/session'
import { ROLE_SEGMENTS, type Role } from '@/session/session'
import { chooseOutlet } from '@/test/outlet-scope'

import { monthOf } from './ledger'
import { ManualLedgerSurface } from './manual-ledger-surface'

/**
 * The manual ledger's surface (#36) — temporary, and these tests go with it.
 *
 * Four claims carry them, and each is a claim the arithmetic tests cannot make:
 * the surface exists for an owner and for nobody else, a new day inherits the
 * previous close and rates, editing a past day's commission moves the month and
 * never the drawer, and correcting an old day leaves every later day's stored
 * figures exactly where they were.
 */

function renderLedger(adapters: DataAdapters = createMockAdapters('super_admin')) {
  return {
    adapters,
    ...render(
      <MemoryRouter>
        <SessionContext.Provider value={demoSessionFor('super_admin')}>
          <AdaptersContext.Provider value={adapters}>
            <ManualLedgerSurface />
          </AdaptersContext.Provider>
        </SessionContext.Provider>
      </MemoryRouter>,
    ),
  }
}

/** The seeded demo month lives at Kalyani; yesterday closed on ₹7,950. */
const YESTERDAY_CLOSE_PAISE = 795_000

/**
 * Go to a business date.
 *
 * The day control is a real date field rather than a list of the last thirty-five
 * days, so a date is set on it. `fireEvent.change` rather than typing: a date input
 * accepts keystrokes in the locale's own order, and a test that depended on that
 * order would fail on a machine configured differently.
 */
async function openDay(businessDate: string): Promise<HTMLInputElement> {
  const picker = (await screen.findByTestId('ledger-day-picker')) as HTMLInputElement
  fireEvent.change(picker, { target: { value: businessDate } })
  return picker
}

/**
 * The one seeded day whose opening disagrees with the previous day's count.
 *
 * Selected by the disagreement itself, and read across this month and the one
 * before it, because the seeds are `daysAgo` offsets from today: which month they
 * land in changes with the calendar, and on the 1st they are all in the month
 * before. Throws if there is not exactly one break, so a fixture edit that removes
 * it — or adds a second — fails saying so rather than by an assertion further down.
 */
async function brokenChainDay(adapters: DataAdapters) {
  const picker = (await screen.findByTestId('ledger-day-picker')) as HTMLInputElement
  const thisMonth = monthOf(picker.value)
  const lastMonth = monthOf(shiftBusinessDate(`${thisMonth}-01`, -1))

  const months = await Promise.all(
    [lastMonth, thisMonth].map((month) => adapters.manualLedger.getMonth(OUTLET_KALYANI_ID, month)),
  )
  const days = months
    .flatMap((month) => month.days)
    .sort((a, b) => a.businessDate.localeCompare(b.businessDate))

  const broken = days.filter(
    (day, index) => index > 0 && day.openingCashPaise !== days[index - 1]?.countedCashPaise,
  )
  if (broken.length !== 1 || !broken[0]) {
    throw new Error(
      `The demo fixture should contain exactly one broken chain; found ${broken.length}.`,
    )
  }
  return broken[0]
}

describe('the manual ledger surface', () => {
  it('opens on today, waiting behind a shape rather than a sentence', () => {
    renderLedger()

    // Asserted synchronously, before any read can have resolved: the placeholder
    // is the surface's own silhouette, so the figures arriving do not push the
    // pickers above them down the screen. Awaiting first would race the read and
    // assert nothing.
    expect(screen.getByTestId('ledger-picker-loading')).toBeInTheDocument()
    expect(screen.getByTestId('ledger-day-waiting')).toBeInTheDocument()

    // The wait is announced as well as shown, and never by motion alone: a reader
    // who cannot see the shimmer is told the same thing. There are two waits on
    // screen here, so there are two announcements.
    expect(screen.getAllByRole('status')).toHaveLength(2)
    for (const region of screen.getAllByRole('status')) {
      expect(region).toHaveAttribute('aria-busy', 'true')
    }
  })

  it('replaces the placeholder with the day’s own form', async () => {
    renderLedger()
    expect(await screen.findByTestId('ledger-day-form')).toBeInTheDocument()
    expect(screen.queryByTestId('ledger-day-waiting')).not.toBeInTheDocument()
  })

  it('offers the previous recorded day’s close and rates, both editable', async () => {
    renderLedger()

    const opening = await screen.findByTestId('opening-cash')
    await waitFor(() => {
      expect(opening).toHaveValue(String(YESTERDAY_CLOSE_PAISE / 100))
    })
    // The renegotiated rate, inherited from the day it changed on.
    expect(screen.getByTestId('zomato-commission')).toHaveValue('18')
    expect(screen.getByTestId('swiggy-commission')).toHaveValue('21')

    // Editable, because the figure is stored per day and a day may genuinely have
    // opened elsewhere.
    await userEvent.clear(opening)
    await userEvent.type(opening, '8000')
    expect(opening).toHaveValue('8000')
  })

  it('says the first day at an outlet inherits nothing', async () => {
    renderLedger()

    // Kanchrapara is deliberately unseeded.
    await chooseOutlet(OUTLET_KANCHRAPARA_ID)

    const opening = await screen.findByTestId('opening-cash')
    await waitFor(() => {
      expect(opening).toHaveValue('')
    })
    expect(screen.getByTestId('zomato-commission')).toHaveValue('')
    expect(
      screen.getByText(/first day at this outlet, so nothing is inherited/i),
    ).toBeInTheDocument()
  })

  it('shows the difference as it is typed, in words as well as by sign', async () => {
    renderLedger()

    await screen.findByTestId('ledger-day-form')
    // Nothing is claimed until the figures that decide it have been typed.
    expect(screen.getByTestId('reading-incomplete')).toBeInTheDocument()

    await userEvent.type(screen.getByTestId('cash-revenue'), '12000')
    await userEvent.type(screen.getByTestId('counted-cash'), '19950')

    const reading = await screen.findByTestId('day-reading')
    expect(within(reading).getByTestId('expected-cash')).toHaveTextContent(
      formatPaise(YESTERDAY_CLOSE_PAISE + 1_200_000),
    )
    expect(screen.getByTestId('day-difference')).toHaveAttribute('data-difference', 'balanced')

    // A shortfall and a surplus must never read alike.
    await userEvent.clear(screen.getByTestId('counted-cash'))
    await userEvent.type(screen.getByTestId('counted-cash'), '19700')
    expect(screen.getByTestId('day-difference')).toHaveAttribute('data-difference', 'short')
    expect(screen.getByTestId('day-difference')).toHaveTextContent(/missing from the drawer/i)

    await userEvent.clear(screen.getByTestId('counted-cash'))
    await userEvent.type(screen.getByTestId('counted-cash'), '20200')
    expect(screen.getByTestId('day-difference')).toHaveAttribute('data-difference', 'over')
    expect(screen.getByTestId('day-difference')).toHaveTextContent(/more than expected/i)
  })

  it('reports a broken opening-cash chain without repairing it', async () => {
    const { adapters } = renderLedger()
    await screen.findByTestId('ledger-day-form')

    // The seeded break: this day opens on ₹15,000 although the day before it
    // closed on ₹14,750.
    //
    // Found by the property that makes it the break rather than by its opening
    // figure, which two seeded days share, and read across both months the seeded
    // window can span — the seeds are `daysAgo` offsets, so on the 1st of a month
    // every one of them is in the month before. An earlier version of this named
    // one month and one figure, and passed only while the month boundary happened
    // to filter the ambiguity out.
    const broken = await brokenChainDay(adapters)

    await openDay(broken.businessDate)

    const signal = await screen.findByTestId('chain-break')
    expect(signal).toHaveTextContent(/gap of/i)
    expect(signal).toHaveTextContent(/Nothing here has been changed/i)

    // Reported on the reading, with no form open: a break is a fact about what is
    // stored, so it must not need the inputs on screen to be visible.
    expect(screen.queryByTestId('opening-cash')).not.toBeInTheDocument()
    expect(screen.getByTestId('reading-opening')).toHaveTextContent(formatPaise(1_500_000))

    // Repaired nothing: the stored opening is still what was typed.
    await userEvent.click(screen.getByTestId('edit-day'))
    expect(await screen.findByTestId('opening-cash')).toHaveValue('15000')
    const after = await adapters.manualLedger.getDay(OUTLET_KALYANI_ID, broken.businessDate)
    expect(after?.openingCashPaise).toBe(1_500_000)
  })

  it('requires a category, accepts a new one, and leaves the note optional', async () => {
    renderLedger()
    await screen.findByTestId('ledger-day-form')

    await userEvent.click(await screen.findByTestId('add-ledger-expense'))
    await userEvent.type(screen.getByTestId('expense-amount'), '2400')
    await userEvent.click(screen.getByRole('button', { name: /record expense/i }))

    // Refused, in the sheet where the button was pressed.
    expect(await screen.findByTestId('form-sheet-error')).toHaveTextContent(
      /what the money was spent on/i,
    )

    await userEvent.type(screen.getByTestId('expense-category'), 'Chicken')
    await userEvent.click(screen.getByRole('button', { name: /record expense/i }))

    const list = await screen.findByTestId('ledger-expense-list')
    expect(list).toHaveTextContent('Chicken')
    // One visible word beside the category, and the rest of it announced.
    expect(within(list).getByText('Cash')).toBeInTheDocument()
    expect(within(list).getByText(/from the drawer/)).toHaveClass('sr-only')
  })

  it('subtracts only a cash expense from the drawer', async () => {
    renderLedger()
    await screen.findByTestId('ledger-day-form')
    await userEvent.type(screen.getByTestId('cash-revenue'), '12000')
    await userEvent.type(screen.getByTestId('counted-cash'), '19950')

    const before = (await screen.findByTestId('expected-cash')).textContent

    await userEvent.click(screen.getByTestId('add-ledger-expense'))
    await userEvent.type(screen.getByTestId('expense-category'), 'Electricity')
    await userEvent.type(screen.getByTestId('expense-amount'), '3200')
    await userEvent.type(screen.getByTestId('expense-description'), 'Electricity bill, by UPI')
    await userEvent.selectOptions(screen.getByTestId('expense-is-cash'), 'other')
    await userEvent.click(screen.getByRole('button', { name: /record expense/i }))

    await screen.findByTestId('ledger-expense-list')
    // A non-cash expense is real money and not this drawer's.
    expect(screen.getByTestId('expected-cash')).toHaveTextContent(before ?? '')
    expect(screen.getByTestId('reading-cash-expenses')).toHaveTextContent(formatPaise(0))
  })

  it('withdraws an expense through the row’s menu, and the drawer stops counting it', async () => {
    renderLedger()
    await screen.findByTestId('ledger-day-form')
    await userEvent.type(screen.getByTestId('cash-revenue'), '12000')
    await userEvent.type(screen.getByTestId('counted-cash'), '19950')

    await userEvent.click(screen.getByTestId('add-ledger-expense'))
    await userEvent.type(screen.getByTestId('expense-category'), 'Gas')
    await userEvent.type(screen.getByTestId('expense-amount'), '1600')
    await userEvent.click(screen.getByRole('button', { name: /record expense/i }))

    const list = await screen.findByTestId('ledger-expense-list')
    await waitFor(() =>
      expect(screen.getByTestId('reading-cash-expenses')).toHaveTextContent('1,600'),
    )

    // Edit and Withdraw live behind one kebab, so a row stays one control wide.
    await userEvent.click(within(list).getByRole('button', { name: /actions for gas/i }))
    await userEvent.click(await screen.findByRole('button', { name: 'Withdraw' }))
    await userEvent.click(await screen.findByRole('button', { name: /withdraw it/i }))

    // The row keeps its name and loses everything else: struck through, no menu,
    // and — the point of a withdrawal rather than a delete — still on the list.
    const withdrawn = await within(list).findByText('Gas')
    expect(withdrawn).toHaveClass('line-through')
    expect(within(list).queryByRole('button', { name: /actions for gas/i })).toBeNull()

    // And the drawer no longer counts it.
    expect(screen.getByTestId('reading-cash-expenses')).toHaveTextContent(formatPaise(0))
  })

  it('names the month’s basis in words beside the figure', async () => {
    renderLedger()

    await userEvent.click(await screen.findByTestId('ledger-view-month'))

    expect(await screen.findByTestId('month-profit-basis')).toHaveTextContent(
      /cash basis operating estimate/i,
    )
    // And no consumption-basis figure is offered, because no stock is valued.
    expect(screen.getByTestId('month-profit')).toHaveTextContent(/no consumption-basis figure/i)
  })

  it('reconciles the month’s profit against its own expenses by category', async () => {
    const { adapters } = renderLedger()
    await userEvent.click(await screen.findByTestId('ledger-view-month'))
    await screen.findByTestId('month-profit-figure')

    const month = await adapters.manualLedger.getMonth(OUTLET_KALYANI_ID, await currentMonth())
    const counted = month.expenses.filter((expense) => expense.voidedAt === null)
    const withdrawn = month.expenses.filter((expense) => expense.voidedAt !== null)
    const spent = counted.reduce((running, expense) => running + expense.amountPaise, 0)

    // The premise: the demo month really does contain a withdrawn row, so the
    // filter above is doing something rather than passing vacuously.
    expect(withdrawn.length).toBeGreaterThan(0)

    expect(screen.getByTestId('month-expenses-total')).toHaveTextContent(formatPaise(spent))
    // Every counted expense is shown with its optional note when one exists.
    for (const expense of counted) {
      if (expense.note) expect(screen.getByTestId('month-expenses')).toHaveTextContent(expense.note)
    }
    // And a withdrawn one is absent from the month's breakdown entirely — the
    // month is a total, and a row that counts toward nothing has no line in it.
    for (const expense of withdrawn) {
      if (expense.note) {
        expect(screen.getByTestId('month-expenses')).not.toHaveTextContent(expense.note)
      }
    }
  })

  it('nets each aggregator day by its own rate, so the month is not one rate applied to a total', async () => {
    const { adapters } = renderLedger()
    await userEvent.click(await screen.findByTestId('ledger-view-month'))
    await screen.findByTestId('month-zomato-net')

    const month = await adapters.manualLedger.getMonth(OUTLET_KALYANI_ID, await currentMonth())
    const rates = new Set(month.days.map((day) => day.zomatoCommissionBp))
    // The premise: the demo month really does change rate partway through.
    expect(rates.size).toBeGreaterThan(1)

    const gross = month.days.reduce((running, day) => running + day.zomatoRevenuePaise, 0)
    const perDay = month.days.reduce(
      (running, day) =>
        running + Math.trunc((day.zomatoRevenuePaise * day.zomatoCommissionBp + 5000) / 10_000),
      0,
    )
    const oneRate = Math.trunc((gross * [...rates][0]! + 5000) / 10_000)

    expect(screen.getByTestId('month-zomato-commission')).toHaveTextContent(formatPaise(-perDay))
    expect(perDay).not.toBe(oneRate)
  })

  it('tells an unrecorded month apart from a recorded zero', async () => {
    renderLedger()

    await chooseOutlet(OUTLET_KANCHRAPARA_ID)
    await userEvent.click(screen.getByTestId('ledger-view-month'))

    // Not "₹0": nobody measured this month, and zero is a measurement.
    expect(await screen.findByText(/Nothing is recorded for this month/i)).toBeInTheDocument()
    expect(screen.queryByTestId('month-profit')).not.toBeInTheDocument()
  })

  describe('choosing what to look at', () => {
    it('walks a day at a time and stops at the outlet’s today', async () => {
      renderLedger()
      const day = (await screen.findByTestId('ledger-day-picker')) as HTMLInputElement
      const today = day.value

      // Opens on today, named as the attendance day heading names it.
      expect(screen.getByTestId('ledger-day-open')).toHaveTextContent('Today')
      // And cannot be walked into the future: the database refuses a future
      // business date, so the control must not offer one.
      expect(screen.getByTestId('ledger-step-forward')).toBeDisabled()

      await userEvent.click(screen.getByTestId('ledger-step-back'))
      await waitFor(() => {
        expect((screen.getByTestId('ledger-day-picker') as HTMLInputElement).value).not.toBe(today)
      })
      expect(screen.getByTestId('ledger-step-forward')).toBeEnabled()
      // Written as every other surface writes a day, never as the browser's
      // locale would print a date field.
      expect(screen.getByTestId('ledger-day-open')).toHaveTextContent(
        formatBusinessDate(shiftBusinessDate(today, -1)),
      )

      await userEvent.click(screen.getByTestId('ledger-step-forward'))
      await waitFor(() => {
        expect((screen.getByTestId('ledger-day-picker') as HTMLInputElement).value).toBe(today)
      })
    })

    it('leaves the day unwritable except through the calendar or the steps', async () => {
      renderLedger()
      const day = await screen.findByTestId('ledger-day-picker')

      // The field that owns the platform calendar is not reachable by tab and is
      // not announced; the button in front of it is the control.
      expect(day).toHaveAttribute('tabIndex', '-1')
      expect(day).toHaveAttribute('aria-hidden', 'true')
      expect(screen.getByTestId('ledger-day-open')).toHaveAccessibleName(/opens a calendar/i)
    })

    it('names the month in words and steps by whole months', async () => {
      renderLedger()
      await userEvent.click(await screen.findByTestId('ledger-view-month'))

      const label = await screen.findByTestId('ledger-month-picker')
      const opened = label.getAttribute('data-month')
      expect(label).toHaveTextContent(/\w+ \d{4}/)
      expect(screen.getByTestId('ledger-step-forward')).toBeDisabled()

      await userEvent.click(screen.getByTestId('ledger-step-back'))
      await waitFor(() => {
        expect(screen.getByTestId('ledger-month-picker')).not.toHaveAttribute('data-month', opened)
      })
    })
  })

  describe('the entry form', () => {
    it('keeps the rules off the screen until they are asked for', async () => {
      renderLedger()
      await screen.findByTestId('ledger-day-form')

      // The rule is load-bearing and it is not occupying the form.
      expect(screen.queryByText(/genuinely lighter/i)).not.toBeInTheDocument()
      expect(screen.queryByTestId('hint-drawer-panel')).not.toBeInTheDocument()

      const trigger = screen.getByTestId('hint-drawer')
      expect(trigger).toHaveAttribute('aria-expanded', 'false')

      await userEvent.click(trigger)
      expect(trigger).toHaveAttribute('aria-expanded', 'true')
      expect(await screen.findByTestId('hint-drawer-panel')).toHaveTextContent(/genuinely lighter/i)

      // And it gets out of the way again, from the keyboard.
      await userEvent.keyboard('{Escape}')
      expect(screen.queryByTestId('hint-drawer-panel')).not.toBeInTheDocument()
    })

    it('nets each aggregator as it is typed, from that block’s own rate', async () => {
      renderLedger()
      await screen.findByTestId('ledger-day-form')

      // ₹3,310 less 18%, rounded by the one shared rule.
      await userEvent.type(screen.getByTestId('zomato-revenue'), '3310')
      expect(screen.getByTestId('zomato-revenue-net')).toHaveTextContent(formatPaise(271_420))

      // Swiggy's block is reduced by Swiggy's rate and is untouched by Zomato's.
      await userEvent.type(screen.getByTestId('swiggy-revenue'), '2260')
      expect(screen.getByTestId('swiggy-revenue-net')).toHaveTextContent(formatPaise(178_540))
    })

    it('computes nothing from a rate nobody has given', async () => {
      renderLedger()
      await chooseOutlet(OUTLET_KANCHRAPARA_ID)
      await screen.findByTestId('ledger-day-form')
      await waitFor(() => {
        expect(screen.getByTestId('zomato-commission')).toHaveValue('')
      })

      // ₹0 here would be a figure standing where an unanswered question is.
      await userEvent.type(screen.getByTestId('zomato-revenue'), '3310')
      expect(screen.getByTestId('zomato-revenue-net')).toHaveTextContent('—')
    })
  })

  describe('a recorded day', () => {
    it('collapses to a reading, and gives every figure back on Edit', async () => {
      renderLedger()
      // Today is unrecorded in the demo month, so the form is what opens.
      await screen.findByTestId('ledger-day-form')

      await userEvent.type(screen.getByTestId('cash-revenue'), '12000')
      await userEvent.type(screen.getByTestId('upi-revenue'), '4000')
      await userEvent.type(screen.getByTestId('counted-cash'), '19950')
      await userEvent.click(screen.getByTestId('save-day'))

      // Saved, and there is nothing left on screen to change by accident.
      const card = await screen.findByTestId('ledger-day-recorded')
      expect(screen.getByTestId('day-saved')).toBeInTheDocument()
      expect(screen.queryByTestId('ledger-day-form')).not.toBeInTheDocument()
      expect(screen.queryByTestId('cash-revenue')).not.toBeInTheDocument()

      // The revenue side, which the drawer card deliberately never shows — and the
      // rate it was netted at, so the figure can be checked without opening a form.
      expect(within(card).getByTestId('recorded-upi')).toHaveTextContent(formatPaise(400_000))
      expect(within(card).getByText(/Less commission at 18%/)).toBeInTheDocument()
      // The drawer is still worked out, below it.
      expect(screen.getByTestId('day-difference')).toHaveAttribute('data-difference', 'balanced')

      await userEvent.click(screen.getByTestId('edit-day'))
      expect(await screen.findByTestId('cash-revenue')).toHaveValue('12000')
      expect(screen.getByTestId('upi-revenue')).toHaveValue('4000')
      expect(screen.getByTestId('counted-cash')).toHaveValue('19950')
    })

    it('writes nothing when an edit is cancelled', async () => {
      const { adapters } = renderLedger()
      const month = await adapters.manualLedger.getMonth(OUTLET_KALYANI_ID, await currentMonth())
      const target = month.days.at(-1)
      if (!target) throw new Error('The demo month no longer has a recorded day.')

      await openDay(target.businessDate)
      await screen.findByTestId('ledger-day-recorded')
      const cashBefore = screen.getByTestId('reading-cash-revenue').textContent

      await userEvent.click(screen.getByTestId('edit-day'))
      await userEvent.clear(screen.getByTestId('cash-revenue'))
      await userEvent.type(screen.getByTestId('cash-revenue'), '1')
      await userEvent.click(screen.getByTestId('cancel-day-edit'))

      // Back to the reading it was, and the stored row is untouched.
      await screen.findByTestId('ledger-day-recorded')
      expect(screen.getByTestId('reading-cash-revenue')).toHaveTextContent(cashBefore ?? '')
      expect(await adapters.manualLedger.getDay(OUTLET_KALYANI_ID, target.businessDate)).toEqual(
        target,
      )
    })

    it('shows a cash movement’s reason beside the amount it explains', async () => {
      const { adapters } = renderLedger()
      const month = await adapters.manualLedger.getMonth(OUTLET_KALYANI_ID, await currentMonth())
      const moved = month.days.find((day) => day.cashRemovedReason ?? day.cashAddedReason)
      if (!moved) throw new Error('The demo month no longer moves cash in or out of a drawer.')

      await openDay(moved.businessDate)
      const reading = await screen.findByTestId('day-reading')

      // Without this the figure is unaccountable a month later: the form that
      // captured the reason is not on screen for a recorded day.
      expect(reading).toHaveTextContent(moved.cashRemovedReason ?? moved.cashAddedReason ?? '')
    })
  })

  describe('a retrospective correction', () => {
    it('moves the month’s profit and never the day’s drawer', async () => {
      const { adapters } = renderLedger()
      const month = await adapters.manualLedger.getMonth(OUTLET_KALYANI_ID, await currentMonth())
      const target = month.days.find((day) => day.zomatoRevenuePaise > 0)
      if (!target) throw new Error('The demo month no longer has an aggregator day.')

      await openDay(target.businessDate)
      // A recorded day opens as a reading, so a correction is a deliberate act.
      await screen.findByTestId('ledger-day-recorded')
      const expectedBefore = screen.getByTestId('expected-cash').textContent

      await userEvent.click(screen.getByTestId('edit-day'))
      await userEvent.clear(screen.getByTestId('zomato-commission'))
      await userEvent.type(screen.getByTestId('zomato-commission'), '30')
      await userEvent.click(screen.getByTestId('save-day'))
      await screen.findByTestId('day-saved')

      // The drawer did not move: commission is not cash.
      expect(screen.getByTestId('expected-cash')).toHaveTextContent(expectedBefore ?? '')
      const saved = await adapters.manualLedger.getDay(OUTLET_KALYANI_ID, target.businessDate)
      expect(saved?.zomatoCommissionBp).toBe(3000)
      expect(saved?.countedCashPaise).toBe(target.countedCashPaise)
    })

    it('leaves every later day’s stored figures byte-for-byte where they were', async () => {
      const { adapters } = renderLedger()
      const before = await adapters.manualLedger.getMonth(OUTLET_KALYANI_ID, await currentMonth())
      const earliest = before.days[0]
      const later = before.days.slice(1)
      if (!earliest || later.length === 0) {
        throw new Error('The demo month no longer has an earlier day with later days after it.')
      }

      await openDay(earliest.businessDate)
      await screen.findByTestId('ledger-day-recorded')

      // Correct the earliest day's count — the edit that a derived opening cash
      // would have propagated silently through every later day.
      await userEvent.click(screen.getByTestId('edit-day'))
      await userEvent.clear(screen.getByTestId('counted-cash'))
      await userEvent.type(screen.getByTestId('counted-cash'), '1')
      await userEvent.click(screen.getByTestId('save-day'))
      await screen.findByTestId('day-saved')

      const after = await adapters.manualLedger.getMonth(OUTLET_KALYANI_ID, await currentMonth())
      for (const day of later) {
        const now = after.days.find((candidate) => candidate.businessDate === day.businessDate)
        expect(now, day.businessDate).toEqual(day)
      }
    })
  })
})

describe('who the manual ledger is for', () => {
  function renderAt(path: string) {
    const router = createMemoryRouter(appRoutes, { initialEntries: [path] })
    return render(<RouterProvider router={router} />)
  }

  // Outlet staff only. `the-ledger-opens-to-the-outlet` gave the manager this
  // surface at the outlets they are assigned to — the capability was owner-only
  // because production happened to have no live Franchise Admin, not because a
  // manager should be refused — so the manager's case is asserted below as
  // reachable rather than here as absent.
  for (const role of ['biller', 'employee'] as const) {
    it(`is absent for a ${role}, by the gate rather than by a message`, async () => {
      render(
        <MemoryRouter>
          <SessionContext.Provider value={demoSessionFor(role satisfies Role)}>
            <AdaptersContext.Provider value={createMockAdapters(role)}>
              <ManualLedgerSurface />
            </AdaptersContext.Provider>
          </SessionContext.Provider>
        </MemoryRouter>,
      )

      // The component itself is never mounted for these roles in the app — this
      // asserts the mock refuses even if it somehow were, which is what the
      // policies do. Nothing readable arrives.
      await waitFor(() => {
        expect(screen.queryByTestId('day-reading')).not.toBeInTheDocument()
      })
    })

    it(`renders nothing at the manual-ledger path for a ${role}`, async () => {
      // `ROLE_SEGMENTS`, not a literal. A hand-written map read `counter` for a
      // biller — the biller's segment is `biller`, and `counter` is the physical
      // counter — and the test still passed, because a URL that matches no route
      // renders the same not-found as a gated one. It was asserting a typo.
      renderAt(`/demo/${ROLE_SEGMENTS[role]}/ledger`)

      // Absent, not forbidden: no such surface is declared for these roles, so the
      // route resolves to the shell's own not-found rather than to a refusal.
      expect(await screen.findByText(/does not exist/i)).toBeInTheDocument()
      expect(screen.queryByTestId('ledger-day-form')).not.toBeInTheDocument()
    })

    it(`reaches their own expenses surface, and no day figures on it`, async () => {
      renderAt(`/demo/${ROLE_SEGMENTS[role]}/ledger/expenses`)

      await screen.findByTestId('ledger-expense-list')

      // Not one figure the day record holds. The drawer figures are refused by
      // the database rather than hidden here; the day's takings are left off
      // because a screen showing four kinds of financial truth is a screen
      // nobody reads (design D5).
      expect(screen.queryByTestId('day-reading')).not.toBeInTheDocument()
      expect(screen.queryByTestId('expected-cash')).not.toBeInTheDocument()
      expect(screen.queryByTestId('counted-cash')).not.toBeInTheDocument()
      expect(screen.queryByTestId('ledger-day-form')).not.toBeInTheDocument()
      expect(screen.queryByText(/commission/i)).not.toBeInTheDocument()
      expect(screen.queryByTestId('ledger-view-month')).not.toBeInTheDocument()
    })
  }

  it('is reachable at its own path for the owner', async () => {
    renderAt('/demo/owner/ledger')
    expect(await screen.findByTestId('ledger-day-form')).toBeInTheDocument()
  })

  it('is reachable for a manager at the outlet they are assigned to', async () => {
    renderAt('/demo/admin/ledger')
    // The full surface, day figures included: a manager who counts the drawer
    // nightly but cannot read whether the month covered its costs is running
    // half a shop.
    expect(await screen.findByTestId('ledger-day-form')).toBeInTheDocument()
  })
})

/**
 * The month the demo store's today falls in, read off whichever period control is
 * on screen — the day field in the day view, the month label in the month view.
 * Never hard-coded, because the demo month is always the month somebody is
 * looking at it in.
 *
 * The month label is a label, not a field, so it carries the machine-readable
 * value in `data-month` — the words beside it are `August 2026`, and a test that
 * parsed those would be testing `Intl`.
 */
async function currentMonth(): Promise<string> {
  const month = screen.queryByTestId('ledger-month-picker')
  if (month) return month.getAttribute('data-month') ?? ''
  // Awaited, because in the day view this may be called before the outlet's own
  // today has landed and the control it reads does not exist until it has.
  const day = (await screen.findByTestId('ledger-day-picker')) as HTMLInputElement
  return day.value.slice(0, 7)
}
