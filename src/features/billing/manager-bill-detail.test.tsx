import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { BillingBill } from '@/data-access/adapters'

import { ManagerBillDetail } from './manager-bill-detail'

const bill: BillingBill = {
  id: 'bill-1',
  outletId: 'outlet-1',
  billNumber: 42,
  orderId: 'order-9',
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
  tillLabel: null,
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
  discounts: [],
  roundingPaise: 0,
  totalPaise: 13_900,
  voidKind: null,
  voidReason: null,
  voidedAt: null,
  voidedBy: null,
  receiptUrl: 'https://shawarmania.in/bill/Ab3-_x9QzT',
}

describe('manager bill detail', () => {
  it('omits a redundant current year from operational timeline timestamps', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-30T12:00:00.000Z'))

    try {
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

      const timeline = screen.getByText('Bill timeline').closest('details')!
      const ordered = within(timeline).getByText('Ordered').parentElement!
      const paid = within(timeline).getByText('Paid').parentElement!
      const revenueDay = within(timeline).getByText('Revenue day').parentElement!
      expect(ordered).toHaveTextContent('12 Aug, 05:30 pm')
      expect(ordered).not.toHaveTextContent('2026')
      expect(paid).toHaveTextContent('12 Aug, 05:35 pm')
      expect(paid).not.toHaveTextContent('2026')
      expect(revenueDay).toHaveTextContent('12 Aug 2026')
    } finally {
      vi.useRealTimers()
    }
  })

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

  it('qualifies a post-departure bill and records review without rewriting its context', async () => {
    const user = userEvent.setup()
    const onReview = vi.fn().mockResolvedValue(undefined)
    render(
      <ManagerBillDetail
        bill={{
          ...bill,
          billerId: 'rahul',
          billerName: 'Rahul',
          paidAt: '2026-08-12T14:03:00.000Z',
          recordedAfterShiftEnd: true,
          attributionShiftEndedAt: '2026-08-12T14:00:00.000Z',
          attributionReview: null,
        }}
        cancelling={false}
        reason=""
        onReasonChange={vi.fn()}
        onStartCancelling={vi.fn()}
        onKeepBill={vi.fn()}
        onConfirmCancellation={vi.fn()}
        eligibleBillers={[{ profileId: 'priya', fullName: 'Priya' }]}
        onReviewAttribution={onReview}
      />,
    )

    const exception = screen.getByTestId('attribution-exception')
    expect(exception).toHaveTextContent(/included in takings/i)
    expect(exception).toHaveTextContent(/qualified last-known context/i)

    await user.click(screen.getByRole('button', { name: /name another biller/i }))
    await user.selectOptions(screen.getByLabelText(/person who handled the sale/i), 'priya')
    await user.click(screen.getByRole('button', { name: /record review/i }))

    expect(onReview).toHaveBeenCalledWith('assigned_other', 'priya', null)
  })
  /*
   * Share before Cancel, which is the reason this change touched the action row
   * at all: a destructive control should not be the first thing a thumb reaches
   * when a bill expands.
   */
  it('offers Share before Cancel in the action row', () => {
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

    const share = screen.getByRole('button', { name: /share receipt/i })
    const cancel = screen.getByRole('button', { name: 'Cancel this bill' })
    expect(share.compareDocumentPosition(cancel) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
  })

  /*
   * One row, not two [owner, 2026-09-03]. Asserted through the shared parent
   * rather than a class name: what matters is that the two controls are siblings
   * in one flex row, which is what puts them side by side.
   */
  it('puts Share and Cancel in one row', () => {
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

    const share = screen.getByRole('button', { name: /share receipt/i })
    const cancel = screen.getByRole('button', { name: 'Cancel this bill' })
    expect(share.parentElement).toBe(cancel.parentElement)
    expect(share.parentElement).toHaveClass('flex')
  })

  /*
   * The revealed link wraps onto its own line beneath both, because a URL has no
   * room beside two buttons at 375px.
   */
  it('drops a revealed link below the row rather than into it', async () => {
    const user = userEvent.setup()
    Object.defineProperty(window.navigator, 'share', { configurable: true, value: undefined })
    Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: undefined })

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

    await user.click(screen.getByRole('button', { name: /share receipt/i }))
    const link = screen.getByTestId('receipt-link')
    const cancel = screen.getByRole('button', { name: 'Cancel this bill' })
    expect(link.parentElement).toBe(cancel.parentElement)
    // `order-last` as well, or the link would push Cancel onto a third line: it
    // sits between the two buttons in DOM order.
    expect(link).toHaveClass('basis-full')
    expect(link).toHaveClass('order-last')
  })

  it('offers no Share on a cancelled bill', () => {
    render(
      <ManagerBillDetail
        bill={{
          ...bill,
          status: 'void',
          voidReason: 'Duplicate bill',
          voidedAt: '2026-08-12T12:30:00.000Z',
          voidedBy: { id: 'person-1', name: 'Demo Manager' },
        }}
        cancelling={false}
        reason=""
        onReasonChange={vi.fn()}
        onStartCancelling={vi.fn()}
        onKeepBill={vi.fn()}
        onConfirmCancellation={vi.fn()}
      />,
    )

    // A cancelled bill is not something to proactively send. A link already
    // sent for it keeps working and reports the cancellation, which is the
    // receipt's job rather than this row's.
    expect(screen.queryByRole('button', { name: /share receipt/i })).not.toBeInTheDocument()
  })

  it('offers no Share for a bill the server has not accepted yet', () => {
    render(
      <ManagerBillDetail
        bill={{ ...bill, receiptUrl: null }}
        cancelling={false}
        reason=""
        onReasonChange={vi.fn()}
        onStartCancelling={vi.fn()}
        onKeepBill={vi.fn()}
        onConfirmCancellation={vi.fn()}
      />,
    )

    // The token is minted when the row reaches Postgres, so a queued bill has
    // no link. Nothing is offered rather than a URL that would refuse.
    expect(screen.queryByRole('button', { name: /share receipt/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel this bill' })).toBeVisible()
  })
})
