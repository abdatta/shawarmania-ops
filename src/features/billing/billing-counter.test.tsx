import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { BillDraft, DataAdapters } from '@/data-access/adapters'
import { AdaptersContext } from '@/data-access/adapters-context'
import { createMockAdapters, createDemoStore } from '@/data-access/mock'
import { DEMO_MORNING_BILLER_ID } from '@/data-access/mock/fixtures/billing'
import {
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

async function recordPaid(person: ReturnType<typeof user>, method = 'Cash') {
  const name = screen.getByPlaceholderText('Customer name') as HTMLInputElement
  const phone = screen.getByPlaceholderText('Phone number') as HTMLInputElement
  if (!name.value.trim() && !phone.value.trim()) await person.type(name, 'Test customer')
  await person.click(screen.getByTestId('settle'))
  const dialog = screen.getByRole('dialog', { name: 'Record payment' })
  await person.click(within(dialog).getByRole('button', { name: method }))
  await person.click(within(dialog).getByRole('button', { name: 'Mark Paid' }))
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

  it('requires either customer name or phone in the UI before either action', async () => {
    const person = user()
    const { adapters } = renderCounter()
    const settleBill = vi.spyOn(adapters.billing, 'settleBill')

    await person.click(await screen.findByTestId(`tile-${MENU_ITEM_CLASSIC_ID}`))
    expect(screen.getByTestId('save-order')).toBeDisabled()
    expect(screen.getByTestId('settle')).toBeDisabled()
    expect(screen.getByText('Add a customer name or phone to continue.')).toBeInTheDocument()
    expect(settleBill).not.toHaveBeenCalled()

    await person.type(screen.getByPlaceholderText('Phone number'), '9000000000')
    expect(screen.getByTestId('save-order')).toBeEnabled()
    expect(screen.getByTestId('settle')).toBeEnabled()
    await person.clear(screen.getByPlaceholderText('Phone number'))
    expect(screen.getByTestId('save-order')).toBeDisabled()
    await person.type(screen.getByPlaceholderText('Customer name'), 'Demo Regular')
    expect(screen.getByTestId('save-order')).toBeEnabled()
    expect(screen.getByTestId('settle')).toBeEnabled()

    const order = screen.getByRole('button', { name: 'Order' })
    const markPaid = screen.getByTestId('settle')
    expect(markPaid).toHaveTextContent('Mark Paid')
    expect(order.compareDocumentPosition(markPaid) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(order).toHaveClass('bg-primary')
    expect(markPaid).toHaveClass('bg-surface')
  })

  it('carries the customer details when they were given', async () => {
    const person = user()
    const { adapters } = renderCounter()
    const settleBill = vi.spyOn(adapters.billing, 'settleBill')

    await person.click(await screen.findByTestId(`tile-${MENU_ITEM_CLASSIC_ID}`))
    await person.type(screen.getByPlaceholderText('Customer name'), 'Demo Regular')
    await person.type(screen.getByPlaceholderText('Phone number'), '9000000000')
    await recordPaid(person, 'UPI')

    const draft = settleBill.mock.calls[0]![0] as BillDraft
    expect(draft.customerName).toBe('Demo Regular')
    expect(draft.customerPhone).toBe('9000000000')
    expect(draft.payments).toEqual([{ method: 'upi', amountPaise: 13900 }])
  })

  it('keeps payment unconfirmed until a tender allocation covers the bill', async () => {
    const person = user()
    const { adapters } = renderCounter()
    const settleBill = vi.spyOn(adapters.billing, 'settleBill')

    await person.click(await screen.findByTestId(`tile-${MENU_ITEM_CLASSIC_ID}`))
    await person.type(screen.getByPlaceholderText('Customer name'), 'Demo Regular')
    await person.click(screen.getByTestId('settle'))

    const dialog = screen.getByRole('dialog', { name: 'Record payment' })
    expect(within(dialog).getByRole('button', { name: 'Mark Paid' })).toBeDisabled()
    expect(settleBill).not.toHaveBeenCalled()
    // And the order is still there — nothing was thrown away.
    expect(screen.getByTestId(`bill-line-${MENU_ITEM_CLASSIC_ID}`)).toBeInTheDocument()
  })

  it('offers Cash and UPI while withdrawn and vague methods stay absent', async () => {
    const person = user()
    renderCounter()

    await person.click(await screen.findByTestId(`tile-${MENU_ITEM_CLASSIC_ID}`))
    await person.type(screen.getByPlaceholderText('Customer name'), 'Demo Regular')
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
    await person.type(screen.getByPlaceholderText('Customer name'), 'Demo Regular')
    await person.click(screen.getByTestId('settle'))
    const dialog = screen.getByRole('dialog', { name: 'Record payment' })
    await person.click(within(dialog).getByRole('button', { name: '1' }))
    await person.click(within(dialog).getByRole('button', { name: '0' }))
    await person.click(within(dialog).getByRole('button', { name: '0' }))
    await person.click(within(dialog).getByRole('button', { name: 'Cash' }))
    await person.click(within(dialog).getByRole('button', { name: 'UPI' }))
    await person.click(within(dialog).getByRole('button', { name: 'Mark Paid' }))

    expect((settleBill.mock.calls[0]![0] as BillDraft).payments).toEqual([
      { method: 'cash', amountPaise: 10000 },
      { method: 'upi', amountPaise: 3900 },
    ])
  })

  it('keeps the pipeline in the rail and the money in the middle column', async () => {
    const person = user()
    renderCounter()

    // The rail is the pipeline: two sections, no money history.
    const rail = await screen.findByTestId('counter-activity-rail')
    await within(rail).findByText('Preparing')
    await within(rail).findByText('Unpaid Prepared Orders')
    expect(within(rail).getByTestId('pipeline-preparing')).toBeInTheDocument()
    expect(within(rail).getByTestId('pipeline-unpaid-prepared')).toBeInTheDocument()

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

  it('shows a local reference that is not a bill number, and clears itself', async () => {
    const person = user()
    renderCounter()

    await person.click(await screen.findByTestId(`tile-${MENU_ITEM_CLASSIC_ID}`))
    await recordPaid(person)

    const reference = screen.getByTestId('local-reference').textContent!
    expect(reference).toMatch(/^Local · [0-9A-Z]{4}$/)
    expect(reference).not.toMatch(/^Bill /)

    // No acknowledgement needed: a queue that waits for one is a queue that
    // stops.
    await vi.advanceTimersByTimeAsync(2_500)
    await waitFor(() => {
      expect(screen.queryByTestId('settled-confirmation')).not.toBeInTheDocument()
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
    await person.type(screen.getByPlaceholderText('Customer name'), 'Waiting customer')
    await person.click(screen.getByTestId('settle'))
    const dialog = screen.getByRole('dialog', { name: 'Record payment' })
    await person.click(within(dialog).getByRole('button', { name: 'Cash' }))
    await person.click(within(dialog).getByRole('button', { name: 'Mark Paid' }))

    expect(dialog).toBeInTheDocument()
    expect(screen.getByTestId(`bill-line-${MENU_ITEM_CLASSIC_ID}`)).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Customer name')).toHaveValue('Waiting customer')
    expect(screen.queryByTestId('settled-confirmation')).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Mark Paid' })).toBeDisabled()

    await act(async () => commit())
    expect(await screen.findByTestId('settled-confirmation')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Record payment' })).not.toBeInTheDocument()
    expect(screen.queryByTestId(`bill-line-${MENU_ITEM_CLASSIC_ID}`)).not.toBeInTheDocument()
  })

  it('keeps lines, customer and tender intact when durable storage refuses the payment', async () => {
    const person = user()
    const { adapters } = renderCounter()
    vi.spyOn(adapters.billing, 'settleBill').mockRejectedValue(new Error('IndexedDB unavailable'))

    await person.click(await screen.findByTestId(`tile-${MENU_ITEM_CLASSIC_ID}`))
    await person.type(screen.getByPlaceholderText('Customer name'), 'Unsaved customer')
    await person.click(screen.getByTestId('settle'))
    const dialog = screen.getByRole('dialog', { name: 'Record payment' })
    await person.click(within(dialog).getByRole('button', { name: 'UPI' }))
    await person.click(within(dialog).getByRole('button', { name: 'Mark Paid' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/not saved on this tablet/i)
    expect(screen.getByTestId(`bill-line-${MENU_ITEM_CLASSIC_ID}`)).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Customer name')).toHaveValue('Unsaved customer')
    expect(within(dialog).getByRole('list', { name: 'Payment split' })).toHaveTextContent('UPI')
    expect(screen.queryByTestId('settled-confirmation')).not.toBeInTheDocument()
  })

  it('offers tender editing beside the locally accepted paid bill instead of Undo', async () => {
    const person = user()
    renderCounter()

    await person.click(await screen.findByTestId(`tile-${MENU_ITEM_CLASSIC_ID}`))
    await person.click(screen.getByTestId(`tile-${MENU_ITEM_CLASSIC_ID}`))
    await person.type(screen.getByPlaceholderText('Customer name'), 'Demo Regular')
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
    await person.type(screen.getByPlaceholderText('Customer name'), 'Asha')
    await person.click(screen.getByTestId('save-order'))

    expect(saveOrder).toHaveBeenCalledWith(expect.objectContaining({ lines: expect.any(Array) }))
    const rail = await screen.findByTestId('counter-activity-rail')
    // Before delivery the card carries a local reference, never a number.
    const clientId = (saveOrder.mock.calls[0]![0] as { clientId: string }).clientId
    const saved = await within(rail).findByTestId(`open-order-local-${clientId}`)
    expect(within(saved).getByText('Asha')).toBeInTheDocument()
    expect(within(saved).getByText(/Local · [0-9A-Z]{4}/)).toBeInTheDocument()
    expect(within(saved).getByText(/Local · /).textContent).not.toMatch(/#\d/)
    expect(within(saved).getByText('Classic Chicken Shawarma')).toBeInTheDocument()
    expect(within(saved).getByText('Mayonnaise Chicken Shawarma')).toBeInTheDocument()
    expect(within(saved).getByText('now')).toBeInTheDocument()
    expect(within(saved).queryByText('Demo Biller')).not.toBeInTheDocument()
    expect(saved).toHaveTextContent('₹298')

    // Delivered, it has left the queue and carries its permanent daily number.
    await vi.advanceTimersByTimeAsync(500)
    const delivered = await within(rail).findByTestId('open-order-106')
    expect(within(delivered).getByText(/Order [#]106/)).toBeInTheDocument()
    expect(within(rail).queryByText(/Local · /)).not.toBeInTheDocument()

    expect(screen.queryByTestId('saved-order-confirmation')).not.toBeInTheDocument()
    // The composer gave way: the middle column is the money list again.
    expect(screen.getByRole('heading', { name: 'Bills this shift' })).toBeInTheDocument()
  })

  it('shows another creator while omitting the current shift holder', async () => {
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
  })

  it('edits every order field in the composer and restores the suspended draft', async () => {
    const person = user()
    const { adapters } = renderCounter()
    const reviseOrder = vi.spyOn(adapters.billing, 'reviseOrder')

    await person.click(await screen.findByTestId(`tile-${MENU_ITEM_CLASSIC_ID}`))
    await person.type(screen.getByPlaceholderText('Customer name'), 'Waiting customer')

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
    expect(within(pin).getByPlaceholderText('Customer name')).toBeInTheDocument()
    expect(within(screen.getByTestId('bill-panel')).queryByTestId('save-order')).toBeNull()
    expect(screen.getAllByPlaceholderText('Customer name')).toHaveLength(1)
    // The items are the composer's job; the card does not show a second copy.
    expect(within(pin).queryByRole('list', { name: /Items for order/ })).toBeNull()
    // And one total, at the top of the card.
    expect(within(pin).queryByTestId('bill-total')).toBeNull()

    expect(screen.getByTestId(`bill-quantity-${MENU_ITEM_CLASSIC_ID}`)).toHaveTextContent('2')
    expect(screen.getByPlaceholderText('Customer name')).toHaveValue('Demo Customer')
    expect(screen.getByPlaceholderText('Phone number')).toHaveAttribute('inputmode', 'numeric')

    await person.click(screen.getByRole('button', { name: 'Mayonnaise Chicken Shawarma' }))
    await person.clear(screen.getByPlaceholderText('Customer name'))
    await person.type(screen.getByPlaceholderText('Customer name'), 'Updated customer')
    await person.type(screen.getByPlaceholderText('Phone number'), '9000000222')
    await person.click(screen.getByTestId('save-order'))

    await waitFor(() => expect(reviseOrder).toHaveBeenCalledTimes(1))
    expect(reviseOrder).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        customerName: 'Updated customer',
        customerPhone: '9000000222',
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
    expect(screen.getByPlaceholderText('Customer name')).toHaveValue('Waiting customer')
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
    expect(screen.getByPlaceholderText('Customer name')).toHaveValue('Waiting customer')
    expect(screen.getByTestId(`bill-quantity-${MENU_ITEM_CLASSIC_ID}`)).toHaveTextContent('1')
  })

  it('prompts before replacing a conflicting name from an exact full-phone match', async () => {
    const person = user()
    renderCounter()

    // The composer opens on the first tap; the customer fields live there.
    await person.click(await screen.findByTestId(`tile-${MENU_ITEM_CLASSIC_ID}`))
    await person.type(screen.getByPlaceholderText('Customer name'), 'Ria')
    await person.type(screen.getByPlaceholderText('Phone number'), '9000000101')

    const prompt = await screen.findByTestId('customer-match')
    expect(prompt).toHaveTextContent(/replaces the name in this order only/i)
    await person.click(within(prompt).getByRole('button', { name: /Use saved details/i }))
    expect(screen.getByPlaceholderText('Customer name')).toHaveValue('Ritika Sen')
  })

  it('refuses a phone that is not a phone, rather than dropping it silently', async () => {
    const person = user()
    const { adapters } = renderCounter()
    const createOrGet = vi.spyOn(adapters.customers, 'createOrGet')

    await person.click(await screen.findByTestId(`tile-${MENU_ITEM_CLASSIC_ID}`))
    await person.type(screen.getByPlaceholderText('Phone number'), '12345')

    // Nothing said while they are still typing — a number is incomplete for the
    // first nine digits of every number anybody enters.
    expect(screen.queryByTestId('customer-phone-error')).not.toBeInTheDocument()
    await person.tab()
    expect(screen.getByTestId('customer-phone-error')).toHaveTextContent(/complete 10-digit/i)

    // And it cannot be completed: a bad number would reach the bill as PII
    // written wrong while the customer record quietly failed to save.
    expect(screen.getByTestId('save-order')).toBeDisabled()
    expect(screen.getByTestId('settle')).toBeDisabled()
    expect(createOrGet).not.toHaveBeenCalled()

    await person.clear(screen.getByPlaceholderText('Phone number'))
    await person.type(screen.getByPlaceholderText('Phone number'), '9000000999')
    expect(screen.queryByTestId('customer-phone-error')).not.toBeInTheDocument()
    expect(screen.getByTestId('save-order')).toBeEnabled()
  })

  it('automatically saves a complete new phone when an order is accepted', async () => {
    const person = user()
    const { adapters } = renderCounter()
    const createOrGet = vi.spyOn(adapters.customers, 'createOrGet')

    await person.click(await screen.findByTestId(`tile-${MENU_ITEM_CLASSIC_ID}`))
    await person.type(screen.getByPlaceholderText('Customer name'), 'New Customer')
    await person.type(screen.getByPlaceholderText('Phone number'), '9000000999')
    await person.click(screen.getByTestId('save-order'))

    await waitFor(() =>
      expect(createOrGet).toHaveBeenCalledWith({ phone: '+919000000999', name: 'New Customer' }),
    )
  })

  it('does not hold local order acceptance behind a slow customer-directory request', async () => {
    const person = user()
    const { adapters } = renderCounter()
    const saveOrder = vi.spyOn(adapters.billing, 'saveOrder')
    vi.spyOn(adapters.customers, 'createOrGet').mockReturnValue(new Promise(() => {}))

    await person.click(await screen.findByTestId(`tile-${MENU_ITEM_CLASSIC_ID}`))
    await person.type(screen.getByPlaceholderText('Customer name'), 'Waiting directory')
    await person.type(screen.getByPlaceholderText('Phone number'), '9000000999')
    await person.click(screen.getByTestId('save-order'))

    await waitFor(() => expect(saveOrder).toHaveBeenCalledOnce())
    // The panel cleared even though the directory request never answered.
    expect(screen.getByRole('heading', { name: 'Bills this shift' })).toBeInTheDocument()
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
