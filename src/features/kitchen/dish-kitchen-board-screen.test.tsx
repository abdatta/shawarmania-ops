import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { AdaptersContext } from '@/data-access/adapters-context'
import type { KitchenAlertKind } from '@/data-access/adapters'
import { createDemoData, createMockAdapters } from '@/data-access/mock'
import { DEMO_KITCHEN_DEVICE_ID, DEMO_KITCHEN_SHIFT_ID } from '@/data-access/mock/kitchen'
import { DEMO_OUTLET_ID } from '@/data-access/mock/store'
import { ChangeGatesForTest, describeChangeGate } from '@/test/change-gates'
import { CounterDeviceContext } from '@/session/counter-context'
import type { CounterDeviceSession } from '@/session/counter-session'

import { DishKitchenBoardScreen } from './dish-kitchen-board-screen'
import type { TunePlayer } from './ringer'

function fakePlayer() {
  const played: KitchenAlertKind[] = []
  const player: TunePlayer = {
    play(kind) {
      played.push(kind)
      return 50
    },
    stop() {},
  }
  return { player, played }
}

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

function renderBoard(readyOn = true) {
  const data = createDemoData({ dishTicks: 'on' })
  const adapters = createMockAdapters('biller', data)
  const { player, played } = fakePlayer()
  render(
    <ChangeGatesForTest on={{ 'dish-ticks': true, 'kitchen-ready': readyOn }}>
      <CounterDeviceContext.Provider value={session}>
        <AdaptersContext.Provider value={adapters}>
          <DishKitchenBoardScreen player={player} />
        </AdaptersContext.Provider>
      </CounterDeviceContext.Provider>
    </ChangeGatesForTest>,
  )
  return { data, played }
}

/** A copy of an open demo order, as a counter would save a new one. */
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

describe('the kitchen board', () => {
  // Every tap on the board schedules a sound check 300 ms later
  // (kitchen-board-screen.tsx). Let it land while this page still exists: left
  // pending, it fired in whatever file the worker ran next, where `window` may
  // not exist, and failed a CI shard whose every test had passed.
  afterEach(() => new Promise((resolve) => window.setTimeout(resolve, 350)))

  it('opens silently, then shakes and rings for an order that arrives, until ACK', async () => {
    const user = userEvent.setup()
    const { data, played } = renderBoard()

    // What is already on the board glows and waits for ACK, but rings nothing.
    const first = await screen.findAllByTestId(/^kitchen-card-/)
    expect(first.length).toBeGreaterThan(0)
    expect(played).toEqual([])

    act(() => ringUpOrder(data, 900))
    const arrived = await screen.findByTestId('kitchen-card-900', {}, { timeout: 3000 })
    expect(arrived).toHaveAttribute('data-state', 'new')
    expect(arrived.parentElement?.className).toContain('kitchen-shake')
    await waitFor(() => expect(played).toContain('new'))
    // Its ACK wiggles while the order is still ringing, as it never does for the
    // cards that were there before.
    const ack = within(arrived).getByRole('button', { name: 'ACK order 900' })
    await waitFor(() => expect(ack).toHaveAttribute('data-ringing', 'true'))
    expect(ack.className).toContain('kitchen-ringing')
    for (const card of first) {
      const silent = within(card).queryByRole('button', { name: /^ACK/ })
      if (silent) expect(silent).not.toHaveAttribute('data-ringing')
    }

    await user.click(within(arrived).getByRole('button', { name: 'ACK order 900' }))
    await waitFor(() =>
      expect(screen.getByTestId('kitchen-card-900')).toHaveAttribute('data-state', 'quiet'),
    )
    expect(
      within(screen.getByTestId('kitchen-card-900')).queryByRole('button', { name: /^ACK/ }),
    ).toBeNull()
    expect(
      within(screen.getByTestId('kitchen-card-900')).getByRole('button', {
        name: 'Ready order 900',
      }),
    ).toBeEnabled()
  })

  it('states its filter, and a saved filter changes what it shows', async () => {
    const user = userEvent.setup()
    renderBoard()
    await waitFor(() =>
      expect(screen.getByTestId('kitchen-filter-summary')).toHaveTextContent(/^Everything$/),
    )

    await user.click(screen.getByRole('button', { name: /^Filter: / }))
    await user.click(await screen.findByRole('radio', { name: 'Only these' }))
    const burgers = await screen.findByRole('checkbox', { name: /burgers/i })
    await user.click(burgers)
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(screen.getByTestId('kitchen-filter-summary')).toHaveTextContent(/^Only Burgers$/),
    )
  })

  it('turns its board round when the kitchen chooses newest first', async () => {
    const user = userEvent.setup()
    const { data } = renderBoard()
    act(() => ringUpOrder(data, 900))
    await screen.findByTestId('kitchen-card-900', {}, { timeout: 3000 })
    const numbers = () =>
      screen
        .getAllByTestId(/^kitchen-card-/)
        .map((card) => Number(card.dataset['testid']!.slice(13)))
    expect(numbers().at(-1)).toBe(900)

    await user.click(screen.getByRole('button', { name: /^Filter: / }))
    await user.click(await screen.findByRole('radio', { name: 'Newest first' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(numbers()[0]).toBe(900))
    // The header never says which way round: the board shows it.
    expect(screen.getByTestId('kitchen-filter-summary')).toHaveTextContent(/^Everything$/)
  })
})

describeChangeGate('kitchen-ready', (on) => {
  afterEach(() => new Promise((resolve) => window.setTimeout(resolve, 350)))

  it(on ? 'offers Done on an acknowledged card' : 'offers ACK only, and never Done', async () => {
    const user = userEvent.setup()
    const { data } = renderBoard(on)
    act(() => ringUpOrder(data, 900))
    const card = await screen.findByTestId('kitchen-card-900', {}, { timeout: 3000 })
    await user.click(within(card).getByRole('button', { name: 'ACK order 900' }))
    await waitFor(() =>
      expect(screen.getByTestId('kitchen-card-900')).toHaveAttribute('data-state', 'quiet'),
    )
    const done = within(screen.getByTestId('kitchen-card-900')).queryByRole('button', {
      name: 'Ready order 900',
    })
    if (on) expect(done).toBeEnabled()
    else expect(done).toBeNull()
  })
})
