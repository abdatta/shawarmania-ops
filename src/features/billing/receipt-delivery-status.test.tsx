import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ReceiptDeliveryStatus } from './receipt-delivery-status'

describe('receipt SMS status', () => {
  it('does not confuse provider acceptance with handset delivery', () => {
    render(<ReceiptDeliveryStatus delivery={{ state: 'submitted', failureCode: null }} />)
    expect(screen.getByText('SMS submitted')).toBeVisible()
    expect(screen.queryByText('SMS delivered')).not.toBeInTheDocument()
  })
  it('makes uncertain sends actionable without promising a resend', () => {
    render(
      <ReceiptDeliveryStatus delivery={{ state: 'unknown', failureCode: 'submission_unknown' }} />,
    )
    expect(screen.getByText('SMS delivery uncertain')).toBeVisible()
    expect(screen.getByText(/will not be sent again automatically/)).toHaveTextContent(/WhatsApp/)
  })
  it('never displays raw provider text from an unknown failure code', () => {
    render(
      <ReceiptDeliveryStatus
        delivery={{ state: 'failed', failureCode: 'private phone or token' }}
      />,
    )
    expect(screen.queryByText(/private phone or token/)).not.toBeInTheDocument()
    expect(screen.getByText(/could not be delivered/)).toBeVisible()
  })
  it('omits status for old or numberless bills', () => {
    const { container } = render(<ReceiptDeliveryStatus delivery={null} />)
    expect(container).toBeEmptyDOMElement()
  })
})
