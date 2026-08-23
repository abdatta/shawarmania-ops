import { render, screen, within } from '@testing-library/react'
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
  voidKind: null,
  voidReason: null,
  voidedAt: null,
  voidedBy: null,
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
    expect(screen.queryByRole('heading', { name: 'Payment' })).not.toBeInTheDocument()
    expect(screen.getByTestId('paid-bill-notice')).toBeVisible()
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
    expect(screen.getByRole('button', { name: 'Cancel bill' })).toBeDisabled()
  })

  it('keeps cancellation focused in a neutral dialog and summarizes payment in one line', () => {
    render(
      <ManagerBillDetail
        bill={bill}
        cancelling
        reason="Duplicate bill"
        onReasonChange={vi.fn()}
        onStartCancelling={vi.fn()}
        onKeepBill={vi.fn()}
        onConfirmCancellation={vi.fn()}
      />,
    )

    expect(screen.getByRole('dialog', { name: 'Cancel bill 42' })).toBeVisible()
    expect(screen.queryByText(/corrected sale|enrolled counter tablet/i)).not.toBeInTheDocument()
    expect(screen.getByLabelText('Cancellation reason for bill 42')).toHaveValue('Duplicate bill')
    expect(screen.getByLabelText('Cancellation reason for bill 42')).toHaveAttribute(
      'placeholder',
      'Or type a reason',
    )
    const payment = screen.getByTestId('paid-bill-notice')
    expect(within(payment).getByText('Paid')).toHaveClass('text-success')
    expect(payment).toHaveTextContent('Paid by UPI')
    expect(within(payment).getByText('₹139')).toBeVisible()
  })

  it('fills the editable cancellation reason from a common-reason button', async () => {
    const user = userEvent.setup()
    const onReasonChange = vi.fn()

    render(
      <ManagerBillDetail
        bill={bill}
        cancelling
        reason=""
        onReasonChange={onReasonChange}
        onStartCancelling={vi.fn()}
        onKeepBill={vi.fn()}
        onConfirmCancellation={vi.fn()}
      />,
    )

    expect(
      within(screen.getByRole('group', { name: 'Common cancellation reasons' })).getAllByRole(
        'button',
      ),
    ).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'Mistaken entry' }))
    expect(onReasonChange).toHaveBeenCalledWith('Mistaken entry')
  })

  it('keeps split tender allocations together in the payment line', () => {
    render(
      <ManagerBillDetail
        bill={{
          ...bill,
          paymentMethod: 'cash',
          payments: [
            { method: 'cash', amountPaise: 4_000 },
            { method: 'upi', amountPaise: 9_900 },
          ],
        }}
        cancelling={false}
        reason=""
        onReasonChange={vi.fn()}
        onStartCancelling={vi.fn()}
        onKeepBill={vi.fn()}
        onConfirmCancellation={vi.fn()}
      />,
    )

    const payment = screen.getByTestId('paid-bill-notice')
    expect(within(payment).getByText('Paid')).toHaveClass('text-success')
    expect(payment).toHaveTextContent('Paid by Cash (₹40) + UPI (₹99)')
    expect(within(payment).getByText('₹40')).toBeVisible()
    expect(within(payment).getByText('₹99')).toBeVisible()
    expect(within(payment).getByText('₹139')).toBeVisible()
  })

  it('puts a cancelled bill notice before the sale details', () => {
    render(
      <ManagerBillDetail
        bill={{
          ...bill,
          status: 'void',
          voidReason: 'Duplicate bill',
          voidedAt: '2026-08-12T12:30:00.000Z',
          voidedBy: { id: 'person-1', name: 'Demo Manager' },
        }}
        currentUserId="person-1"
        cancelling={false}
        reason=""
        onReasonChange={vi.fn()}
        onStartCancelling={vi.fn()}
        onKeepBill={vi.fn()}
        onConfirmCancellation={vi.fn()}
      />,
    )

    const notice = screen.getByTestId('cancelled-bill-notice')
    const orderItems = screen.getByRole('heading', { name: 'Order items' })
    const paidNotice = screen.getByTestId('paid-bill-notice')
    expect(notice).toHaveTextContent('Cancelled by You · Duplicate bill')
    expect(notice).not.toHaveTextContent(/Cancelled Today/)
    expect(notice.compareDocumentPosition(orderItems) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
    expect(orderItems.compareDocumentPosition(paidNotice) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
    expect(paidNotice).toHaveTextContent('Paid by UPI')
    expect(paidNotice).toHaveClass('border-success/60')
    expect(screen.queryByRole('button', { name: 'Cancel this bill' })).not.toBeInTheDocument()
  })
})
