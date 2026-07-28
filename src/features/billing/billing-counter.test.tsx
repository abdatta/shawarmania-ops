import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { BillDraft, DataAdapters } from '@/data-access/adapters'
import { AdaptersContext } from '@/data-access/adapters-context'
import { createMockAdapters, createDemoStore } from '@/data-access/mock'
import { createMockBillingAdapter } from '@/data-access/mock/billing'
import { createMockMenuAdapter } from '@/data-access/mock/menu'
import {
  MENU_ITEM_CLASSIC_ID,
  MENU_ITEM_MAYO_ID,
  MENU_ITEM_STUFFED_ID,
} from '@/data-access/mock/fixtures/menu'
import { personaFixtures } from '@/data-access/mock/fixtures/personas'
import { UNDO_WINDOW_MS } from '@/domain'
import { SessionContext } from '@/session/context'
import type { Session } from '@/session/session'

import { BillingCounter } from './billing-counter'

/**
 * The counter, from the biller's side. Everything here is about the two things
 * this screen has to get right: it must be fast, and it must never block.
 */

const billerSession: Session = {
  mode: 'demo',
  userId: personaFixtures.biller.profile.id,
  role: 'biller',
  outletId: personaFixtures.biller.profile.outlet_id,
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

describe('BillingCounter', () => {
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

  it('settles with both customer fields empty, and clears for the next customer', async () => {
    const person = user()
    const { adapters } = renderCounter()
    const settleBill = vi.spyOn(adapters.billing, 'settleBill')

    await person.click(await screen.findByTestId(`tile-${MENU_ITEM_CLASSIC_ID}`))
    await person.click(screen.getByTestId('method-cash'))
    await person.click(screen.getByTestId('settle'))

    expect(settleBill).toHaveBeenCalledTimes(1)
    const draft = settleBill.mock.calls[0]![0] as BillDraft
    expect(draft.customerName).toBe('')
    expect(draft.customerPhone).toBe('')

    // Cleared in the same tick: the next customer is already there.
    expect(screen.queryByTestId(`bill-line-${MENU_ITEM_CLASSIC_ID}`)).not.toBeInTheDocument()
    expect(screen.getByTestId('bill-total')).toHaveTextContent('₹0')
  })

  it('carries the customer details when they were given', async () => {
    const person = user()
    const { adapters } = renderCounter()
    const settleBill = vi.spyOn(adapters.billing, 'settleBill')

    await person.click(await screen.findByTestId(`tile-${MENU_ITEM_CLASSIC_ID}`))
    await person.type(screen.getByPlaceholderText('Customer (optional)'), 'Demo Regular')
    await person.type(screen.getByPlaceholderText('Phone (optional)'), '9000000000')
    await person.click(screen.getByTestId('method-upi'))
    await person.click(screen.getByTestId('settle'))

    const draft = settleBill.mock.calls[0]![0] as BillDraft
    expect(draft.customerName).toBe('Demo Regular')
    expect(draft.customerPhone).toBe('9000000000')
    expect(draft.paymentMethod).toBe('upi')
  })

  it('refuses to settle with no payment method, and says which thing is missing', async () => {
    const person = user()
    const { adapters } = renderCounter()
    const settleBill = vi.spyOn(adapters.billing, 'settleBill')

    await person.click(await screen.findByTestId(`tile-${MENU_ITEM_CLASSIC_ID}`))
    await person.click(screen.getByTestId('settle'))

    expect(screen.getByTestId('counter-error')).toHaveTextContent(/how this was paid/i)
    expect(settleBill).not.toHaveBeenCalled()
    // And the order is still there — nothing was thrown away.
    expect(screen.getByTestId(`bill-line-${MENU_ITEM_CLASSIC_ID}`)).toBeInTheDocument()
  })

  it('refuses to settle an empty bill', async () => {
    const person = user()
    const { adapters } = renderCounter()
    const settleBill = vi.spyOn(adapters.billing, 'settleBill')

    await screen.findByTestId('menu-grid')
    await person.click(screen.getByTestId('method-cash'))
    await person.click(screen.getByTestId('settle'))

    expect(screen.getByTestId('counter-error')).toHaveTextContent(/nothing on this bill/i)
    expect(settleBill).not.toHaveBeenCalled()
  })

  it('shows a provisional reference that is not a bill number, and clears itself', async () => {
    const person = user()
    renderCounter()

    await person.click(await screen.findByTestId(`tile-${MENU_ITEM_CLASSIC_ID}`))
    await person.click(screen.getByTestId('method-cash'))
    await person.click(screen.getByTestId('settle'))

    const reference = screen.getByTestId('provisional-reference').textContent!
    expect(reference).toMatch(/^Queued · [A-Z][0-9A-Z]{3}$/)
    expect(reference).not.toMatch(/^Bill /)

    // No acknowledgement needed: a queue that waits for one is a queue that
    // stops.
    await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS)
    await waitFor(() => {
      expect(screen.queryByTestId('settled-confirmation')).not.toBeInTheDocument()
    })
  })

  it('undoes a settle by cancelling the queued write and restoring the order', async () => {
    const person = user()
    const { adapters } = renderCounter()
    const cancel = vi.spyOn(adapters.billing, 'cancelQueuedBill')

    await person.click(await screen.findByTestId(`tile-${MENU_ITEM_CLASSIC_ID}`))
    await person.click(screen.getByTestId(`tile-${MENU_ITEM_CLASSIC_ID}`))
    await person.type(screen.getByPlaceholderText('Customer (optional)'), 'Demo Regular')
    await person.click(screen.getByTestId('method-cash'))
    await person.click(screen.getByTestId('settle'))

    await person.click(screen.getByTestId('undo-settle'))

    expect(cancel).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId(`bill-quantity-${MENU_ITEM_CLASSIC_ID}`)).toHaveTextContent('2')
    expect(screen.getByPlaceholderText('Customer (optional)')).toHaveValue('Demo Regular')
    expect(screen.getByTestId('method-cash')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByTestId('settled-confirmation')).not.toBeInTheDocument()
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

    await person.click(screen.getByTestId('method-cash'))
    await person.click(screen.getByTestId('settle'))

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
    await person.click(screen.getByTestId('method-cash'))
    await person.click(screen.getByTestId('settle'))

    const draft = settleBill.mock.calls[0]![0] as BillDraft
    expect(draft.businessDate).toBe('2026-07-28')
  })

  it('gives each bill its own client identity', async () => {
    const person = user()
    const { adapters } = renderCounter()
    const settleBill = vi.spyOn(adapters.billing, 'settleBill')

    for (let index = 0; index < 2; index += 1) {
      await person.click(await screen.findByTestId(`tile-${MENU_ITEM_CLASSIC_ID}`))
      await person.click(screen.getByTestId('method-cash'))
      await person.click(screen.getByTestId('settle'))
    }

    const ids = settleBill.mock.calls.map((call) => (call[0] as BillDraft).clientId)
    expect(new Set(ids).size).toBe(2)
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    }
  })

  it('says what to do when no shift is open, rather than showing a dead settle button', async () => {
    const adapters = createMockAdapters('biller')
    const shiftId = adapters.billing.getCounterState().shift!.id
    await adapters.billing.closeShift(shiftId)

    renderCounter(adapters)

    const notice = await screen.findByTestId('no-shift')
    expect(within(notice).getByText(/No shift is open/i)).toBeInTheDocument()
    expect(screen.queryByTestId('settle')).not.toBeInTheDocument()
    expect(screen.getByTestId('open-shift-link')).toBeInTheDocument()
  })
})
