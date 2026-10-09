import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { AdaptersContext } from '@/data-access/adapters-context'
import type { KitchenAlertKind } from '@/data-access/adapters'
import { createDemoData, createMockAdapters } from '@/data-access/mock'
import { DEMO_KITCHEN_DEVICE_ID, DEMO_KITCHEN_SHIFT_ID } from '@/data-access/mock/kitchen'
import { DEMO_OUTLET_ID } from '@/data-access/mock/store'
import { CounterDeviceContext } from '@/session/counter-context'
import type { CounterDeviceSession } from '@/session/counter-session'

import { KitchenBoardScreen } from './kitchen-board-screen'
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

function renderBoard() {
  const data = createDemoData()
  const adapters = createMockAdapters('biller', data)
  const { player, played } = fakePlayer()
  render(
    <CounterDeviceContext.Provider value={session}>
      <AdaptersContext.Provider value={adapters}>
        <KitchenBoardScreen player={player} />
      </AdaptersContext.Provider>
    </CounterDeviceContext.Provider>,
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
      const silent = within(card).queryByRole('button')
      if (silent) expect(silent).not.toHaveAttribute('data-ringing')
    }

    await user.click(within(arrived).getByRole('button', { name: 'ACK order 900' }))
    await waitFor(() =>
      expect(screen.getByTestId('kitchen-card-900')).toHaveAttribute('data-state', 'quiet'),
    )
    expect(within(screen.getByTestId('kitchen-card-900')).queryByRole('button')).toBeNull()
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
