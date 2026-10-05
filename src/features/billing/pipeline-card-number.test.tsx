import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import { AWAITING_ORDER_NUMBER } from '@/domain'
import type { BillingOrder } from '@/data-access/adapters'

import { PipelineCard } from './pipeline-card'

/**
 * What a pipeline card says where the order number goes, before there is one.
 *
 * Order numbers are the server's — per outlet, sequential, assigned at insert —
 * and the tablet commits to IndexedDB first so the counter survives a dead
 * connection. Between those two moments the order genuinely has no number.
 *
 * **What fills that gap must not read as an identifier.** It used to be a
 * four-character token, and replacing it with the real number read as the order's
 * identity changing rather than as its number arriving. A shimmer cannot be
 * read as an identity at all, which is the whole point of it.
 */

const ONE_PERSON = 'p0000000-0000-4000-a000-000000000001'
const THIS_TILL = 'd0000000-0000-4000-a000-000000000001'

function order(over: Partial<BillingOrder>): BillingOrder {
  return {
    id: 'a0000000-0000-4000-a000-000000000001',
    outletId: 'o0000000-0000-4000-a000-000000000001',
    deviceId: THIS_TILL,
    orderNumber: 7,
    businessDate: '2026-09-19',
    orderedAt: new Date().toISOString(),
    preparedAt: null,
    status: 'open',
    creatorId: ONE_PERSON,
    creatorName: 'Asha',
    deviceLabel: null,
    customerName: 'Ravi',
    customerPhone: null,
    discounts: [],
    roundingPaise: 0,
    lines: [
      {
        menuItemId: 'm0000000-0000-4000-a000-000000000001',
        itemName: 'Classic Chicken Shawarma',
        unitPricePaise: 11000,
        quantity: 1,
      },
    ],
    totalPaise: 11000,
    cancelReason: null,
    cancelledAt: null,
    cancelledByName: null,
    paidAt: null,
    billId: null,
    ...over,
  }
}

function noop() {}

function renderCard(
  over: Partial<BillingOrder>,
  props: Partial<Parameters<typeof PipelineCard>[0]> = {},
) {
  return render(
    <MemoryRouter>
      <PipelineCard
        {...props}
        order={order(over)}
        currentBillerId={ONE_PERSON}
        currentDeviceId={THIS_TILL}
        busy={false}
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

describe('the order number arrives when it arrives', () => {
  it('shimmers the shape of the number while the order has none', () => {
    const { container } = renderCard({ orderNumber: AWAITING_ORDER_NUMBER })

    const badge = screen.getByTestId('order-reference-a0000000-0000-4000-a000-000000000001')
    // Nothing that could be read as an identifier: no token, and no `#0` either.
    expect(badge).not.toHaveTextContent(/[A-Z0-9]{4}/)
    expect(badge).not.toHaveTextContent('#')
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument()
  })

  it('says in words what the shimmer cannot, for a reader who is not looking', () => {
    renderCard({ orderNumber: AWAITING_ORDER_NUMBER })

    // `Shimmer` is aria-hidden, so without this the badge is simply absent to
    // anybody using a screen reader.
    expect(screen.getByText(/number.*not.*assigned|not yet/i)).toBeInTheDocument()
  })

  it('shows the number itself once the server has assigned one', () => {
    renderCard({ orderNumber: 106 })

    const badge = screen.getByTestId('order-reference-a0000000-0000-4000-a000-000000000001')
    // A pattern rather than a literal: `scripts/check-no-hex.mjs` reads a hash
    // followed by three hex digits as a colour outside the brand layer.
    expect(badge).toHaveTextContent(/^#\s*106$/)
    expect(badge.querySelector('.animate-pulse')).toBeNull()
  })

  it('names an unsent order in words where the token used to be interpolated', () => {
    renderCard({ orderNumber: AWAITING_ORDER_NUMBER })

    // "More actions for A7K3" told a screen reader a hash it could not use.
    const actions = screen.getByRole('button', { name: /^More actions for / })
    expect(actions).toHaveAccessibleName(/unsent order/i)
  })
})

describe('the number leads and the table follows it', () => {
  it('reads #42 · Table 8 on a dine-in card with a table', () => {
    renderCard({ orderNumber: 42, serviceType: 'dine_in', tableNumber: 8 })

    const badge = screen.getByTestId('order-reference-a0000000-0000-4000-a000-000000000001')
    // The table no longer replaces the number: both are on the card, number first.
    expect(badge).toHaveTextContent(/^#\s*42\s*·\s*Table 8$/)
  })

  it('keeps the table steady while the number is still on its way', () => {
    renderCard({ orderNumber: AWAITING_ORDER_NUMBER, serviceType: 'dine_in', tableNumber: 8 })

    const badge = screen.getByTestId('order-reference-a0000000-0000-4000-a000-000000000001')
    expect(badge).toHaveTextContent(/Table 8$/)
    expect(badge.querySelector('.animate-pulse')).not.toBeNull()
  })
})

describe('the customer sits behind one button', () => {
  it('prints neither the name nor the age on the card', () => {
    renderCard({ orderNumber: 42 })

    const card = screen.getByTestId('open-order-42')
    expect(card).not.toHaveTextContent('Ravi')
    expect(card).not.toHaveTextContent(/now|ago/)
  })

  it('opens what the order knows about its customer', async () => {
    const person = userEvent.setup()
    renderCard({ orderNumber: 42, customerPhone: '9876543210', customerTier: 'gold' })

    await person.click(screen.getByRole('button', { name: 'Customer for Order #42' }))
    const details = screen.getByTestId(
      'order-customer-details-a0000000-0000-4000-a000-000000000001',
    )
    expect(details).toHaveTextContent('Ravi')
    expect(details).toHaveTextContent('+91 98765 43210')
  })

  it('starts the edit with the customer dialog when the order has no customer', async () => {
    const person = userEvent.setup()
    const onSetCustomer = vi.fn()
    renderCard({ orderNumber: 42, customerName: null }, { onSetCustomer })

    await person.click(screen.getByRole('button', { name: 'Add a customer to Order #42' }))
    expect(onSetCustomer).toHaveBeenCalledTimes(1)
  })

  it('offers no add button where the order cannot be edited', () => {
    renderCard({ orderNumber: 42, customerName: null })

    expect(
      within(screen.getByTestId('open-order-42')).queryByRole('button', {
        name: /customer/i,
      }),
    ).toBeNull()
  })
})
