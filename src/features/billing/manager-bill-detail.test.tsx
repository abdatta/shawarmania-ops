import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { BillingBill } from '@/data-access/adapters'

import { ManagerBillDetail } from './manager-bill-detail'

const bill: BillingBill = {
  id: 'bill-1',
  outletId: 'outlet-1',
  billNumber: 42,
  orderNumber: 9,
  businessDate: '2026-08-12',
  orderedAt: '2026-08-12T12:00:00.000Z',
  paidAt: '2026-08-12T12:05:00.000Z',
  paymentBusinessDate: '2026-08-12',
  payments: [{ method: 'upi', amountPaise: 13_900 }],
  paymentRevision: 0,
  paymentEditableUntil: null,
  paymentMethod: 'upi',
  status: 'settled',
  billerName: 'Demo Biller',
  customerName: 'Demo Customer',
  customerPhone: null,
  lines: [
    {
      menuItemId: 'item-1',
      itemName: 'Classic Chicken Shawarma',
      unitPricePaise: 13_900,
      quantity: 1,
    },
  ],
  totalPaise: 13_900,
  voidReason: null,
  voidedAt: null,
}

describe('manager bill detail', () => {
  it('shows complete structured facts while keeping cancellation progressive', async () => {
    const user = userEvent.setup()
    const start = vi.fn()
    const { rerender } = render(
      <ManagerBillDetail
        bill={bill}
        cancelling={false}
        reason=""
        onReasonChange={vi.fn()}
        onStartCancelling={start}
        onKeepBill={vi.fn()}
        onConfirmCancellation={vi.fn()}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Order items' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Payment' })).toBeVisible()
    const customerDisclosure = screen.getByText('Customer details').closest('details')
    const timelineDisclosure = screen.getByText('Bill timeline').closest('details')
    expect(customerDisclosure).not.toHaveAttribute('open')
    expect(timelineDisclosure).not.toHaveAttribute('open')
    expect(screen.getByText('Demo Customer')).not.toBeVisible()
    expect(screen.getByText('Not provided')).not.toBeVisible()
    expect(screen.queryByText('Demo Biller')).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Cancellation reason/)).not.toBeInTheDocument()

    await user.click(screen.getByText('Customer details'))
    expect(customerDisclosure).toHaveAttribute('open')
    expect(screen.getByText('Demo Customer')).toBeVisible()
    expect(screen.getByText('Not provided')).toBeVisible()

    await user.click(screen.getByText('Bill timeline'))
    expect(timelineDisclosure).toHaveAttribute('open')
    expect(screen.getByText('Order 9')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Cancel this bill' }))
    expect(start).toHaveBeenCalledOnce()

    rerender(
      <ManagerBillDetail
        bill={bill}
        cancelling
        reason=""
        onReasonChange={vi.fn()}
        onStartCancelling={start}
        onKeepBill={vi.fn()}
        onConfirmCancellation={vi.fn()}
      />,
    )
    expect(screen.getByLabelText('Cancellation reason for bill 42')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Confirm cancellation' })).toBeDisabled()
  })
})
