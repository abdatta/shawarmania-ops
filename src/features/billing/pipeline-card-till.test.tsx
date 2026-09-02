import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'

import type { BillingOrder } from '@/data-access/adapters'

import { PipelineCard } from './pipeline-card'

/**
 * Which till took the order, on a pipeline that shows the whole outlet.
 *
 * The pipeline has always displayed work this counter may not touch, and it
 * explained that with the **creator's name**: a card carrying somebody else's
 * name is somebody else's order. That was a complete explanation while an outlet
 * held one tablet, because another name meant another till.
 *
 * `multiple-billing-devices` breaks the equivalence. Two tablets at one outlet
 * may both be held by the same person -- its spec asserts exactly that -- and
 * then the neighbouring tablet's order carries the reader's OWN name. No creator
 * chip appears, the card is indistinguishable from their own work, and the first
 * thing that tells them otherwise is the database refusing them mid-service.
 *
 * Ownership is per tablet, so the tablet is the only fact that predicts the
 * refusal. That is what this file pins, including the case the old chip
 * genuinely could not cover.
 */

const THIS_TILL = 'd0000000-0000-4000-a000-000000000001'
const OTHER_TILL = 'd0000000-0000-4000-a000-000000000002'
const ONE_PERSON = 'p0000000-0000-4000-a000-000000000001'
const SOMEBODY_ELSE = 'p0000000-0000-4000-a000-000000000002'

function order(over: Partial<BillingOrder>): BillingOrder {
  return {
    id: 'a0000000-0000-4000-a000-000000000001',
    outletId: 'o0000000-0000-4000-a000-000000000001',
    deviceId: THIS_TILL,
    orderNumber: 7,
    businessDate: '2026-09-02',
    orderedAt: new Date().toISOString(),
    preparedAt: null,
    status: 'open',
    creatorId: ONE_PERSON,
    creatorName: 'Asha',
    deviceLabel: null,
    customerName: 'Ravi',
    customerPhone: null,
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

function renderCard(over: Partial<BillingOrder>, currentDeviceId: string | null) {
  return render(
    <MemoryRouter>
      <PipelineCard
        order={order(over)}
        section="preparing"
        currentBillerId={ONE_PERSON}
        currentDeviceId={currentDeviceId}
        busy={false}
        /*
          The card's actions are not what this file is about, so they are
          present and inert. Every one of them is exercised where it belongs.
        */
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

describe('a pipeline card says which till took the order', () => {
  it('names the other till even when the reader took it themselves', () => {
    // The case the creator chip cannot reach: one person, two counters, so the
    // name on the card is their own and says nothing about who may act.
    renderCard(
      { deviceId: OTHER_TILL, deviceLabel: 'Takeaway counter', creatorId: ONE_PERSON },
      THIS_TILL,
    )

    expect(screen.getByTestId('order-till-a0000000-0000-4000-a000-000000000001')).toHaveTextContent(
      'on Takeaway counter',
    )
    // And the creator chip is genuinely absent, so the till chip is the only
    // thing standing between the operator and an unexplained refusal.
    expect(screen.queryByText('· Asha')).not.toBeInTheDocument()
  })

  it("says nothing about the till on this tablet's own work", () => {
    renderCard({ deviceId: THIS_TILL, deviceLabel: 'Counter tablet' }, THIS_TILL)

    expect(
      screen.queryByTestId('order-till-a0000000-0000-4000-a000-000000000001'),
    ).not.toBeInTheDocument()
  })

  it('treats an unreadable label as another till rather than as this one', () => {
    // A label can be absent -- an order replayed locally has none until the
    // first server read. Absent must never render as though the order were this
    // tablet's, so it shows no chip and claims nothing either way.
    renderCard({ deviceId: OTHER_TILL, deviceLabel: null }, THIS_TILL)

    expect(
      screen.queryByTestId('order-till-a0000000-0000-4000-a000-000000000001'),
    ).not.toBeInTheDocument()
  })

  it('names no till off the counter, where ownership is not the question', () => {
    // A manager's history is not a till and has no ownership to explain, so the
    // creator's name remains the honest attribution there.
    renderCard({ deviceId: OTHER_TILL, deviceLabel: 'Takeaway counter' }, null)

    expect(
      screen.queryByTestId('order-till-a0000000-0000-4000-a000-000000000001'),
    ).not.toBeInTheDocument()
  })

  it("stands the actions down on the other till's order", () => {
    renderCard(
      { deviceId: OTHER_TILL, deviceLabel: 'Takeaway counter', creatorId: ONE_PERSON },
      THIS_TILL,
    )

    // Read-only, and still shaped like a card: the till chip beside the time is
    // what explains it, so nobody has to press something to find out.
    for (const label of ['Prepared', 'Paid']) {
      expect(screen.getByRole('button', { name: label })).toBeDisabled()
    }
  })

  it('leaves this tablet own actions alone', () => {
    renderCard({ deviceId: THIS_TILL, deviceLabel: 'Counter tablet' }, THIS_TILL)

    // The mirror of the assertion above, because a gate that disabled
    // everything would pass that one and be useless.
    for (const label of ['Prepared', 'Paid']) {
      expect(screen.getByRole('button', { name: label })).toBeEnabled()
    }
  })

  it('shows both chips when another person on another till took it', () => {
    renderCard(
      { deviceId: OTHER_TILL, deviceLabel: 'Takeaway counter', creatorId: SOMEBODY_ELSE },
      THIS_TILL,
    )

    expect(screen.getByText('· Asha')).toBeInTheDocument()
    expect(
      screen.getByTestId('order-till-a0000000-0000-4000-a000-000000000001'),
    ).toBeInTheDocument()
  })
})
