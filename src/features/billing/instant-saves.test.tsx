import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import type { BillingAdapter, DataAdapters } from '@/data-access/adapters'
import { AdaptersContext } from '@/data-access/adapters-context'
import { createDemoData, createMockAdapters } from '@/data-access/mock'
import { MENU_ITEM_CLASSIC_ID, MENU_ITEM_MAYO_ID } from '@/data-access/mock/fixtures/menu'
import { personaFixtures } from '@/data-access/mock/fixtures/personas'
import { ALL_OFF_SERVICE_SETTINGS, type OutletServiceSettings } from '@/domain'
import { SessionContext } from '@/session/context'
import { deriveSessionScope, type Session } from '@/session/session'

import { BillingCounter } from './billing-counter'
import { CounterRecords } from './counter-records'

/**
 * The counter shows what it saved before the server answers
 * (the-counter-shows-what-it-saved).
 *
 * The server is held back by holding the adapter's two reads that ask it:
 * `listOpenOrders` and `listShiftHistory`. Each takes its answer when it is
 * called, as a request is answered from the database's state when it arrives,
 * and hands it over only when released. The peeks are the adapter's own and
 * are not held: they ask nothing.
 */

const billerSession: Session = {
  mode: 'demo',
  userId: personaFixtures.biller.profile.id,
  assignments: personaFixtures.biller.assignments,
  ...deriveSessionScope(personaFixtures.biller.assignments),
  displayName: personaFixtures.biller.profile.full_name,
  persona: personaFixtures.biller,
}

const SERVING: OutletServiceSettings = {
  collectCustomerDetails: true,
  dineInOffered: true,
  takeawayOffered: true,
  tableNumbers: true,
  packagingMode: 'per_bag',
  packagingPricePaise: 500,
  packagingFreeForGold: true,
}

type Mode = 'answer' | 'hold' | 'fail'

function heldServer(adapters: DataAdapters) {
  const base = adapters.billing
  let mode: Mode = 'answer'
  let waiting: (() => void)[] = []
  const asked = async <T,>(read: () => Promise<T>): Promise<T> => {
    if (mode === 'fail') throw new Error('backend unavailable')
    const answer = read()
    if (mode === 'hold') await new Promise<void>((resolve) => waiting.push(resolve))
    return answer
  }
  const billing: BillingAdapter = {
    ...base,
    listOpenOrders: (outletId) => asked(() => base.listOpenOrders(outletId)),
    listShiftHistory: (shiftId) => asked(() => base.listShiftHistory(shiftId)),
  }
  return {
    adapters: { ...adapters, billing },
    set(next: Mode) {
      mode = next
    },
    release() {
      mode = 'answer'
      this.answerHeld()
    },
    /** Answer the reads held so far, and keep holding any asked after. */
    answerHeld() {
      const released = waiting
      waiting = []
      for (const resolve of released) resolve()
    },
  }
}

/** The till and the records row, handing their own saves to each other as the shell does. */
function Till() {
  const [billRefresh, setBillRefresh] = useState(0)
  const [billOwnSave, setBillOwnSave] = useState(0)
  const [railOwnSave, setRailOwnSave] = useState(0)
  return (
    <>
      <BillingCounter
        onBillRefresh={setBillRefresh}
        onBillOwnSave={setBillOwnSave}
        railOwnSave={railOwnSave}
      />
      <CounterRecords
        expenses={<p>Counter expenses</p>}
        refreshKey={billRefresh}
        ownSaveKey={billOwnSave}
        onOwnSave={() => setRailOwnSave((value) => value + 1)}
      />
    </>
  )
}

function renderTill({
  serving = ALL_OFF_SERVICE_SETTINGS,
}: { serving?: OutletServiceSettings } = {}) {
  const demo = createMockAdapters('biller', createDemoData({ dishWalkthrough: true }))
  const menu = demo.menu
  const server = heldServer({
    ...demo,
    menu: {
      ...menu,
      readOutletMenu: async (outletId) => ({
        ...(await menu.readOutletMenu(outletId)),
        service: { ...serving },
      }),
    },
  })
  render(
    <MemoryRouter>
      <SessionContext.Provider value={billerSession}>
        <AdaptersContext.Provider value={server.adapters}>
          <Till />
        </AdaptersContext.Provider>
      </SessionContext.Provider>
    </MemoryRouter>,
  )
  return server
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  vi.useRealTimers()
})

function user() {
  return userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
}

const rail = () => screen.getByTestId('counter-activity-rail')
const bills = () => screen.getByRole('region', { name: 'Bills this shift' })
const cardFor = (orderId: string) =>
  rail().querySelector<HTMLElement>(`[data-flip-id="${orderId}"]`)

/** Both columns have read once, so what follows is about a save, not the first load. */
async function settled() {
  await within(rail()).findByTestId('open-order-104')
  await waitFor(() => expect(bills().querySelector('details')).not.toBeNull())
}

/** Long enough for anything that is not waiting on the server to have drawn. */
async function aMoment() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(50)
  })
}

async function skipPaymentCustomerIfAsked(person: ReturnType<typeof user>) {
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Loading payment' })).toBeNull())
  const question = screen.queryByRole('dialog', { name: 'Receipt and points' })
  if (question) await person.click(within(question).getByTestId('customer-skip'))
}

async function pay(person: ReturnType<typeof user>) {
  await skipPaymentCustomerIfAsked(person)
  const dialog = screen.getByRole('dialog', { name: 'Record payment' })
  await person.click(within(dialog).getByRole('button', { name: 'Cash' }))
  await person.click(within(dialog).getByRole('button', { name: 'Paid' }))
}

it('puts an order on the rail before the server answers', async () => {
  const person = user()
  const server = renderTill()
  await settled()
  const saveOrder = vi.spyOn(server.adapters.billing, 'saveOrder')

  server.set('hold')
  await person.click(await screen.findByTestId(`tile-${MENU_ITEM_CLASSIC_ID}`))
  await person.click(screen.getByTestId('save-order'))
  await waitFor(() => expect(saveOrder).toHaveBeenCalledTimes(1))
  const orderId = saveOrder.mock.calls[0]![0].clientId
  await aMoment()

  const card = await within(rail()).findByTestId(`open-order-local-${orderId}`)
  expect(within(card).getByText('Classic Chicken Shawarma')).toBeInTheDocument()
  // The shape of the number, and nothing that reads as one.
  expect(card).not.toHaveTextContent(/#\d/)
  // As usable as any other: its dish can be ticked at once.
  expect(within(card).getByRole('button', { name: /^Tick/ })).toBeEnabled()

  server.release()
  await waitFor(() => expect(cardFor(orderId)).not.toBeNull())
})

it('redraws an edited card before the server answers', async () => {
  const person = user()
  const server = renderTill()
  await settled()
  const openOrder = within(rail()).getByTestId('open-order-104')
  expect(within(openOrder).queryByText('Mayonnaise Chicken Shawarma')).toBeNull()

  await person.click(
    within(openOrder).getByRole('button', { name: /^More actions for Order .104$/ }),
  )
  await person.click(within(openOrder).getByRole('menuitem', { name: 'Edit' }))
  await person.click(screen.getByRole('button', { name: 'Mayonnaise Chicken Shawarma' }))
  server.set('hold')
  await person.click(screen.getByTestId('save-order'))
  await aMoment()

  const mayo = () =>
    within(within(rail()).getByTestId('open-order-104')).queryByText('Mayonnaise Chicken Shawarma')
  await waitFor(() => expect(mayo()).not.toBeNull())

  server.release()
  await waitFor(() => expect(mayo()).not.toBeNull())
})

it('puts a Pay now bill in Bills before the server answers', async () => {
  const person = user()
  const server = renderTill()
  await settled()
  const settleBill = vi.spyOn(server.adapters.billing, 'settleBill')

  server.set('hold')
  await person.click(await screen.findByTestId(`tile-${MENU_ITEM_CLASSIC_ID}`))
  await person.click(screen.getByTestId('settle'))
  await pay(person)
  await waitFor(() => expect(settleBill).toHaveBeenCalledTimes(1))
  const billId = settleBill.mock.calls[0]![0].clientId
  await aMoment()

  const row = () => within(bills()).queryByTestId(`shift-bill-${billId}`)
  await waitFor(() => expect(row()).not.toBeNull())

  server.release()
  await waitFor(() => expect(row()).not.toBeNull())
})

it('marks a table busy from a just-saved order before the server answers', async () => {
  const person = user()
  const server = renderTill({ serving: SERVING })
  await settled()
  const tableDialog = () => screen.getByRole('dialog', { name: 'Which table' })

  await person.click(await screen.findByTestId(`tile-${MENU_ITEM_CLASSIC_ID}`))
  await person.click(screen.getByTestId('service-chip-dine_in'))
  await person.click(within(tableDialog()).getByRole('button', { name: '7' }))
  await person.click(within(tableDialog()).getByTestId('table-confirm'))
  await person.click(screen.getByTestId('customer-row'))
  await person.click(
    within(screen.getByRole('dialog', { name: 'Customer' })).getByTestId('customer-skip'),
  )
  server.set('hold')
  await person.click(screen.getByTestId('save-order'))
  await aMoment()

  await person.click(await screen.findByTestId(`tile-${MENU_ITEM_MAYO_ID}`))
  await person.click(screen.getByTestId('service-chip-dine_in'))
  await person.click(within(tableDialog()).getByRole('button', { name: '7' }))
  await aMoment()

  const busy = () => within(tableDialog()).queryByTestId('table-busy')
  await waitFor(() => expect(busy()).not.toBeNull())

  server.release()
  await waitFor(() => expect(busy()).not.toBeNull())
})

it('keeps a just-saved order on the rail when an older read lands after it', async () => {
  const person = user()
  const server = renderTill()
  await settled()
  const saveOrder = vi.spyOn(server.adapters.billing, 'saveOrder')

  // A read goes out before the save, as one does on a return to the
  // foreground, and is held until after the order is drawn.
  server.set('hold')
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await aMoment()
  await person.click(await screen.findByTestId(`tile-${MENU_ITEM_CLASSIC_ID}`))
  await person.click(screen.getByTestId('save-order'))
  await waitFor(() => expect(saveOrder).toHaveBeenCalledTimes(1))
  const orderId = saveOrder.mock.calls[0]![0].clientId
  await waitFor(() => expect(cardFor(orderId)).not.toBeNull())

  // The older read lands, while the read the save asked for is still out.
  server.answerHeld()
  await aMoment()
  await aMoment()
  expect(cardFor(orderId)).not.toBeNull()
  server.release()
  await aMoment()
  expect(cardFor(orderId)).not.toBeNull()
})

it('takes a payment back from Bills and the order is back on the rail at once', async () => {
  const person = user()
  const server = renderTill()
  await settled()
  const saveOrder = vi.spyOn(server.adapters.billing, 'saveOrder')
  const payOrder = vi.spyOn(server.adapters.billing, 'payOrder')

  await person.click(await screen.findByTestId(`tile-${MENU_ITEM_CLASSIC_ID}`))
  await person.click(screen.getByTestId('save-order'))
  await waitFor(() => expect(saveOrder).toHaveBeenCalledTimes(1))
  const orderId = saveOrder.mock.calls[0]![0].clientId
  await waitFor(() => expect(cardFor(orderId)).not.toBeNull())
  // Every dish handed over, then paid: the ticket leaves the rail for Bills.
  await person.click(within(cardFor(orderId)!).getByRole('button', { name: /^Tick/ }))
  await person.click(within(cardFor(orderId)!).getByRole('button', { name: /^Paid/ }))
  await pay(person)
  await waitFor(() => expect(payOrder).toHaveBeenCalledTimes(1))
  await waitFor(() => expect(cardFor(orderId)).toBeNull())
  const billId = (await payOrder.mock.results[0]!.value)!.id
  // Delivered, as a payment taken minutes ago has been.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2_000)
  })
  const row = await within(bills()).findByTestId(`shift-bill-${billId}`)

  server.set('hold')
  await person.click(row.querySelector('summary')!)
  await person.click(within(row).getByRole('button', { name: 'Take the payment back' }))
  const dialog = screen.getByRole('dialog', { name: /^Take back the payment for/ })
  await person.type(
    within(dialog).getByPlaceholderText('Why is this payment coming back?'),
    'Wrong order',
  )
  await person.click(within(dialog).getByRole('button', { name: 'Take it back' }))
  await aMoment()

  await waitFor(() => expect(cardFor(orderId)).not.toBeNull())
  expect(within(bills()).queryByTestId(`shift-bill-${billId}`)).toBeNull()
  expect(screen.getByText('The payment was taken back and the order reopened.')).toBeInTheDocument()
  server.release()
})

it('does not call a saved take-back a failure when the read after it fails', async () => {
  const person = user()
  const server = renderTill()
  await settled()
  const saveOrder = vi.spyOn(server.adapters.billing, 'saveOrder')
  const payOrder = vi.spyOn(server.adapters.billing, 'payOrder')

  await person.click(await screen.findByTestId(`tile-${MENU_ITEM_CLASSIC_ID}`))
  await person.click(screen.getByTestId('save-order'))
  await waitFor(() => expect(saveOrder).toHaveBeenCalledTimes(1))
  const orderId = saveOrder.mock.calls[0]![0].clientId
  await waitFor(() => expect(cardFor(orderId)).not.toBeNull())
  // Every dish handed over, then paid: the ticket leaves the rail for Bills.
  await person.click(within(cardFor(orderId)!).getByRole('button', { name: /^Tick/ }))
  await person.click(within(cardFor(orderId)!).getByRole('button', { name: /^Paid/ }))
  await pay(person)
  await waitFor(() => expect(payOrder).toHaveBeenCalledTimes(1))
  await waitFor(() => expect(cardFor(orderId)).toBeNull())
  const billId = (await payOrder.mock.results[0]!.value)!.id
  // Delivered, as a payment taken minutes ago has been.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2_000)
  })
  const row = await within(bills()).findByTestId(`shift-bill-${billId}`)

  server.set('fail')
  await person.click(row.querySelector('summary')!)
  await person.click(within(row).getByRole('button', { name: 'Take the payment back' }))
  const dialog = screen.getByRole('dialog', { name: /^Take back the payment for/ })
  await person.type(
    within(dialog).getByPlaceholderText('Why is this payment coming back?'),
    'Wrong order',
  )
  await person.click(within(dialog).getByRole('button', { name: 'Take it back' }))
  await aMoment()
  await aMoment()

  expect(screen.getByText('The payment was taken back and the order reopened.')).toBeInTheDocument()
  expect(screen.queryByText('That item could not be resolved.')).toBeNull()
  expect(screen.queryByText('Could not load this shift.')).toBeNull()
})

it('keeps the shift’s bills on screen when a read of them fails', async () => {
  const person = user()
  const server = renderTill()
  await settled()
  const before = bills().querySelectorAll('details').length

  server.set('fail')
  await person.click(await screen.findByTestId(`tile-${MENU_ITEM_CLASSIC_ID}`))
  await person.click(screen.getByTestId('settle'))
  await pay(person)
  await aMoment()
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await aMoment()

  await waitFor(() => expect(bills().querySelectorAll('details').length).toBe(before + 1))
  expect(screen.queryByText('Could not load this shift.')).toBeNull()
})
