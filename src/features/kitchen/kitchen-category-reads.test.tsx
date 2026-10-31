import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { AdaptersContext } from '@/data-access/adapters-context'
import { createDemoData, createMockAdapters } from '@/data-access/mock'
import { DEMO_KITCHEN_DEVICE_ID, DEMO_KITCHEN_SHIFT_ID } from '@/data-access/mock/kitchen'
import { DEMO_OUTLET_ID } from '@/data-access/mock/store'
import { CounterDeviceContext } from '@/session/counter-context'
import type { CounterDeviceSession } from '@/session/counter-session'

import { DishKitchenBoardScreen } from './dish-kitchen-board-screen'
import { kitchenFilterKey } from './kitchen-filter-key'
import type { TunePlayer } from './ringer'

/**
 * The kitchen reads its category names when its filter changes, not beside
 * every board read (the-app-asks-the-server-less, D3).
 */

const silent: TunePlayer = { play: () => 50, stop() {} }

const session: CounterDeviceSession = {
  kind: 'counter-device',
  device: {
    deviceId: DEMO_KITCHEN_DEVICE_ID,
    outletId: DEMO_OUTLET_ID,
    label: 'Kitchen 1',
    kind: 'kitchen',
  },
  shift: {
    id: DEMO_KITCHEN_SHIFT_ID,
    personId: 'biller',
    outletId: DEMO_OUTLET_ID,
    openedAt: new Date().toISOString(),
    businessDate: '2026-10-08',
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    kind: 'kitchen',
  },
}

function ringUpOrder(data: ReturnType<typeof createDemoData>, number: number) {
  const source = data.store.orders.find((order) => order.status === 'open')!
  const id = crypto.randomUUID()
  data.store.orders.push({
    ...source,
    id,
    order_number: number,
    ordered_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    changed_at: null,
    prepared_at: null,
    prepared_source: null,
  })
  for (const line of data.store.orderItems.filter((item) => item.order_id === source.id)) {
    data.store.orderItems.push({ ...line, id: crypto.randomUUID(), order_id: id })
  }
}

afterEach(() => new Promise((resolve) => window.setTimeout(resolve, 350)))

it('keys a filter the same however its ids are ordered', () => {
  expect(kitchenFilterKey({ mode: 'include', categoryIds: ['b', 'a'] })).toBe(
    kitchenFilterKey({ mode: 'include', categoryIds: ['a', 'b'] }),
  )
  expect(kitchenFilterKey({ mode: 'include', categoryIds: ['a'] })).not.toBe(
    kitchenFilterKey({ mode: 'exclude', categoryIds: ['a'] }),
  )
  expect(kitchenFilterKey(undefined)).toBeNull()
})

it('does not re-read the categories when the board is read again', async () => {
  const data = createDemoData({ dishWalkthrough: true })
  const adapters = createMockAdapters('biller', data)
  const categories = vi.spyOn(adapters.kitchen, 'listCategories')
  const boardReads = vi.spyOn(adapters.kitchen, 'readDishBoard')
  render(
    <CounterDeviceContext.Provider value={session}>
      <AdaptersContext.Provider value={adapters}>
        <DishKitchenBoardScreen player={silent} />
      </AdaptersContext.Provider>
    </CounterDeviceContext.Provider>,
  )

  await screen.findAllByTestId(/^kitchen-card-/)
  await waitFor(() => expect(categories).toHaveBeenCalled())
  const readsBefore = boardReads.mock.calls.length
  const categoryReadsBefore = categories.mock.calls.length

  act(() => ringUpOrder(data, 901))
  await screen.findByTestId('kitchen-card-901', {}, { timeout: 3000 })
  await waitFor(() => expect(boardReads.mock.calls.length).toBeGreaterThan(readsBefore))
  // Let any effect the new board would set off run.
  await act(() => new Promise((resolve) => window.setTimeout(resolve, 50)))

  expect(categories.mock.calls.length).toBe(categoryReadsBefore)
})
