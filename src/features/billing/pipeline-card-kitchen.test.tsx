import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'

import { kitchenBell, type KitchenAnswer } from '@/domain'
import type { BillingOrder } from '@/data-access/adapters'

import { PipelineCard } from './pipeline-card'

/**
 * The kitchen's bell on a rail card (#72).
 *
 * Orange and swinging while a kitchen on shift that carries the order has not
 * pressed ACK; gone, its place kept, once every one has. A dot per kitchen on shift
 * in its fixed place, one kitchen included, only while the bell swings. No bell — and
 * the card exactly as it would be with no kitchen — where no kitchen carries it.
 */

const ONE_PERSON = 'p0000000-0000-4000-a000-000000000001'
const THIS_TILL = 'd0000000-0000-4000-a000-000000000001'
const TWO = [{ label: 'Kitchen 1' }, { label: 'Kitchen 2' }]

function order(): BillingOrder {
  return {
    id: 'a0000000-0000-4000-a000-000000000001',
    outletId: 'o0000000-0000-4000-a000-000000000001',
    deviceId: THIS_TILL,
    orderNumber: 7,
    businessDate: '2026-10-09',
    orderedAt: new Date().toISOString(),
    preparedAt: null,
    status: 'open',
    creatorId: ONE_PERSON,
    creatorName: 'Asha',
    deviceLabel: null,
    customerName: null,
    customerPhone: null,
    discounts: [],
    roundingPaise: 0,
    lines: [
      {
        menuItemId: 'm0000000-0000-4000-a000-000000000001',
        itemName: 'Classic Chicken Shawarma',
        unitPricePaise: 11000,
        quantity: 2,
      },
    ],
    totalPaise: 22000,
    cancelReason: null,
    cancelledAt: null,
    cancelledByName: null,
    paidAt: null,
    billId: null,
  }
}

function noop() {}

function renderCard(
  answers: (KitchenAnswer | null)[] | null,
  kitchens = TWO,
  props: Partial<Parameters<typeof PipelineCard>[0]> = {},
) {
  return render(
    <MemoryRouter>
      <PipelineCard
        {...props}
        order={order()}
        currentBillerId={ONE_PERSON}
        currentDeviceId={THIS_TILL}
        kitchen={answers ? kitchenBell(answers, kitchens) : null}
        onMarkPrepared={noop}
        onUnprepare={noop}
        onMarkPaid={noop}
        onCancel={noop}
        onUnpay={noop}
        onCancelAfterPaid={noop}
      />
    </MemoryRouter>,
  )
}

describe('the kitchen bell on a rail card', () => {
  it('is absent when no kitchen on shift carries the order', () => {
    renderCard(null)
    expect(screen.queryByTestId('kitchen-bell')).toBeNull()
    renderCard([null, null])
    expect(screen.queryByTestId('kitchen-bell')).toBeNull()
  })

  it('swings, orange, while the one kitchen has not pressed ACK', () => {
    renderCard(['waiting'], [{ label: 'Kitchen 1' }])
    const bell = screen.getByRole('img', { name: 'Kitchen 1 has not pressed ACK yet' })
    expect(bell).toHaveAttribute('data-ringing', 'true')
    expect(bell.querySelector('svg')?.getAttribute('class')).toContain('kitchen-bell')
    expect(
      [...within(bell).getByTestId('kitchen-bell-dots').children].map((dot) =>
        dot.getAttribute('data-answer'),
      ),
    ).toEqual(['waiting'])
  })

  it('goes once it has, keeping its place so nothing moves', () => {
    renderCard(['seen'], [{ label: 'Kitchen 1' }])
    const bell = screen.getByRole('img', { name: 'Kitchen 1 has pressed ACK' })
    expect(bell).not.toHaveAttribute('data-ringing')
    expect(within(bell).queryByTestId('kitchen-bell-dots')).toBeNull()
    expect(bell.querySelector('svg')).toBeNull()
  })

  it('shows a dot per kitchen in its place, an empty place for one not carrying it', () => {
    renderCard(['seen', null, 'waiting'], [...TWO, { label: 'Kitchen 3' }])
    expect(
      [...screen.getByTestId('kitchen-bell-dots').children].map((dot) =>
        dot.getAttribute('data-answer'),
      ),
    ).toEqual(['seen', 'none', 'waiting'])
  })

  it('hides the dots once every kitchen has pressed ACK', () => {
    renderCard(['seen', 'seen'])
    expect(screen.getByTestId('kitchen-bell')).not.toHaveAttribute('data-ringing')
    expect(screen.queryByTestId('kitchen-bell-dots')).toBeNull()
  })

  it('names each kitchen for a screen reader, with no word on the card', () => {
    const { container } = renderCard(['seen', 'waiting'])
    screen.getByRole('img', {
      name: 'Kitchen 1 has pressed ACK. Kitchen 2 has not pressed ACK yet',
    })
    expect(container.textContent).not.toMatch(/ACK|seen|waiting/i)
  })

  it('has no bell on the docked card, which has no dish list', () => {
    renderCard(['waiting'], [{ label: 'Kitchen 1' }], { showItems: false })
    expect(screen.queryByTestId('kitchen-bell')).toBeNull()
  })

  it('draws the dish count in a tile, not as "2×"', () => {
    const { container } = renderCard(null)
    expect(container.textContent).not.toContain('2×')
    expect(within(screen.getByRole('list', { name: /Items for/ })).getByText('2')).toBeTruthy()
  })
})
