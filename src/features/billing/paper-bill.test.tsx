import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { BillingBill } from '@/data-access/adapters'

import { ManagerBillDetail } from './manager-bill-detail'
import { ManagerBillSummary } from './manager-bill-row'

// a-sale-taken-on-paper-says-so: a bill nobody rang reads Paper where a
// counter bill names its biller and till, and says who entered it.

const counterBill: BillingBill = {
  id: 'bill-1',
  outletId: 'outlet-1',
  billNumber: 42,
  orderId: null,
  orderNumber: null,
  businessDate: '2026-10-19',
  orderedAt: '2026-10-19T14:10:00.000Z',
  paidAt: '2026-10-19T14:10:00.000Z',
  paymentBusinessDate: '2026-10-19',
  payments: [{ method: 'cash', amountPaise: 27_800 }],
  paymentRevision: 0,
  paymentEditable: false,
  paymentEditableUntil: null,
  paymentMethod: 'cash',
  status: 'settled',
  billerName: 'Demo Biller',
  tillLabel: 'Counter 2',
  customerName: null,
  customerPhone: null,
  lines: [
    {
      menuItemId: 'item-1',
      itemName: 'Classic Chicken Shawarma',
      unitPricePaise: 13_900,
      quantity: 2,
    },
  ],
  discounts: [],
  roundingPaise: 0,
  totalPaise: 27_800,
  voidKind: null,
  voidReason: null,
  voidedAt: null,
  voidedBy: null,
  receiptUrl: null,
}

const paperBill: BillingBill = {
  ...counterBill,
  id: 'bill-2',
  billNumber: 43,
  billerName: 'Counter operator',
  tillLabel: null,
  entrySource: 'paper',
  enteredByName: 'Demo Manager',
  enteredAt: '2026-10-21T04:45:00.000Z',
}

function summary(bill: BillingBill) {
  render(
    <ManagerBillSummary bill={bill} expanded={false} showingDetail={false} onToggle={vi.fn()} />,
  )
  return screen.getByRole('button')
}

function detail(bill: BillingBill) {
  render(
    <ManagerBillDetail
      bill={bill}
      cancelling={false}
      reason=""
      onReasonChange={vi.fn()}
      onStartCancelling={vi.fn()}
      onKeepBill={vi.fn()}
      onConfirmCancellation={vi.fn()}
    />,
  )
  return screen.getByText('Bill timeline').closest('details')!
}

describe('a paper bill', () => {
  it('reads Paper in its row, naming no biller and no till', () => {
    const row = summary(paperBill)
    expect(within(row).getByTestId('paper-bill-bill-2')).toHaveTextContent('Paper')
    expect(row).not.toHaveTextContent('by ')
    expect(row).not.toHaveTextContent('Counter operator')
    expect(row).not.toHaveTextContent(' on ')
  })

  it('leaves a counter bill naming its biller and till', () => {
    const row = summary(counterBill)
    expect(row).toHaveTextContent('by Demo Biller · on Counter 2')
    expect(within(row).queryByTestId('paper-bill-bill-1')).toBeNull()
  })

  it('says in its timeline who entered it and when', () => {
    const timeline = detail(paperBill)
    const entered = within(timeline).getByText('Entered from paper').parentElement!
    expect(entered).toHaveTextContent('Demo Manager')
    expect(entered).toHaveTextContent('21 Oct')
  })

  it('adds nothing to a counter bill’s timeline', () => {
    const timeline = detail(counterBill)
    expect(within(timeline).queryByText('Entered from paper')).toBeNull()
  })
})
