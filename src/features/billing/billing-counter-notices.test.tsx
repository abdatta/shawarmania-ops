import { act, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DataAdapters, OutletBillingTable } from '@/data-access/adapters'
import { AdaptersContext } from '@/data-access/adapters-context'
import { createDemoStore, createMockAdapters } from '@/data-access/mock'
import { MENU_ITEM_CLASSIC_ID } from '@/data-access/mock/fixtures/menu'
import { personaFixtures } from '@/data-access/mock/fixtures/personas'
import { createMockBillingAdapter } from '@/data-access/mock/billing'
import { createMockMenuAdapter } from '@/data-access/mock/menu'
import { MENU_REREAD_ON_SALE_AFTER_MS, NOTICE_BURST_MS } from '@/lib/freshness'
import { SessionContext } from '@/session/context'
import type { Session } from '@/session/session'
import { deriveSessionScope } from '@/session/session'

import { BillingCounter } from './billing-counter'

/**
 * The counter's change notices (the-app-asks-the-server-less, D4): a menu edit
 * reloads the menu, a sale's burst of notices refreshes the bills and the rail
 * once, and a sale reloads the menu only when it is more than two minutes old.
 */

const billerSession: Session = {
  mode: 'demo',
  userId: personaFixtures.biller.profile.id,
  assignments: personaFixtures.biller.assignments,
  ...deriveSessionScope(personaFixtures.biller.assignments),
  displayName: personaFixtures.biller.profile.full_name,
  persona: personaFixtures.biller,
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  vi.useRealTimers()
})

function renderCounter() {
  const store = createDemoStore()
  const adapters: DataAdapters = {
    ...createMockAdapters('biller'),
    billing: createMockBillingAdapter(store),
    menu: createMockMenuAdapter(store, 'biller'),
  }
  let nudgeTable: ((table: OutletBillingTable) => void) | null = null
  const tables = vi.spyOn(adapters.counter, 'subscribeToOutletBillingTables')
  tables.mockImplementation((_outlet, onChange) => {
    nudgeTable = onChange
    return () => {}
  })
  const menuReads = vi.spyOn(adapters.menu, 'readOutletMenu')
  const orderReads = vi.spyOn(adapters.billing, 'listOpenOrders')
  render(
    <MemoryRouter>
      <SessionContext.Provider value={billerSession}>
        <AdaptersContext.Provider value={adapters}>
          <BillingCounter />
        </AdaptersContext.Provider>
      </SessionContext.Provider>
    </MemoryRouter>,
  )
  /** One notice, the way the live channel delivers it. */
  const notice = (table: OutletBillingTable) => nudgeTable?.(table)
  return { store, menuReads, orderReads, notice, tables }
}

async function settled() {
  await screen.findByTestId(`tile-${MENU_ITEM_CLASSIC_ID}`)
  await act(() => vi.advanceTimersByTimeAsync(NOTICE_BURST_MS * 2))
}

describe('the counter’s change notices', () => {
  it('listens on the table-naming channel', async () => {
    const { tables } = renderCounter()
    await settled()
    expect(tables).toHaveBeenCalled()
  })

  it('answers a sale’s burst of notices with one refresh and no menu reload', async () => {
    const { menuReads, orderReads, notice } = renderCounter()
    await settled()
    await waitFor(() => expect(orderReads).toHaveBeenCalled())
    const menuBefore = menuReads.mock.calls.length
    const ordersBefore = orderReads.mock.calls.length

    act(() => {
      notice('orders')
      notice('bills')
      notice('orders')
    })
    await act(() => vi.advanceTimersByTimeAsync(NOTICE_BURST_MS * 2))
    await waitFor(() => expect(orderReads.mock.calls.length).toBeGreaterThan(ordersBefore))

    expect(menuReads.mock.calls.length).toBe(menuBefore)
    expect(orderReads.mock.calls.length - ordersBefore).toBe(1)
  })

  it('reloads the menu for a menu edit', async () => {
    const { store, menuReads, notice } = renderCounter()
    await settled()
    const tile = screen.getByTestId(`tile-${MENU_ITEM_CLASSIC_ID}`)
    const menuBefore = menuReads.mock.calls.length

    const item = store.menuItems.find((row) => row.id === MENU_ITEM_CLASSIC_ID)!
    item.is_available = false
    act(() => notice('menu_items'))
    await act(() => vi.advanceTimersByTimeAsync(NOTICE_BURST_MS * 2))

    await waitFor(() => expect(tile).toBeDisabled())
    expect(menuReads.mock.calls.length).toBeGreaterThan(menuBefore)
  })

  it('reloads the menu on a sale once it is more than two minutes old', async () => {
    const { menuReads, notice } = renderCounter()
    await settled()
    const menuBefore = menuReads.mock.calls.length

    await act(() => vi.advanceTimersByTimeAsync(MENU_REREAD_ON_SALE_AFTER_MS + 1_000))
    act(() => notice('bills'))
    await act(() => vi.advanceTimersByTimeAsync(NOTICE_BURST_MS * 2))

    await waitFor(() => expect(menuReads.mock.calls.length).toBe(menuBefore + 1))
  })
})
