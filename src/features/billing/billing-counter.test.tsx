import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { BillDraft, DataAdapters } from '@/data-access/adapters'
import { AdaptersContext } from '@/data-access/adapters-context'
import { createMockAdapters, createDemoStore } from '@/data-access/mock'
import { DEMO_MORNING_BILLER_ID } from '@/data-access/mock/fixtures/billing'
import { customerFixtures } from '@/data-access/mock/fixtures/customers'
import {
  MENU_ITEM_BURGER_ID,
  MENU_ITEM_CLASSIC_ID,
  MENU_ITEM_MAYO_ID,
  MENU_ITEM_STUFFED_ID,
} from '@/data-access/mock/fixtures/menu'
import { personaFixtures } from '@/data-access/mock/fixtures/personas'
import { createMockBillingAdapter } from '@/data-access/mock/billing'
import { createMockMenuAdapter } from '@/data-access/mock/menu'
import { SessionContext } from '@/session/context'
import type { Session } from '@/session/session'
import { deriveSessionScope } from '@/session/session'

import { BillingCounter } from './billing-counter'

/**
 * The counter, from the biller's side. Everything here is about the two things
 * this screen has to get right: it must be fast, and it must never block.
 */

const billerSession: Session = {
  mode: 'demo',
  userId: personaFixtures.biller.profile.id,
  assignments: personaFixtures.biller.assignments,
  ...deriveSessionScope(personaFixtures.biller.assignments),
  displayName: personaFixtures.biller.profile.full_name,
  persona: personaFixtures.biller,
}

function renderCounter(adapters: DataAdapters = createMockAdapters('biller')) {
  return {
    adapters,
    ...render(
      <MemoryRouter>
        <SessionContext.Provider value={billerSession}>
          <AdaptersContext.Provider value={adapters}>
            <BillingCounter />
          </AdaptersContext.Provider>
        </SessionContext.Provider>
      </MemoryRouter>,
    ),
  }
}

beforeEach(() => {
  // `shouldAdvanceTime` keeps Testing Library's `findBy*` polling alive: it
  // detects Jest's fake timers and not Vitest's, so a frozen clock would hang
  // every query in this file. The undo window is still advanced explicitly.
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  vi.useRealTimers()
})

function user() {
  return userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
}

/**
 * Decide the customer the way a biller does: open the row, tap the pad, confirm.
 *
 * The number is entered from the dialog's own keys rather than typed, because
 * the counter tablet has no keyboard out and that is the point of the pad.
 */
async function identifyCustomer(person: ReturnType<typeof user>, digits: string, name?: string) {
  await person.click(screen.getByTestId('customer-row'))
  const dialog = screen.getByRole('dialog', { name: 'Customer' })
  for (const digit of digits) {
    await person.click(within(dialog).getByRole('button', { name: digit }))
  }
  if (name !== undefined) {
    // `Name` while the number is new and the name is required of it, `Name
    // (optional)` for a customer who already exists without one.
    await person.type(await within(dialog).findByPlaceholderText(/name/i), name)
  }
  await person.click(within(dialog).getByTestId('customer-confirm'))
}

/**
 * The other decision: no number was given.
 *
 * Two taps, and both of them deliberate — the row, then No customer. There is
 * no skip on the composer, because one under the thumb that taps Paid forty
 * times an hour is muscle memory inside a week.
 *
 * Most tests in this file are about something else entirely and reach for this
 * because a terminal action is behind a decision — and this is the cheapest one.
 */
async function skipCustomer(person: ReturnType<typeof user>) {
  await person.click(screen.getByTestId('customer-row'))
  const dialog = screen.getByRole('dialog', { name: 'Customer' })
  await person.click(within(dialog).getByTestId('customer-skip'))
}

async function recordPaid(person: ReturnType<typeof user>, method = 'Cash') {
  if (screen.getByTestId('customer-row').textContent === 'Enter Customer Info') {
    await skipCustomer(person)
  }
  await person.click(screen.getByTestId('settle'))
  const dialog = screen.getByRole('dialog', { name: 'Record payment' })
  await person.click(within(dialog).getByRole('button', { name: method }))
  await person.click(within(dialog).getByRole('button', { name: 'Paid' }))
}

describe('BillingCounter', () => {
  it('keeps independently resized counter columns in this browser and never shrinks the menu below a column', async () => {
    const person = user()
    renderCounter()

    const workspace = await screen.findByTestId('counter-workspace')
    const billResize = screen.getByTestId('resize-current-bill-column')
    const activityResize = screen.getByTestId('resize-activity-column')

    expect(workspace.style.getPropertyValue('--counter-bill-width')).toBe('352px')
    expect(workspace.style.getPropertyValue('--counter-activity-width')).toBe('352px')

    billResize.focus()
    await person.keyboard('{ArrowLeft}')
    expect(workspace.style.getPropertyValue('--counter-bill-width')).toBe('368px')
    expect(workspace.style.getPropertyValue('--counter-activity-width')).toBe('352px')

    activityResize.focus()
    await person.keyboard('{ArrowLeft}')
    expect(workspace.style.getPropertyValue('--counter-activity-width')).toBe('368px')
    expect(JSON.parse(localStorage.getItem('shawarmania.counter-column-widths')!)).toEqual({
      bill: 368,
      activity: 368,
    })
    expect(billResize).toHaveAttribute('aria-valuemin', '352')
    expect(activityResize).toHaveAttribute('aria-valuemin', '352')
  })

  it('stops a divider at the point where expanding it would shrink another column below minimum', async () => {
    localStorage.clear()
    const person = user()
    renderCounter()

    const workspace = await screen.findByTestId('counter-workspace')
    // Three 22rem tracks plus two `gap-3` gaps exactly fill this viewport.
    Object.defineProperty(workspace, 'clientWidth', { configurable: true, value: 1080 })

    const billResize = screen.getByTestId('resize-current-bill-column')
    const activityResize = screen.getByTestId('resize-activity-column')

    billResize.focus()
    await person.keyboard('{ArrowLeft}')
    activityResize.focus()
    await person.keyboard('{ArrowLeft}')

    expect(workspace.style.getPropertyValue('--counter-bill-width')).toBe('352px')
    expect(workspace.style.getPropertyValue('--counter-activity-width')).toBe('352px')
  })

  it('re-reads the menu on foreground without a working subscription and preserves captured prices', async () => {
    const person = user()
    const store = createDemoStore()
    const adapters: DataAdapters = {
      ...createMockAdapters('biller'),
      billing: createMockBillingAdapter(store),
      menu: createMockMenuAdapter(store, 'biller'),
    }
    vi.spyOn(adapters.counter, 'subscribeToOutletBilling').mockReturnValue(() => {})
    const listMenu = vi.spyOn(adapters.menu, 'listMenu')
    renderCounter(adapters)

    const classic = await screen.findByTestId(`tile-${MENU_ITEM_CLASSIC_ID}`)
    await person.click(classic)
    expect(screen.getByTestId(`bill-line-${MENU_ITEM_CLASSIC_ID}`)).toHaveTextContent('₹139')

    const liveItem = store.menuItems.find((item) => item.id === MENU_ITEM_CLASSIC_ID)
    if (!liveItem) throw new Error('Expected the classic item')
    liveItem.price_paise = 14_900

    act(() => document.dispatchEvent(new Event('visibilitychange')))
    await waitFor(() => expect(listMenu).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(classic).toHaveTextContent('₹149'))
    expect(screen.getByTestId(`bill-line-${MENU_ITEM_CLASSIC_ID}`)).toHaveTextContent('₹139')
  })

  it('treats a reported change as a re-read nudge and preserves work in progress', async () => {
    const person = user()
    const store = createDemoStore()
    const adapters: DataAdapters = {
      ...createMockAdapters('biller'),
      billing: createMockBillingAdapter(store),
      menu: createMockMenuAdapter(store, 'biller'),
    }
    let nudge: (() => void) | null = null
    vi.spyOn(adapters.counter, 'subscribeToOutletBilling').mockImplementation(
      (_outletId, onChange) => {
        nudge = onChange
        return () => {}
      },
    )
    const listOrders = vi.spyOn(adapters.billing, 'listOpenOrders')
    renderCounter(adapters)

    const classic = await screen.findByTestId(`tile-${MENU_ITEM_CLASSIC_ID}`)
    await person.click(classic)
    await waitFor(() => expect(listOrders).toHaveBeenCalled())
    const beforeOrders = listOrders.mock.calls.length

    const liveItem = store.menuItems.find((item) => item.id === MENU_ITEM_CLASSIC_ID)
    if (!liveItem) throw new Error('Expected the classic item')
    liveItem.is_available = false
    act(() => nudge?.())

    await waitFor(() => expect(classic).toBeDisabled())
    await waitFor(() => expect(listOrders.mock.calls.length).toBeGreaterThan(beforeOrders))
    expect(screen.getByTestId(`bill-line-${MENU_ITEM_CLASSIC_ID}`)).toHaveTextContent('₹139')
    expect(screen.getByTestId(`bill-quantity-${MENU_ITEM_CLASSIC_ID}`)).toHaveTextContent('1')
  })

  it('adds an item on the first tap and increments on the next', async () => {
    const person = user()
    renderCounter()

    const classic = await screen.findByTestId(`tile-${MENU_ITEM_CLASSIC_ID}`)
    await person.click(classic)
    expect(screen.getByTestId(`bill-quantity-${MENU_ITEM_CLASSIC_ID}`)).toHaveTextContent('1')

    await person.click(classic)
    expect(screen.getByTestId(`bill-quantity-${MENU_ITEM_CLASSIC_ID}`)).toHaveTextContent('2')
    // The tile shows what is on the bill, as feedback rather than as a control.
    expect(screen.getByTestId(`tile-count-${MENU_ITEM_CLASSIC_ID}`)).toHaveTextContent('×2')
  })

  it('adjusts and removes a line from the bill panel, and the total follows', async () => {
    const person = user()
    renderCounter()

    await person.click(await screen.findByTestId(`tile-${MENU_ITEM_CLASSIC_ID}`))
    await person.click(screen.getByTestId(`tile-${MENU_ITEM_MAYO_ID}`))
    expect(screen.getByTestId('bill-total')).toHaveTextContent('₹298')

    await person.click(screen.getByRole('button', { name: 'One more Classic Chicken Shawarma' }))
    expect(screen.getByTestId('bill-total')).toHaveTextContent('₹437')

    await person.click(
      screen.getByRole('button', { name: 'One fewer Mayonnaise Chicken Shawarma' }),
    )
    expect(screen.queryByTestId(`bill-line-${MENU_ITEM_MAYO_ID}`)).not.toBeInTheDocument()
    expect(screen.getByTestId('bill-total')).toHaveTextContent('₹278')
  })

  it('will not sell an item that is off the menu, and still shows it', async () => {
    const person = user()
    renderCounter()

    const off = await screen.findByTestId(`tile-${MENU_ITEM_STUFFED_ID}`)
    expect(off).toBeDisabled()

    await person.click(off)
    expect(screen.queryByTestId(`bill-line-${MENU_ITEM_STUFFED_ID}`)).not.toBeInTheDocument()
  })

  it('requires a decision about the customer — identified or skipped — before either action', async () => {
    const person = user()
    const { adapters } = renderCounter()
    const settleBill = vi.spyOn(adapters.billing, 'settleBill')

    await person.click(await screen.findByTestId(`tile-${MENU_ITEM_CLASSIC_ID}`))
    expect(screen.getByTestId('save-order')).toBeDisabled()
    expect(screen.getByTestId('settle')).toBeDisabled()
    // The disabled actions beside an untouched row are the whole message. The
    // sentence that used to sit here was a third way of saying it.
    expect(screen.queryByText(/Add a customer/i)).not.toBeInTheDocument()
    expect(settleBill).not.toHaveBeenCalled()

    // A number nobody has used before, so the UI insists on a name for it.
    await identifyCustomer(person, '9000000000', 'Rahul')
    expect(screen.getByTestId('customer-row')).toHaveTextContent('Rahul · +91 90000 00000')
    expect(screen.getByTestId('save-order')).toBeEnabled()
    expect(screen.getByTestId('settle')).toBeEnabled()

    // Skipping is a decision too, and it is the whole of the enforcement. It
    // costs opening the dialog first — there is no skip on the composer, which
    // is the one control this change most deliberately does not add.
    await skipCustomer(person)
    expect(screen.getByTestId('customer-row')).toHaveTextContent('Skipped Customer Info')
    expect(screen.queryByRole('dialog', { name: 'Customer' })).not.toBeInTheDocument()
    expect(screen.getByTestId('save-order')).toBeEnabled()
    expect(screen.getByTestId('settle')).toBeEnabled()

    // And it can be changed: the row reopens on the pad, which is the only way
    // a decision is revised — there is no clear action beside it, because
    // clearing only ever returned the row to a state the biller then had to
    // leave again through this same dialog.
    await person.click(screen.getByTestId('customer-row'))
    expect(screen.getByRole('dialog', { name: 'Customer' })).toBeInTheDocument()
    expect(screen.queryByTestId('clear-customer')).not.toBeInTheDocument()

    const order = screen.getByRole('button', { name: 'Order' })
    const markPaid = screen.getByTestId('settle')
    expect(markPaid).toHaveTextContent('Paid')
    expect(order.compareDocumentPosition(markPaid) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(order).toHaveClass('bg-primary')
    expect(markPaid).toHaveClass('bg-surface')
  })

  it('carries the customer details when they were given', async () => {
    const person = user()
    const { adapters } = renderCounter()
    const settleBill = vi.spyOn(adapters.billing, 'settleBill')

    await person.click(await screen.findByTestId(`tile-${MENU_ITEM_CLASSIC_ID}`))
    await identifyCustomer(person, '9000000000', 'Demo Regular')
    await recordPaid(person, 'UPI')

    const draft = settleBill.mock.calls[0]![0] as BillDraft
    // The label and the canonical number both, never the identity alone: a bill
    // carrying an id and nothing to print is a receipt nobody can read.
    expect(draft.customerName).toBe('Demo Regular')
    expect(draft.customerPhone).toBe('+919000000000')
    expect(draft.payments).toEqual([{ method: 'upi', amountPaise: 13900 }])
  })

  it('keeps payment unconfirmed until a tender allocation covers the bill', async () => {
    const person = user()
    const { adapters } = renderCounter()
    const settleBill = vi.spyOn(adapters.billing, 'settleBill')

    await person.click(await screen.findByTestId(`tile-${MENU_ITEM_CLASSIC_ID}`))
    await skipCustomer(person)
    await person.click(screen.getByTestId('settle'))

    const dialog = screen.getByRole('dialog', { name: 'Record payment' })
    expect(within(dialog).getByRole('button', { name: 'Paid' })).toBeDisabled()
    expect(settleBill).not.toHaveBeenCalled()
    // And the order is still there — nothing was thrown away.
    expect(screen.getByTestId(`bill-line-${MENU_ITEM_CLASSIC_ID}`)).toBeInTheDocument()
  })

  it('offers Cash and UPI while withdrawn and vague methods stay absent', async () => {
    const person = user()
    renderCounter()

    await person.click(await screen.findByTestId(`tile-${MENU_ITEM_CLASSIC_ID}`))
    await skipCustomer(person)
    await person.click(screen.getByTestId('settle'))
    const dialog = screen.getByRole('dialog', { name: 'Record payment' })
    await waitFor(() =>
      expect(document.activeElement).toBe(
        within(dialog).getByRole('heading', { name: 'Record payment' }),
      ),
    )
    for (const method of ['Cash', 'UPI']) {
      const button = within(dialog).getByRole('button', { name: method })
      expect(button).toBeInTheDocument()
      expect(button).toHaveClass('bg-surface')
      expect(button).not.toHaveClass('bg-primary')
    }
    for (const unsupported of ['Swiggy', 'Zomato', 'Card', 'Other']) {
      expect(within(dialog).queryByRole('button', { name: unsupported })).not.toBeInTheDocument()
    }
  })

  it('records an exact cash and UPI split without using the tablet keyboard', async () => {
    const person = user()
    const { adapters } = renderCounter()
    const settleBill = vi.spyOn(adapters.billing, 'settleBill')

    await person.click(await screen.findByTestId(`tile-${MENU_ITEM_CLASSIC_ID}`))
    await skipCustomer(person)
    await person.click(screen.getByTestId('settle'))
    const dialog = screen.getByRole('dialog', { name: 'Record payment' })
    await person.click(within(dialog).getByRole('button', { name: '1' }))
    await person.click(within(dialog).getByRole('button', { name: '0' }))
    await person.click(within(dialog).getByRole('button', { name: '0' }))
    await person.click(within(dialog).getByRole('button', { name: 'Cash' }))
    await person.click(within(dialog).getByRole('button', { name: 'UPI' }))
    await person.click(within(dialog).getByRole('button', { name: 'Paid' }))

    expect((settleBill.mock.calls[0]![0] as BillDraft).payments).toEqual([
      { method: 'cash', amountPaise: 10000 },
      { method: 'upi', amountPaise: 3900 },
    ])
  })

  it('keeps the pipeline in the rail and the money in the middle column', async () => {
    const person = user()
    renderCounter()

    // The rail is the pipeline: one list, no headings, no divider and no band.
    const rail = await screen.findByTestId('counter-activity-rail')
    expect(within(rail).getByTestId('pipeline-list')).toBeInTheDocument()
    expect(within(rail).queryByTestId('pipeline-preparing')).not.toBeInTheDocument()
    expect(within(rail).queryByTestId('pipeline-unpaid-prepared')).not.toBeInTheDocument()
    expect(within(rail).queryByText('Prepared · awaiting money')).not.toBeInTheDocument()
    expect(within(rail).queryByRole('heading')).not.toBeInTheDocument()

    // The middle column hosts Bills this shift: totals on top, expandable
    // collapsed bills beneath.
    expect(screen.getByRole('heading', { name: 'Bills this shift' })).toBeInTheDocument()
    expect(screen.getByTestId('shift-total-cash')).toHaveTextContent('Cash')
    expect(screen.getByTestId('shift-total-upi')).toHaveTextContent('UPI')

    const disclosure = screen.getByTestId('bill-column').querySelector('details')
    expect(disclosure).not.toBeNull()
    const summary = disclosure?.querySelector('summary')
    expect(summary).not.toBeNull()
    await person.click(summary as HTMLElement)
    expect(disclosure).toHaveAttribute('open')
    expect(within(disclosure as HTMLElement).getByTestId(/^shift-bill-detail-/)).toHaveTextContent(
      /×/,
    )
  })

  it('scrolls the shift column beneath pinned totals, with attention first', async () => {
    renderCounter()
    await screen.findByRole('heading', { name: 'Bills this shift' })

    const section = screen
      .getByTestId('shift-total-cash')
      .closest('section[aria-labelledby="my-shift-title"]')!
    const body = [...section.children].find((child) =>
      child.className.includes('overflow-y-auto'),
    ) as HTMLElement | undefined

    // A busy evening used to run the bills off the bottom of a height-capped
    // column with no way to reach them — and an unreachable needs-attention card
    // is money nobody can put right.
    expect(body).toBeDefined()
    expect(body!.className).toContain('flex-1')
    expect(body!.className).toContain('min-h-0')

    // The totals are outside it, so they stay put while the list moves. A total
    // you have to scroll back for is a total you check less often.
    expect(body!.contains(screen.getByTestId('shift-total-cash'))).toBe(false)

    // And what needs acting on comes before what merely happened.
    const attention = screen.getByRole('heading', { name: /needs attention/i })
    const firstBill = within(body!).getAllByText(/^Bill \d+$/)[0]!
    expect(attention.compareDocumentPosition(firstBill)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it('ticks the Paid box in place rather than renaming the control', async () => {
    const person = user()
    renderCounter()

    const preparing = await screen.findByTestId('open-order-105')
    const paid = within(preparing).getByRole('button', { name: 'Paid' })
    expect(paid).toHaveAttribute('aria-pressed', 'false')
    await person.click(paid)
    const dialog = screen.getByRole('dialog', { name: 'Record payment' })
    await person.click(within(dialog).getByRole('button', { name: 'Cash' }))
    await person.click(within(dialog).getByRole('button', { name: 'Paid' }))

    await waitFor(() => expect(preparing).toHaveAttribute('data-paid', 'true'))
    /*
      The same control, in the same place, wearing the same word — only the box
      is ticked now. Nothing renamed itself to Un-pay, and there is no separate
      PAID badge, because a ticked box already says it.
    */
    await waitFor(() =>
      expect(within(preparing).getByRole('button', { name: 'Paid' })).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    )
    expect(within(preparing).queryByRole('button', { name: 'Un-pay' })).not.toBeInTheDocument()
    expect(within(preparing).queryByText('PAID')).not.toBeInTheDocument()
    // And Prepared is untouched in place and wording by the payment landing.
    expect(within(preparing).getByRole('button', { name: 'Prepared' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )

    const getBoundingClientRect = vi
      .spyOn(HTMLDivElement.prototype, 'getBoundingClientRect')
      .mockReturnValue({ top: 120, right: 320 } as DOMRect)
    // No wait: an unprepared order's payment has no deadline, so the card knows
    // the take-back is available without first measuring a clock.
    await person.click(
      within(preparing).getByRole('button', { name: /^More actions for Order .105$/ }),
    )
    const menu = within(preparing).getByRole('menu')
    expect(menu).toHaveStyle({
      position: 'fixed',
      bottom: `${window.innerHeight - 116}px`,
      right: `${window.innerWidth - 320}px`,
    })
    expect(within(menu).queryByRole('menuitem', { name: 'Un-pay' })).not.toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Cancel after paid' })).toBeVisible()
    getBoundingClientRect.mockRestore()
  })

  it('opens the composer over the bills column on the first tap and gives way again', async () => {
    const person = user()
    renderCounter()

    // Before anything is tapped there is nothing to compose, so the middle
    // column shows the money list and offers no settle control at all.
    expect(screen.queryByTestId('settle')).not.toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Bills this shift' })).toBeInTheDocument()

    await person.click(await screen.findByTestId(`tile-${MENU_ITEM_CLASSIC_ID}`))
    expect(screen.getByTestId(`bill-line-${MENU_ITEM_CLASSIC_ID}`)).toBeInTheDocument()
    // Present but held: no customer identity on the order yet (see the
    // requires-identity test below for the full rule).
    expect(screen.getByTestId('settle')).toBeDisabled()
  })

  it('lands a settled bill in Bills this shift with no inserted confirmation bar', async () => {
    const person = user()
    renderCounter()

    await person.click(await screen.findByTestId(`tile-${MENU_ITEM_CLASSIC_ID}`))
    await recordPaid(person)

    // No info bar: the panel giving way to Bills this shift, with the new
    // bill queued in it, is the whole acknowledgement.
    expect(screen.queryByTestId('settled-confirmation')).not.toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Bills this shift' })).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByTestId('bill-column').querySelector('details')).not.toBeNull()
    })
  })

  it('keeps the complete payment form until durable local acceptance commits', async () => {
    const person = user()
    const { adapters } = renderCounter()
    let commit!: () => void
    vi.spyOn(adapters.billing, 'settleBill').mockReturnValue(
      new Promise<void>((resolve) => {
        commit = resolve
      }),
    )

    await person.click(await screen.findByTestId(`tile-${MENU_ITEM_CLASSIC_ID}`))
    await skipCustomer(person)
    await person.click(screen.getByTestId('settle'))
    const dialog = screen.getByRole('dialog', { name: 'Record payment' })
    await person.click(within(dialog).getByRole('button', { name: 'Cash' }))
    await person.click(within(dialog).getByRole('button', { name: 'Paid' }))

    expect(dialog).toBeInTheDocument()
    expect(screen.getByTestId(`bill-line-${MENU_ITEM_CLASSIC_ID}`)).toBeInTheDocument()
    expect(screen.getByTestId('customer-row')).toHaveTextContent('Skipped Customer Info')
    expect(within(dialog).getByRole('button', { name: 'Paid' })).toBeDisabled()

    await act(async () => commit())
    // Commit hands the middle column back to Bills this shift — no bar, just
    // the money list with the bill queued in it.
    expect(await screen.findByRole('heading', { name: 'Bills this shift' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Record payment' })).not.toBeInTheDocument()
    expect(screen.queryByTestId(`bill-line-${MENU_ITEM_CLASSIC_ID}`)).not.toBeInTheDocument()
  })

  it('keeps lines, customer and tender intact when durable storage refuses the payment', async () => {
    const person = user()
    const { adapters } = renderCounter()
    vi.spyOn(adapters.billing, 'settleBill').mockRejectedValue(new Error('IndexedDB unavailable'))

    await person.click(await screen.findByTestId(`tile-${MENU_ITEM_CLASSIC_ID}`))
    await skipCustomer(person)
    await person.click(screen.getByTestId('settle'))
    const dialog = screen.getByRole('dialog', { name: 'Record payment' })
    await person.click(within(dialog).getByRole('button', { name: 'UPI' }))
    await person.click(within(dialog).getByRole('button', { name: 'Paid' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/not saved on this tablet/i)
    expect(screen.getByTestId(`bill-line-${MENU_ITEM_CLASSIC_ID}`)).toBeInTheDocument()
    expect(screen.getByTestId('customer-row')).toHaveTextContent('Skipped Customer Info')
    expect(within(dialog).getByRole('list', { name: 'Payment split' })).toHaveTextContent('UPI')
    expect(screen.queryByTestId('settled-confirmation')).not.toBeInTheDocument()
  })

  it('offers tender editing beside the locally accepted paid bill instead of Undo', async () => {
    const person = user()
    renderCounter()

    await person.click(await screen.findByTestId(`tile-${MENU_ITEM_CLASSIC_ID}`))
    await person.click(screen.getByTestId(`tile-${MENU_ITEM_CLASSIC_ID}`))
    // Identified rather than skipped, because the bill is found below by the
    // name it carries — and a skipped bill carries none.
    await identifyCustomer(person, '9000000999', 'Demo Regular')
    await recordPaid(person)

    expect(screen.queryByTestId('undo-settle')).not.toBeInTheDocument()
    // The money column mounts once the composer gives way; its bill carries
    // the customer and the tender-edit action.
    const paidBill = (await screen.findAllByText('Demo Regular'))
      .map((name) => name.closest('details'))
      .find((details) => details?.querySelector('summary')?.textContent?.includes('₹278'))
    if (!paidBill) throw new Error('Expected the new paid bill in shift history')
    await person.click(await within(paidBill).findByRole('button', { name: /^Edit \(\d+ min\)$/ }))
    const correction = screen.getByRole('dialog', { name: 'Record payment' })
    expect(correction).toHaveTextContent('Edit payment')
    expect(within(correction).getByRole('list', { name: 'Payment split' })).toHaveTextContent(
      'Cash',
    )
    expect(within(correction).getByRole('button', { name: 'Save payment' })).toBeDisabled()
  })

  it('snapshots the line price, so a menu change mid-order cannot rewrite it', async () => {
    const person = user()

    // One store, two authorities over it: the counter reads the menu, and a
    // manager changes it underneath — which is exactly what happens when a
    // price is edited on a phone while an order is open at the counter.
    const store = createDemoStore()
    const adapters: DataAdapters = {
      ...createMockAdapters('biller'),
      menu: createMockMenuAdapter(store, 'franchise_admin'),
      billing: createMockBillingAdapter(store),
    }
    renderCounter(adapters)
    const settleBill = vi.spyOn(adapters.billing, 'settleBill')

    await person.click(await screen.findByTestId(`tile-${MENU_ITEM_CLASSIC_ID}`))

    await adapters.menu.updateItem(MENU_ITEM_CLASSIC_ID, { pricePaise: 19900 })

    await recordPaid(person)

    const draft = settleBill.mock.calls[0]![0] as BillDraft
    expect(draft.lines[0]!.unitPricePaise).toBe(13900)
    expect(draft.lines[0]!.itemName).toBe('Classic Chicken Shawarma')
  })

  it('stamps a bill rung after midnight with the business day that is still going on', async () => {
    // 00:20 IST, against Kalyani's 04:00 cutover.
    vi.setSystemTime(new Date('2026-07-29T00:20:00+05:30'))

    const person = user()
    const { adapters } = renderCounter()
    const settleBill = vi.spyOn(adapters.billing, 'settleBill')

    await person.click(await screen.findByTestId(`tile-${MENU_ITEM_CLASSIC_ID}`))
    await recordPaid(person)

    const draft = settleBill.mock.calls[0]![0] as BillDraft
    expect(draft.businessDate).toBe('2026-07-28')
  })

  it('gives each bill its own client identity', async () => {
    const person = user()
    const { adapters } = renderCounter()
    const settleBill = vi.spyOn(adapters.billing, 'settleBill')

    for (let index = 0; index < 2; index += 1) {
      await person.click(await screen.findByTestId(`tile-${MENU_ITEM_CLASSIC_ID}`))
      await recordPaid(person)
    }

    const ids = settleBill.mock.calls.map((call) => (call[0] as BillDraft).clientId)
    expect(new Set(ids).size).toBe(2)
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    }
  })

  it('saves food-first work into the rail under a local reference, numbered at delivery', async () => {
    const person = user()
    const { adapters } = renderCounter()
    const saveOrder = vi.spyOn(adapters.billing, 'saveOrder')

    await person.click(await screen.findByTestId(`tile-${MENU_ITEM_CLASSIC_ID}`))
    await person.click(screen.getByRole('button', { name: 'Mayonnaise Chicken Shawarma' }))
    await identifyCustomer(person, '9000000999', 'Asha')
    await person.click(screen.getByTestId('save-order'))

    expect(saveOrder).toHaveBeenCalledWith(expect.objectContaining({ lines: expect.any(Array) }))
    const rail = await screen.findByTestId('counter-activity-rail')
    // Before delivery the card shows the SHAPE of the number that is coming and
    // nothing that could be read as one. A token stood here once, and the number
    // replacing it read as the order changing identity.
    const clientId = (saveOrder.mock.calls[0]![0] as { clientId: string }).clientId
    const saved = await within(rail).findByTestId(`open-order-local-${clientId}`)
    expect(within(saved).getByText('Asha')).toBeInTheDocument()
    expect(saved.querySelector('.animate-pulse')).toBeInTheDocument()
    expect(saved).not.toHaveTextContent(/#\d/)
    expect(within(saved).getByText('Classic Chicken Shawarma')).toBeInTheDocument()
    expect(within(saved).getByText('Mayonnaise Chicken Shawarma')).toBeInTheDocument()
    expect(within(saved).getByText('now')).toBeInTheDocument()
    expect(within(saved).queryByText('Demo Biller')).not.toBeInTheDocument()
    expect(saved).toHaveTextContent('₹298')

    // Delivered, it has left the queue and carries its permanent daily number.
    await vi.advanceTimersByTimeAsync(500)
    const delivered = await within(rail).findByTestId('open-order-106')
    expect(within(delivered).getByText(/^#\s*106$/)).toBeInTheDocument()
    expect(delivered.querySelector('.animate-pulse')).toBeNull()

    expect(screen.queryByTestId('saved-order-confirmation')).not.toBeInTheDocument()
    // The composer gave way: the middle column is the money list again.
    expect(screen.getByRole('heading', { name: 'Bills this shift' })).toBeInTheDocument()
  })

  it('shows another creator while omitting the current shift holder', async () => {
    // The card's age line is relative only while the order shares the clock's
    // calendar date, and the seed stamps its own "today" from the clock it
    // reads at creation. Freezing the clock before the store exists pins both
    // sides of that comparison: the fixture order is always five minutes old,
    // so the assertion below tests the creator, not what hour it is. Without
    // this, the test is green all day and red past midnight.
    vi.setSystemTime(new Date('2026-08-23T18:45:00+05:30'))
    const store = createDemoStore()
    const openOrder = store.orders.find((order) => order.order_number === 104)
    if (!openOrder) throw new Error('Expected the demo open order')
    openOrder.created_by = DEMO_MORNING_BILLER_ID

    const adapters: DataAdapters = {
      ...createMockAdapters('biller'),
      billing: createMockBillingAdapter(store),
    }
    renderCounter(adapters)

    const rail = await screen.findByTestId('counter-activity-rail')
    const order = await within(rail).findByTestId('open-order-104')
    expect(within(order).getByText(/Demo Morning Biller/)).toBeInTheDocument()
    expect(within(order).getByTestId(`order-reference-${openOrder.id}`)).toHaveTextContent(
      /^#\s*104$/,
    )
    expect(within(order).getByTestId(`order-reference-${openOrder.id}`)).not.toHaveTextContent(
      'Order',
    )
    const metadata = within(order).getByTestId(`order-metadata-${openOrder.id}`)
    // Age and creator are two facts; pin each on its own so the wall clock
    // cannot flip the combined pattern between now and mins-ago.
    expect(metadata).toHaveTextContent(/(now|ago)/)
    expect(metadata).toHaveTextContent('Demo Morning Biller')
  })

  it('edits every order field in the composer and restores the suspended draft', async () => {
    const person = user()
    const { adapters } = renderCounter()
    const reviseOrder = vi.spyOn(adapters.billing, 'reviseOrder')

    await person.click(await screen.findByTestId(`tile-${MENU_ITEM_CLASSIC_ID}`))
    await skipCustomer(person)

    const rail = await screen.findByTestId('counter-activity-rail')
    const openOrder = await within(rail).findByTestId('open-order-104')
    // Uncommon actions live behind the kebab; Edit is one of them.
    await person.click(
      within(openOrder).getByRole('button', { name: /^More actions for Order .104$/ }),
    )
    await person.click(within(openOrder).getByRole('menuitem', { name: 'Edit' }))

    const editHeading = screen.getByRole('heading', { name: /Editing order/ })
    expect(editHeading).toHaveTextContent('104')

    // The mode is unmistakable: the panel is marked as editing, the order's own
    // card is docked to it carrying the composer's controls, and that order is no
    // longer offered as an ordinary card that could be paid or edited again.
    expect(screen.getByTestId('bill-panel')).toHaveAttribute('data-editing')
    const pin = within(rail).getByTestId('editing-order-pin')
    // A pattern rather than a literal: `scripts/check-no-hex.mjs` reads a hash
    // followed by three hex digits as a colour outside the brand layer.
    expect(pin).toHaveTextContent(/Order\s*#\s*104/)
    expect(within(rail).queryByTestId('open-order-104')).not.toBeInTheDocument()

    // The footer moved rather than being copied. Two of it would mean two Save
    // changes buttons and two fields sharing one id.
    expect(within(pin).getByTestId('save-order')).toBeInTheDocument()
    expect(within(pin).getByTestId('cancel-edit')).toBeInTheDocument()
    // The customer row does NOT move with it: it stays in the panel, where it
    // sits while composing, so it is never somewhere new on the way back in.
    expect(within(pin).queryByTestId('customer-row')).toBeNull()
    expect(within(screen.getByTestId('bill-panel')).getByTestId('customer-row')).toBeInTheDocument()
    expect(within(screen.getByTestId('bill-panel')).queryByTestId('save-order')).toBeNull()
    expect(screen.getAllByTestId('customer-row')).toHaveLength(1)
    // The items are the composer's job; the card does not show a second copy.
    expect(within(pin).queryByRole('list', { name: /Items for order/ })).toBeNull()
    // And one total, at the top of the card.
    expect(within(pin).queryByTestId('bill-total')).toBeNull()

    expect(screen.getByTestId(`bill-quantity-${MENU_ITEM_CLASSIC_ID}`)).toHaveTextContent('2')
    // The saved order's own decision comes back onto the row. Every order rung
    // before this change carries a name and no number, and the row has to say
    // which half is missing without implying the name identifies anybody.
    expect(screen.getByTestId('customer-row')).toHaveTextContent('Demo Customer · no number')

    await person.click(screen.getByRole('button', { name: 'Mayonnaise Chicken Shawarma' }))
    await identifyCustomer(person, '9000000222', 'Updated customer')
    await person.click(screen.getByTestId('save-order'))

    await waitFor(() => expect(reviseOrder).toHaveBeenCalledTimes(1))
    expect(reviseOrder).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        customerName: 'Updated customer',
        customerPhone: '+919000000222',
        lines: expect.arrayContaining([
          expect.objectContaining({ menuItemId: MENU_ITEM_MAYO_ID, quantity: 1 }),
        ]),
      }),
    )
    expect(screen.getByRole('heading', { name: 'Current bill' })).toBeInTheDocument()
    expect(screen.getByTestId('bill-panel')).not.toHaveAttribute('data-editing')
    expect(within(rail).queryByTestId('editing-order-pin')).not.toBeInTheDocument()
    // And the footer is back in the panel, still just the one.
    expect(within(screen.getByTestId('bill-panel')).getByTestId('save-order')).toBeInTheDocument()
    expect(screen.getByTestId('customer-row')).toHaveTextContent('Skipped Customer Info')
    expect(screen.getByTestId(`bill-quantity-${MENU_ITEM_CLASSIC_ID}`)).toHaveTextContent('1')
    expect(screen.queryByTestId(`bill-line-${MENU_ITEM_MAYO_ID}`)).not.toBeInTheDocument()

    const updated = await within(rail).findByTestId('open-order-104')
    await waitFor(() => expect(within(updated).getByText('Updated customer')).toBeInTheDocument())
    expect(within(updated).getByText('Mayonnaise Chicken Shawarma')).toBeInTheDocument()

    await person.click(
      within(updated).getByRole('button', { name: /^More actions for Order .104$/ }),
    )
    await person.click(within(updated).getByRole('menuitem', { name: 'Edit' }))
    await person.click(screen.getByRole('button', { name: 'One more Classic Chicken Shawarma' }))
    await person.click(screen.getByTestId('cancel-edit'))
    expect(screen.getByTestId('customer-row')).toHaveTextContent('Skipped Customer Info')
    expect(screen.getByTestId(`bill-quantity-${MENU_ITEM_CLASSIC_ID}`)).toHaveTextContent('1')
  })

  it('resolves a saved number to its saved name, and puts that on the row', async () => {
    const person = user()
    renderCounter()

    await person.click(await screen.findByTestId(`tile-${MENU_ITEM_CLASSIC_ID}`))
    await identifyCustomer(person, '9000000101')

    // The saved name is this order's label. Nothing was typed to get it, and
    // nothing about the saved profile was touched to give it.
    expect(screen.getByTestId('customer-row')).toHaveTextContent('Ritika Sen · +91 90000 00101')
    // She is a gold member in the demo directory, so the row carries the mark —
    // and nothing else about her membership.
    expect(
      within(screen.getByTestId('customer-row')).getByRole('img', { name: 'Gold member' }),
    ).toBeInTheDocument()
  })

  it('refuses a phone that is not a phone, rather than offering to save it', async () => {
    const person = user()
    const { adapters } = renderCounter()
    const createOrGet = vi.spyOn(adapters.customers, 'createOrGet')

    await person.click(await screen.findByTestId(`tile-${MENU_ITEM_CLASSIC_ID}`))
    await person.click(screen.getByTestId('customer-row'))
    const dialog = screen.getByRole('dialog', { name: 'Customer' })

    // Nothing said while they are still typing — a number is incomplete for the
    // first nine digits of every number anybody enters.
    for (const digit of '123456789') {
      await person.click(within(dialog).getByRole('button', { name: digit }))
    }
    expect(within(dialog).queryByTestId('customer-no-match')).not.toBeInTheDocument()
    expect(within(dialog).queryByPlaceholderText('Name (optional)')).not.toBeInTheDocument()
    expect(within(dialog).getByTestId('customer-confirm')).toBeDisabled()

    // The tenth digit completes a number the Indian mobile rule still refuses.
    // It reads as a miss and offers no save: a form that fails on submit is
    // worse than one that never opened.
    await person.click(within(dialog).getByRole('button', { name: '0' }))
    expect(await within(dialog).findByTestId('customer-no-match')).toHaveTextContent(
      /invalid mobile number/i,
    )
    expect(within(dialog).queryByPlaceholderText('Name (optional)')).not.toBeInTheDocument()
    expect(within(dialog).getByTestId('customer-confirm')).toBeDisabled()
    expect(createOrGet).not.toHaveBeenCalled()
  })

  it('starts a genuinely new bill after the last line is taken off', async () => {
    const person = user()
    renderCounter()

    await person.click(await screen.findByTestId(`tile-${MENU_ITEM_CLASSIC_ID}`))
    await skipCustomer(person)
    await person.click(screen.getByTestId('add-discount'))
    await person.click(screen.getByTestId('discount-preset-percent-1000'))
    await person.click(screen.getByTestId('apply-discount'))
    await waitFor(() => expect(screen.getByTestId('bill-total')).toHaveTextContent('₹126'))

    // Taking the last line off closes the panel: there is no bill in progress
    // any more, and everything that belonged to it goes with it.
    await person.click(screen.getByRole('button', { name: 'One fewer Classic Chicken Shawarma' }))
    expect(await screen.findByRole('heading', { name: 'Bills this shift' })).toBeInTheDocument()

    await person.click(screen.getByTestId(`tile-${MENU_ITEM_CLASSIC_ID}`))

    // The next customer never asked for the last one's discount, and nobody
    // would think to check their bill for it.
    expect(screen.getByTestId('bill-total')).toHaveTextContent('₹139')
    expect(screen.queryByTestId('bill-discount-row-0')).not.toBeInTheDocument()
    // And they are not the last customer either.
    expect(screen.getByTestId('customer-row')).toHaveTextContent('Enter Customer Info')
    expect(screen.getByTestId('save-order')).toBeDisabled()
  })

  it('suggests one customer this outlet has served, from a partial number', async () => {
    const person = user()
    renderCounter()

    await person.click(await screen.findByTestId(`tile-${MENU_ITEM_CLASSIC_ID}`))
    await person.click(screen.getByTestId('customer-row'))
    const dialog = screen.getByRole('dialog', { name: 'Customer' })

    for (const digit of '9000') {
      await person.click(within(dialog).getByRole('button', { name: digit }))
    }

    // The demo outlet has served every fixture customer, and all their numbers
    // open `9000`. One is offered and the rest are a count — never a list,
    // because a list over the customer directory is the thing this product
    // refuses to build.
    const offered = await within(dialog).findByTestId('customer-suggestion')
    expect(offered).toHaveTextContent('Ritika Sen')
    expect(within(offered).getByRole('img', { name: 'Gold member' })).toBeInTheDocument()
    expect(within(dialog).getByTestId('customer-suggestion-others')).toHaveTextContent(
      `+${customerFixtures.length - 1} more`,
    )

    await person.click(offered)
    expect(await within(dialog).findByTestId('customer-match')).toHaveTextContent('Ritika Sen')
    await person.click(within(dialog).getByTestId('customer-confirm'))
    expect(screen.getByTestId('customer-row')).toHaveTextContent('Ritika Sen · +91 90000 00101')
  })

  it('sends the phone and leaves the customer to the server', async () => {
    const person = user()
    const { adapters } = renderCounter()
    const saveOrder = vi.spyOn(adapters.billing, 'saveOrder')
    const createOrGet = vi.spyOn(adapters.customers, 'createOrGet')

    await person.click(await screen.findByTestId(`tile-${MENU_ITEM_CLASSIC_ID}`))
    await identifyCustomer(person, '9000000999', 'New Customer')
    await person.click(screen.getByTestId('save-order'))

    await waitFor(() => expect(saveOrder).toHaveBeenCalledOnce())
    const draft = saveOrder.mock.calls[0]![0] as BillDraft
    expect(draft.customerPhone).toBe('+919000000999')
    expect(draft.customerName).toBe('New Customer')

    /*
      **The till does not create the customer, and used to.** A bare
      fire-and-forget `createOrGet` sat beside the sale with its failure
      swallowed, so a day of offline trade created no customer rows at all and
      the bills that would have identified them carried text nothing could be
      joined to. The command carries the phone; the server resolves the customer
      when it records the command, whether that is now or after a ten-hour
      drain.
    */
    expect(createOrGet).not.toHaveBeenCalled()
  })

  it('never holds local acceptance behind anything to do with the customer', async () => {
    const person = user()
    const { adapters } = renderCounter()
    const saveOrder = vi.spyOn(adapters.billing, 'saveOrder')
    // Hang every directory call. Nothing on the acceptance path may await one.
    vi.spyOn(adapters.customers, 'createOrGet').mockReturnValue(new Promise(() => {}))
    vi.spyOn(adapters.customers, 'lookupByPhone').mockReturnValue(new Promise(() => {}))

    await person.click(await screen.findByTestId(`tile-${MENU_ITEM_CLASSIC_ID}`))
    await person.click(screen.getByTestId('customer-row'))
    const dialog = screen.getByRole('dialog', { name: 'Customer' })
    for (const digit of '9000000999') {
      await person.click(within(dialog).getByRole('button', { name: digit }))
    }
    // The lookup never answers, so the dialog reads as a number nobody has used
    // — indistinguishable from a miss, which is the requirement.
    await person.type(await within(dialog).findByPlaceholderText(/name/i), 'Waiting directory')
    await person.click(within(dialog).getByTestId('customer-confirm'))
    await person.click(screen.getByTestId('save-order'))

    // Both inside one `waitFor`: the heading arrives on the render that follows
    // the save, so waiting only for the call and asserting the heading on the
    // next line is a race the test loses under load.
    await waitFor(() => {
      expect(saveOrder).toHaveBeenCalledOnce()
      expect(screen.getByRole('heading', { name: 'Bills this shift' })).toBeInTheDocument()
    })
  })

  it('says what to do when no shift is open, rather than showing a dead settle button', async () => {
    const adapters = createMockAdapters('biller')
    // The counter chrome is subscribed in the app; let the seeded pending bill
    // deliver through that subscription before the day is finished.
    const unsubscribe = adapters.billing.subscribeCounter(() => {})
    await waitFor(() => expect(adapters.billing.getCounterState().sync.pending).toBe(0))
    unsubscribe()
    const shiftId = adapters.billing.getCounterState().shift!.id
    await adapters.billing.closeShift(shiftId)

    renderCounter(adapters)

    const notice = await screen.findByTestId('no-shift')
    expect(within(notice).getByText(/No shift is open/i)).toBeInTheDocument()
    expect(screen.queryByTestId('settle')).not.toBeInTheDocument()
    expect(screen.getByTestId('open-shift-link')).toBeInTheDocument()
  })
})

describe('BillingCounter — discounts', () => {
  it('prices a line under the menu discount its category carries, and says so', async () => {
    const person = user()
    renderCounter()

    // The demo runs 15% across Burgers. A shawarma beside it carries none, so
    // one bill shows the discounted and the undiscounted together.
    await person.click(await screen.findByTestId(`tile-${MENU_ITEM_BURGER_ID}`))
    await person.click(screen.getByTestId(`tile-${MENU_ITEM_CLASSIC_ID}`))

    const rows = await screen.findByTestId('bill-discount-rows')
    expect(within(rows).getByText('Menu Discount (15%)')).toBeInTheDocument()
    expect(within(rows).getByText('Burgers')).toBeInTheDocument()

    // ₹250 + ₹139 = ₹389, less 15% of the burger (₹37.50) is ₹351.50,
    // which the round-up carries to ₹352.
    expect(within(rows).getByTestId('discount-row-rounding')).toBeInTheDocument()
    expect(screen.getByTestId('bill-total')).toHaveTextContent('₹352')
  })

  it('offers a biller no way to change the owner’s discount', async () => {
    const person = user()
    renderCounter()

    await person.click(await screen.findByTestId(`tile-${MENU_ITEM_BURGER_ID}`))
    const menuRow = await screen.findByTestId('discount-row-menu-15%')

    expect(within(menuRow).queryByRole('button')).not.toBeInTheDocument()
  })

  it('adds a discount to this bill from the keypad, in percent and in rupees', async () => {
    const person = user()
    renderCounter()

    await person.click(await screen.findByTestId(`tile-${MENU_ITEM_CLASSIC_ID}`))
    expect(screen.getByTestId('bill-total')).toHaveTextContent('₹139')

    await person.click(screen.getByTestId('add-discount'))
    // The readout starts at nought and carries its unit.
    expect(screen.getByTestId('discount-readout')).toHaveTextContent('0%')

    await person.click(screen.getByRole('button', { name: '1' }))
    await person.click(screen.getByRole('button', { name: '0' }))
    expect(screen.getByTestId('discount-readout')).toHaveTextContent('10%')

    // The unit switches without the entry being cleared.
    await person.click(screen.getByTestId('discount-unit-amount'))
    expect(screen.getByTestId('discount-readout')).toHaveTextContent('₹10')
    await person.click(screen.getByTestId('discount-unit-percent'))
    expect(screen.getByTestId('discount-readout')).toHaveTextContent('10%')

    await person.click(screen.getByTestId('apply-discount'))

    // ₹139 less 10% is ₹125.10, carried up to ₹126.
    await waitFor(() => {
      expect(screen.getByTestId('bill-total')).toHaveTextContent('₹126')
    })
    expect(screen.getByTestId('discount-row-bill-0')).toHaveTextContent('Discount (10%)')
    expect(screen.getByTestId('discount-row-bill-0')).toHaveTextContent('On this bill')
  })

  it('uses a preset in one tap, and stacks a second discount additively', async () => {
    const person = user()
    renderCounter()

    await person.click(await screen.findByTestId(`tile-${MENU_ITEM_CLASSIC_ID}`))

    await person.click(screen.getByTestId('add-discount'))
    await person.click(screen.getByTestId('discount-preset-percent-1000'))
    await person.click(screen.getByTestId('apply-discount'))

    await person.click(screen.getByTestId('add-discount'))
    await person.click(screen.getByTestId('discount-preset-percent-1500'))
    await person.click(screen.getByTestId('apply-discount'))

    // Additive against the gross subtotal: 25% off ₹139 is ₹34.75, leaving
    // ₹104.25, carried up to ₹105. Not 23.5% compounded.
    await waitFor(() => {
      expect(screen.getByTestId('bill-total')).toHaveTextContent('₹105')
    })
  })

  it('edits a discount in place rather than adding another', async () => {
    const person = user()
    renderCounter()

    await person.click(await screen.findByTestId(`tile-${MENU_ITEM_CLASSIC_ID}`))
    await person.click(screen.getByTestId('add-discount'))
    await person.click(screen.getByTestId('discount-preset-percent-1000'))
    await person.click(screen.getByTestId('apply-discount'))

    await waitFor(() => expect(screen.getByTestId('discount-row-bill-0')).toBeInTheDocument())
    await person.click(screen.getByRole('button', { name: 'Edit Discount (10%)' }))
    await person.click(screen.getByTestId('discount-preset-percent-2000'))
    await person.click(screen.getByTestId('apply-discount'))

    await waitFor(() => {
      expect(screen.getByTestId('discount-row-bill-0')).toHaveTextContent('Discount (20%)')
    })
    // One row, not two: editing replaced it.
    expect(screen.queryByTestId('discount-row-bill-1')).not.toBeInTheDocument()
  })

  it('removes a discount and the total goes back', async () => {
    const person = user()
    renderCounter()

    await person.click(await screen.findByTestId(`tile-${MENU_ITEM_CLASSIC_ID}`))
    await person.click(screen.getByTestId('add-discount'))
    await person.click(screen.getByTestId('discount-preset-percent-1000'))
    await person.click(screen.getByTestId('apply-discount'))

    await waitFor(() => expect(screen.getByTestId('bill-total')).toHaveTextContent('₹126'))
    await person.click(screen.getByRole('button', { name: 'Remove Discount (10%)' }))

    await waitFor(() => {
      expect(screen.getByTestId('bill-total')).toHaveTextContent('₹139')
    })
  })

  it('floors a fully discounted order at a rupee rather than at nothing', async () => {
    const person = user()
    renderCounter()

    await person.click(await screen.findByTestId(`tile-${MENU_ITEM_CLASSIC_ID}`))
    await person.click(screen.getByTestId('add-discount'))
    await person.click(screen.getByRole('button', { name: '1' }))
    await person.click(screen.getByRole('button', { name: '0' }))
    await person.click(screen.getByRole('button', { name: '0' }))
    await person.click(screen.getByTestId('apply-discount'))

    // A free meal is a ₹1 bill, and it is visible in the day's takings for it.
    await waitFor(() => {
      expect(screen.getByTestId('bill-total')).toHaveTextContent('₹1')
    })
  })
})

describe('BillingCounter — a discount survives the whole journey', () => {
  /**
   * Every one of these was a real defect found by ringing an order up and
   * looking at it, not by a type error. They are pinned because each fails
   * silently: the screen shows a number, it is simply the wrong one.
   */
  it('shows the pipeline card the discounted total, with the list price struck through', async () => {
    const person = user()
    renderCounter()

    await person.click(await screen.findByTestId(`tile-${MENU_ITEM_BURGER_ID}`))
    await skipCustomer(person)
    await person.click(screen.getByTestId('save-order'))

    // ₹250 less the 15% menu discount is ₹212.50, carried to ₹213.
    const card = (await screen.findByText('₹213')).closest('article')
    expect(card).not.toBeNull()
    // The list price is still readable, struck through beside it — scoped to
    // the card, because ₹250 is also the burger's price on the menu tile.
    expect(within(card!).getByText('₹250')).toHaveClass('line-through')
  })

  it('gives an order its discounts back when it is reopened for edit', async () => {
    const person = user()
    renderCounter()

    await person.click(await screen.findByTestId(`tile-${MENU_ITEM_CLASSIC_ID}`))
    await person.click(screen.getByTestId('add-discount'))
    await person.click(screen.getByTestId('discount-preset-percent-1000'))
    await person.click(screen.getByTestId('apply-discount'))
    await waitFor(() => expect(screen.getByTestId('bill-total')).toHaveTextContent('₹126'))

    await skipCustomer(person)
    await person.click(screen.getByTestId('save-order'))
    await waitFor(() => expect(screen.queryByTestId('bill-total')).not.toBeInTheDocument())

    // Uncommon actions live behind the kebab; Edit is one of them.
    const rail = await screen.findByTestId('counter-activity-rail')
    const openOrder = await within(rail).findByTestId(/^open-order-local-/)
    await person.click(within(openOrder).getByRole('button', { name: /^More actions/ }))
    await person.click(within(openOrder).getByRole('menuitem', { name: 'Edit' }))

    // Everything that was on it when it was placed: the line, and the discount.
    await waitFor(() => {
      expect(screen.getByTestId('discount-row-bill-0')).toHaveTextContent('Discount (10%)')
    })
    // And the control to change it, exactly as when the order was composed.
    expect(screen.getByTestId('add-discount')).toBeInTheDocument()
  })

  it('does not carry a discount over to the next customer', async () => {
    const person = user()
    renderCounter()

    await person.click(await screen.findByTestId(`tile-${MENU_ITEM_CLASSIC_ID}`))
    await person.click(screen.getByTestId('add-discount'))
    await person.click(screen.getByTestId('discount-preset-percent-1000'))
    await person.click(screen.getByTestId('apply-discount'))
    await waitFor(() => expect(screen.getByTestId('bill-total')).toHaveTextContent('₹126'))

    await skipCustomer(person)
    await person.click(screen.getByTestId('save-order'))
    await waitFor(() => expect(screen.queryByTestId('bill-total')).not.toBeInTheDocument())

    // The next sale starts at the list price. A discount inherited here would be
    // given to somebody who never asked and would never be checked.
    await person.click(screen.getByTestId(`tile-${MENU_ITEM_CLASSIC_ID}`))
    expect(screen.getByTestId('bill-total')).toHaveTextContent('₹139')
    expect(screen.queryByTestId('discount-row-bill-0')).not.toBeInTheDocument()
  })
})
