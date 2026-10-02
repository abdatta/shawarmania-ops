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
  paymentEditable: false,
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
  receiptUrl: 'https://shawarmania.in/bill?t=Ab3-_x9QzT',
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
  function renderDetail(overrides: Partial<BillingBill> = {}) {
    return render(
      <ManagerBillDetail
        bill={{ ...bill, ...overrides }}
        cancelling={false}
        reason=""
        onReasonChange={vi.fn()}
        onStartCancelling={vi.fn()}
        onKeepBill={vi.fn()}
        onConfirmCancellation={vi.fn()}
      />,
    )
  }

  /*
   * The receipt action before Cancel in reading order, which is the reason #54
   * touched the action row at all: a destructive control should not be the first
   * thing a thumb or a screen reader reaches when a bill expands.
   */
  it('offers the receipt action before Cancel in the action row', () => {
    renderDetail()

    const open = screen.getByRole('link', { name: /open receipt/i })
    const cancel = screen.getByRole('button', { name: 'Cancel this bill' })
    expect(open.compareDocumentPosition(cancel) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
  })

  /*
   * One row, with Cancel at its far end [owner, 2026-09-29]. The gap between the
   * two is what keeps a thumb off Cancel, so it is asserted rather than left to
   * whatever the row happens to do.
   */
  it('puts the receipt action and Cancel in one row, with Cancel at the right-hand end', () => {
    renderDetail()

    const open = screen.getByRole('link', { name: /open receipt/i })
    const cancel = screen.getByRole('button', { name: 'Cancel this bill' })
    expect(open.parentElement).toBe(cancel.parentElement)
    expect(cancel.parentElement).toHaveClass('flex')
    expect(cancel).toHaveClass('ml-auto')
  })

  it('sends on WhatsApp instead when the bill carries the customer’s number', () => {
    renderDetail({ customerPhone: '+919876543210' })

    const send = screen.getByRole('link', { name: 'Send receipt on WhatsApp' })
    expect(send.getAttribute('href')).toMatch(/^https:\/\/wa\.me\/919876543210\?text=/)
    expect(decodeURIComponent(send.getAttribute('href')!)).toContain('₹139')
    expect(screen.queryByRole('link', { name: /open receipt/i })).not.toBeInTheDocument()
  })

  it('offers no receipt action and no Cancel on a cancelled bill', () => {
    renderDetail({
      status: 'void',
      voidReason: 'Duplicate bill',
      voidedAt: '2026-08-12T12:30:00.000Z',
      voidedBy: { id: 'person-1', name: 'Demo Manager' },
      customerPhone: '+919876543210',
    })

    // A cancelled bill is not something to proactively send. A link already
    // sent for it keeps working and reports the cancellation, which is the
    // receipt's job rather than this row's.
    expect(screen.queryByRole('link', { name: /receipt/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel this bill' })).not.toBeInTheDocument()
  })

  it('offers no receipt action for a bill the server has not accepted yet, and keeps Cancel on the right', () => {
    renderDetail({ receiptUrl: null, customerPhone: '+919876543210' })

    // The token is minted when the row reaches Postgres, so a queued bill has
    // no link. Nothing is offered rather than a URL that would refuse.
    expect(screen.queryByRole('link', { name: /receipt/i })).not.toBeInTheDocument()
    const cancel = screen.getByRole('button', { name: 'Cancel this bill' })
    expect(cancel).toBeVisible()
    expect(cancel).toHaveClass('ml-auto')
  })
})
