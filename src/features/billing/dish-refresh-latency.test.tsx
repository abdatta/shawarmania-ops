import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { expect, it, vi } from 'vitest'
import { createMockAdapters } from '@/data-access/mock'
import { AdaptersContext } from '@/data-access/adapters-context'
import { SessionContext } from '@/session/context'
import { personaFixtures } from '@/data-access/mock/fixtures/personas'
import { deriveSessionScope } from '@/session/session'
import { OpenOrdersSurface } from '@/features/billing/open-orders-surface'
import type { BillingOrder } from '@/data-access/adapters'
import { CounterDeviceContext } from '@/session/counter-context'
import { KitchenMarksProvider } from '@/features/billing/kitchen-marks'
import { useKitchenMarks } from '@/features/billing/kitchen-marks-state'
import { useKitchenBoard } from '@/features/kitchen/use-kitchen-board'
import { renderHook } from '@testing-library/react'

it('releases an accepted dish tick while unrelated history is still loading', async () => {
  const base = createMockAdapters('biller')
  const persona = personaFixtures.biller
  const initial: BillingOrder = {
    id: 'diagnostic-order',
    outletId: persona.assignments[0]!.outletId!,
    deviceId: persona.profile.id,
    orderNumber: 1,
    businessDate: '2026-10-12',
    orderedAt: new Date().toISOString(),
    preparedAt: null,
    status: 'paid',
    creatorId: persona.profile.id,
    creatorName: 'Synthetic operator',
    deviceLabel: null,
    customerName: null,
    customerPhone: null,
    discounts: [],
    roundingPaise: 0,
    lines: [
      {
        orderLineId: 'one',
        menuItemId: 'one',
        itemName: 'Synthetic dish one',
        quantity: 1,
        unitPricePaise: 10000,
      },
      {
        orderLineId: 'two',
        menuItemId: 'two',
        itemName: 'Synthetic dish two',
        quantity: 1,
        unitPricePaise: 10000,
      },
    ],
    totalPaise: 20000,
    cancelReason: null,
    cancelledAt: null,
    cancelledByName: null,
    paidAt: new Date().toISOString(),
    billId: 'synthetic-bill',
  }
  let held = initial
  let release!: () => void
  const historyWait = new Promise<void>((resolve) => {
    release = resolve
  })
  const listShiftHistory = vi
    .fn()
    .mockImplementationOnce(async () => ({ bills: [], totals: [] }))
    .mockImplementation(async () => {
      await historyWait
      return { bills: [], totals: [] }
    })
  const tick = vi.fn(async () => {
    held = {
      ...held,
      lines: held.lines.map((line) =>
        line.orderLineId === 'one' ? { ...line, preparedQuantity: 1 } : line,
      ),
    }
    return held
  })
  render(
    <MemoryRouter>
      <SessionContext.Provider
        value={{
          mode: 'demo',
          userId: persona.profile.id,
          assignments: persona.assignments,
          ...deriveSessionScope(persona.assignments),
          displayName: 'Synthetic operator',
          persona,
        }}
      >
        <AdaptersContext.Provider
          value={{
            ...base,
            billing: {
              ...base.billing,
              listOpenOrders: async () => [held],
              listShiftHistory,
              markOrderLinesPrepared: tick,
            },
          }}
        >
          <OpenOrdersSurface embedded twoColumns />
        </AdaptersContext.Provider>
      </SessionContext.Provider>
    </MemoryRouter>,
  )
  await waitFor(() => expect(listShiftHistory).toHaveBeenCalledTimes(1))
  await userEvent.click(await screen.findByRole('button', { name: 'Tick 1 Synthetic dish one' }))
  await waitFor(() => expect(tick).toHaveBeenCalledTimes(1))
  await waitFor(() => expect(listShiftHistory).toHaveBeenCalledTimes(2))
  expect(screen.getByRole('button', { name: 'Tick 1 Synthetic dish two' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Untick 1 Synthetic dish one' })).toBeEnabled()
  release()
  expect(await screen.findByRole('button', { name: 'Tick 1 Synthetic dish two' })).toBeEnabled()
  expect(await screen.findByRole('button', { name: 'Untick 1 Synthetic dish one' })).toBeEnabled()
})

it('queues a fresh counter Ready read behind an older response', async () => {
  const base = createMockAdapters('biller')
  const empty = { kitchens: [], orders: {}, kitchenTablets: 1, readyQuantities: {} }
  const ready = { ...empty, readyQuantities: { 'synthetic-order': { 'synthetic-line': 1 } } }
  let releaseOld!: (value: typeof empty) => void
  const oldRead = new Promise<typeof empty>((resolve) => {
    releaseOld = resolve
  })
  const readCounterMarks = vi
    .fn()
    .mockImplementationOnce(() => oldRead)
    .mockResolvedValue(ready)
  let marks!: ReturnType<typeof useKitchenMarks>
  function Capture() {
    marks = useKitchenMarks()
    return null
  }
  const view = render(
    <AdaptersContext.Provider
      value={{
        ...base,
        kitchen: {
          ...base.kitchen,
          readCounterMarks,
          subscribe: () => () => {},
        },
      }}
    >
      <CounterDeviceContext.Provider
        value={{
          kind: 'counter-device',
          device: {
            deviceId: 'synthetic-device',
            outletId: 'synthetic-outlet',
            label: 'Synthetic till',
          },
          shift: null,
        }}
      >
        <KitchenMarksProvider>
          <Capture />
        </KitchenMarksProvider>
      </CounterDeviceContext.Provider>
    </AdaptersContext.Provider>,
  )
  await waitFor(() => expect(readCounterMarks).toHaveBeenCalledTimes(1))
  let followup!: Promise<void>
  act(() => {
    followup = marks!.refresh()
  })
  expect(readCounterMarks).toHaveBeenCalledTimes(1)
  await act(async () => {
    releaseOld(empty)
    await followup
  })
  expect(readCounterMarks).toHaveBeenCalledTimes(2)
  expect(marks!.marks?.readyQuantities?.['synthetic-order']?.['synthetic-line']).toBe(1)
  view.unmount()
})

it('waits for the kitchen post-write refresh queued behind an older board read', async () => {
  const base = createMockAdapters('biller')
  const oldBoard = await base.kitchen.readBoard()
  let releaseOld!: (value: typeof oldBoard) => void
  const oldRead = new Promise<typeof oldBoard>((resolve) => {
    releaseOld = resolve
  })
  const readBoard = vi
    .fn()
    .mockImplementationOnce(() => oldRead)
    .mockResolvedValue({ ...oldBoard, orders: [] })
  const hook = renderHook(
    () =>
      useKitchenBoard({ outletId: oldBoard.outletId, player: { play: () => 0, stop: () => {} } }),
    {
      wrapper: ({ children }) => (
        <AdaptersContext.Provider
          value={{ ...base, kitchen: { ...base.kitchen, readBoard, subscribe: () => () => {} } }}
        >
          {children}
        </AdaptersContext.Provider>
      ),
    },
  )
  await waitFor(() => expect(readBoard).toHaveBeenCalledTimes(1))
  let followup!: Promise<void>
  act(() => {
    followup = hook.result.current.read()
  })
  expect(readBoard).toHaveBeenCalledTimes(1)
  await act(async () => {
    releaseOld(oldBoard)
    await followup
  })
  expect(hook.result.current.board?.orders).toEqual([])
  expect(readBoard).toHaveBeenCalledTimes(2)
  hook.unmount()
})
