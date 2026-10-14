import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { expect, it, vi } from 'vitest'
import { createMockAdapters } from '@/data-access/mock'
import { AdaptersContext } from '@/data-access/adapters-context'
import { SessionContext } from '@/session/context'
import { personaFixtures } from '@/data-access/mock/fixtures/personas'
import { deriveSessionScope } from '@/session/session'
import { DishOpenOrdersSurface } from '@/features/billing/dish-open-orders-surface'
import type { BillingOrder } from '@/data-access/adapters'
import { CounterDeviceContext } from '@/session/counter-context'
import { KitchenMarksProvider } from '@/features/billing/kitchen-marks'
import { useKitchenMarks } from '@/features/billing/kitchen-marks-state'
import { useDishKitchenBoard } from '@/features/kitchen/use-dish-kitchen-board'
import { ChangeGatesForTest } from '@/test/change-gates'
import { renderHook } from '@testing-library/react'
import { ALL_OFF_LOYALTY_SETTINGS, ALL_OFF_SERVICE_SETTINGS } from '@/domain'

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
          <DishOpenOrdersSurface embedded />
        </AdaptersContext.Provider>
      </SessionContext.Provider>
    </MemoryRouter>,
  )
  await waitFor(() => expect(listShiftHistory).toHaveBeenCalledTimes(1))
  await userEvent.click(await screen.findByRole('button', { name: 'Tick 1 Synthetic dish one' }))
  await waitFor(() => expect(tick).toHaveBeenCalledTimes(1))
  // At least the re-read after the tick; a pulse may add another, and the count is not the claim.
  await waitFor(() => expect(listShiftHistory.mock.calls.length).toBeGreaterThanOrEqual(2))
  expect(screen.getByRole('button', { name: 'Tick 1 Synthetic dish two' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Untick 1 Synthetic dish one' })).toBeEnabled()
  release()
  expect(await screen.findByRole('button', { name: 'Tick 1 Synthetic dish two' })).toBeEnabled()
  expect(await screen.findByRole('button', { name: 'Untick 1 Synthetic dish one' })).toBeEnabled()
})

it('accepts five rapid ticks, payment, and the last tick while a pipeline read is stalled', async () => {
  const base = createMockAdapters('biller')
  const persona = personaFixtures.biller
  let held: BillingOrder = {
    id: 'mixed',
    outletId: persona.assignments[0]!.outletId!,
    deviceId: persona.profile.id,
    orderNumber: 1,
    businessDate: '2026-10-12',
    orderedAt: new Date().toISOString(),
    preparedAt: null,
    status: 'open',
    creatorId: persona.profile.id,
    creatorName: 'Synthetic operator',
    deviceLabel: null,
    customerName: null,
    customerPhone: null,
    discounts: [],
    roundingPaise: 0,
    lines: Array.from({ length: 6 }, (_, index) => ({
      orderLineId: `line-${index}`,
      menuItemId: `item-${index}`,
      itemName: `Synthetic dish ${index}`,
      quantity: 1,
      unitPricePaise: 10000,
    })),
    totalPaise: 60000,
    cancelReason: null,
    cancelledAt: null,
    cancelledByName: null,
    paidAt: null,
    billId: null,
  }
  const shift = base.billing.getCounterState().shift!
  const bill = (await base.billing.listShiftHistory(shift.id)).bills[0]!
  const tick = vi.fn(
    async (_id: string, _order: string, lines: { id: string; prepared: boolean }[]) => {
      held = {
        ...held,
        lines: held.lines.map((line) =>
          lines.some((target) => target.id === line.orderLineId)
            ? { ...line, preparedQuantity: 1 }
            : line,
        ),
      }
      if (held.lines.every((line) => line.preparedQuantity === 1))
        held = { ...held, preparedAt: new Date().toISOString() }
      return held
    },
  )
  const pay = vi.fn(async () => ({
    ...bill,
    id: 'synthetic-paid-bill',
    paidAt: new Date().toISOString(),
  }))
  const listOpenOrders = vi
    .fn()
    .mockImplementationOnce(async () => [held])
    .mockImplementation(() => new Promise(() => {}))
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
              listOpenOrders,
              markOrderLinesPrepared: tick,
              payOrder: pay,
            },
          }}
        >
          <DishOpenOrdersSurface
            embedded
            checkoutSettings={{
              service: { ...ALL_OFF_SERVICE_SETTINGS, collectCustomerDetails: false },
              loyalty: ALL_OFF_LOYALTY_SETTINGS,
            }}
          />
        </AdaptersContext.Provider>
      </SessionContext.Provider>
    </MemoryRouter>,
  )
  for (let index = 0; index < 5; index++) {
    await userEvent.click(
      await screen.findByRole('button', { name: `Tick 1 Synthetic dish ${index}` }),
    )
    await waitFor(() => expect(tick).toHaveBeenCalledTimes(index + 1))
  }
  await userEvent.click(screen.getByTestId('paid-toggle-mixed'))
  const payment = await screen.findByRole('dialog', { name: 'Record payment' })
  await userEvent.click(within(payment).getByRole('button', { name: /^Cash$/ }))
  await userEvent.click(within(payment).getByRole('button', { name: /^Paid$/ }))
  await waitFor(() => expect(pay).toHaveBeenCalledTimes(1))
  expect(await screen.findByRole('button', { name: 'Tick 1 Synthetic dish 5' })).toBeEnabled()
  expect(screen.getByTestId('paid-toggle-mixed')).toHaveAttribute('aria-pressed', 'true')
  // The local adapter projection used by the last tick includes the accepted payment.
  held = {
    ...held,
    status: 'paid',
    paidAt: new Date().toISOString(),
    billId: 'synthetic-paid-bill',
  }
  await userEvent.click(screen.getByRole('button', { name: 'Tick 1 Synthetic dish 5' }))
  await waitFor(() => expect(tick).toHaveBeenCalledTimes(6))
  await waitFor(() => expect(screen.queryByTestId('paid-toggle-mixed')).toBeNull())
})

it('queues a fresh counter Ready read behind an older response', async () => {
  const base = createMockAdapters('biller')
  const empty = { kitchens: [], orders: {}, kitchenTablets: 1, readyQuantities: {} }
  const ready = { ...empty, readyQuantities: { 'synthetic-order': { 'synthetic-line': 1 } } }
  let releaseOld!: (value: typeof empty) => void
  const oldRead = new Promise<typeof empty>((resolve) => {
    releaseOld = resolve
  })
  const readDishMarks = vi
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
          readDishMarks,
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
        <ChangeGatesForTest on={{ 'dish-ticks': true }}>
          <KitchenMarksProvider>
            <Capture />
          </KitchenMarksProvider>
        </ChangeGatesForTest>
      </CounterDeviceContext.Provider>
    </AdaptersContext.Provider>,
  )
  await waitFor(() => expect(readDishMarks).toHaveBeenCalledTimes(1))
  let followup!: Promise<void>
  act(() => {
    followup = marks!.refresh()
  })
  expect(readDishMarks).toHaveBeenCalledTimes(1)
  await act(async () => {
    releaseOld(empty)
    await followup
  })
  expect(readDishMarks).toHaveBeenCalledTimes(2)
  expect(marks!.marks?.readyQuantities?.['synthetic-order']?.['synthetic-line']).toBe(1)
  view.unmount()
})

it('waits for the kitchen post-write refresh queued behind an older board read', async () => {
  const base = createMockAdapters('biller')
  const oldBoard = await base.kitchen.readDishBoard()
  let releaseOld!: (value: typeof oldBoard) => void
  const oldRead = new Promise<typeof oldBoard>((resolve) => {
    releaseOld = resolve
  })
  const readDishBoard = vi
    .fn()
    .mockImplementationOnce(() => oldRead)
    .mockResolvedValue({ ...oldBoard, orders: [] })
  const hook = renderHook(
    () =>
      useDishKitchenBoard({
        outletId: oldBoard.outletId,
        player: { play: () => 0, stop: () => {} },
      }),
    {
      wrapper: ({ children }) => (
        <AdaptersContext.Provider
          value={{
            ...base,
            kitchen: { ...base.kitchen, readDishBoard, subscribe: () => () => {} },
          }}
        >
          {children}
        </AdaptersContext.Provider>
      ),
    },
  )
  await waitFor(() => expect(readDishBoard).toHaveBeenCalledTimes(1))
  let followup!: Promise<void>
  act(() => {
    followup = hook.result.current.read()
  })
  expect(readDishBoard).toHaveBeenCalledTimes(1)
  await act(async () => {
    releaseOld(oldBoard)
    await followup
  })
  expect(hook.result.current.board?.orders).toEqual([])
  expect(readDishBoard).toHaveBeenCalledTimes(2)
  hook.unmount()
})

it('takes a second tick on the same order while the first is still saving, and keeps both', async () => {
  const base = createMockAdapters('biller')
  const persona = personaFixtures.biller
  let held: BillingOrder = {
    id: 'quick',
    outletId: persona.assignments[0]!.outletId!,
    deviceId: persona.profile.id,
    orderNumber: 1,
    businessDate: '2026-10-14',
    orderedAt: new Date().toISOString(),
    preparedAt: null,
    status: 'open',
    creatorId: persona.profile.id,
    creatorName: 'Synthetic operator',
    deviceLabel: null,
    customerName: null,
    customerPhone: null,
    discounts: [],
    roundingPaise: 0,
    lines: ['one', 'two', 'three'].map((id) => ({
      orderLineId: id,
      menuItemId: id,
      itemName: `Synthetic dish ${id}`,
      quantity: 1,
      unitPricePaise: 10000,
    })),
    totalPaise: 30000,
    cancelReason: null,
    cancelledAt: null,
    cancelledByName: null,
    paidAt: null,
    billId: null,
  }
  // The first save is slow, as an outbox write can be; the rest are not.
  let releaseFirst!: () => void
  const firstSaved = new Promise<void>((resolve) => {
    releaseFirst = resolve
  })
  const saved: string[] = []
  const tick = vi.fn(
    async (_id: string, _order: string, lines: { id: string; prepared: boolean }[]) => {
      if (saved.length === 0) await firstSaved
      saved.push(lines[0]!.id)
      held = {
        ...held,
        lines: held.lines.map((line) =>
          lines.some((target) => target.id === line.orderLineId)
            ? { ...line, preparedQuantity: 1 }
            : line,
        ),
      }
      return held
    },
  )
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
              markOrderLinesPrepared: tick,
            },
          }}
        >
          <DishOpenOrdersSurface embedded />
        </AdaptersContext.Provider>
      </SessionContext.Provider>
    </MemoryRouter>,
  )

  await userEvent.click(await screen.findByRole('button', { name: 'Tick 1 Synthetic dish one' }))
  // The first is still saving: the next dish on the card still takes a tap.
  await userEvent.click(screen.getByRole('button', { name: 'Tick 1 Synthetic dish two' }))
  await userEvent.click(screen.getByRole('button', { name: 'Tick 1 Synthetic dish three' }))
  expect(tick).toHaveBeenCalledTimes(1)
  releaseFirst()
  await waitFor(() => expect(tick).toHaveBeenCalledTimes(3))
  expect(saved).toEqual(['one', 'two', 'three'])
  for (const id of ['one', 'two', 'three'])
    expect(
      await screen.findByRole('button', { name: `Untick 1 Synthetic dish ${id}` }),
    ).toBeInTheDocument()
})
