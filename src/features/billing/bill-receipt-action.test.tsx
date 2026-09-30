import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { BillReceiptAction } from './bill-receipt-action'

const URL = 'https://shawarmania.in/bill/Ab3-_x9QzT'
const DEMO = 'https://shawarmania.in/bill/demo~26'
const PHONE = '+919876543210'

function renderAction(props: { receiptUrl?: string; customerPhone?: string | null } = {}) {
  return render(
    <BillReceiptAction
      receiptUrl={props.receiptUrl ?? URL}
      billNumber={1489}
      totalPaise={26000}
      customerPhone={props.customerPhone === undefined ? PHONE : props.customerPhone}
    />,
  )
}

/** Every element on the control that would take the reader to WhatsApp. */
function whatsappLinks(container: HTMLElement) {
  return [...container.querySelectorAll('[href]')].filter((el) =>
    (el.getAttribute('href') ?? '').includes('wa.me'),
  )
}

describe('a bill that carries the customer’s number', () => {
  it('sends the receipt on WhatsApp to that number, with the message typed', () => {
    renderAction()

    const send = screen.getByRole('link', { name: 'Send receipt on WhatsApp' })
    const href = new window.URL(send.getAttribute('href')!)

    expect(href.origin + href.pathname).toBe('https://wa.me/919876543210')
    const text = href.searchParams.get('text')!
    expect(text).toContain('1489')
    expect(text).toContain('₹260')
    expect(text.split('\n').at(-1)).toBe(URL)
  })

  it('opens outside the app and tells WhatsApp nothing about where it came from', () => {
    renderAction()

    const send = screen.getByRole('link', { name: 'Send receipt on WhatsApp' })
    expect(send).toHaveAttribute('target', '_blank')
    expect(send.getAttribute('rel')).toMatch(/noopener/)
    expect(send.getAttribute('rel')).toMatch(/noreferrer/)
  })

  it('offers only that, never Open receipt beside it', () => {
    renderAction()
    expect(screen.queryByRole('link', { name: /open receipt/i })).not.toBeInTheDocument()
  })

  it('reads a number typed with spaces the way the counter would', () => {
    renderAction({ customerPhone: '98765 43210' })

    const send = screen.getByRole('link', { name: 'Send receipt on WhatsApp' })
    expect(send.getAttribute('href')).toMatch(/^https:\/\/wa\.me\/919876543210\?/)
  })
})

describe('a bill without a usable number', () => {
  it('opens the receipt page outside the app when there is no number', () => {
    const { container } = renderAction({ customerPhone: null })

    const open = screen.getByRole('link', { name: /open receipt/i })
    expect(open).toHaveAttribute('href', URL)
    expect(open).toHaveAttribute('target', '_blank')
    expect(open.getAttribute('rel')).toMatch(/noopener/)
    expect(open.getAttribute('rel')).toMatch(/noreferrer/)
    expect(whatsappLinks(container)).toHaveLength(0)
  })

  it('treats a blank number as none', () => {
    renderAction({ customerPhone: '  ' })
    expect(screen.getByRole('link', { name: /open receipt/i })).toBeVisible()
  })

  /*
   * A legacy bill can carry whatever a biller typed. Turning that into a chat
   * link by stripping characters would be a guess, and a guessed digit sends a
   * stranger somebody's bill.
   */
  it('treats a value that is not an Indian mobile as none, and builds no WhatsApp link from it', () => {
    const { container } = renderAction({ customerPhone: 'Ask at counter 12' })

    expect(screen.getByRole('link', { name: /open receipt/i })).toBeVisible()
    expect(screen.queryByRole('link', { name: /send receipt/i })).not.toBeInTheDocument()
    expect(whatsappLinks(container)).toHaveLength(0)
  })

  it('does not share, copy or reveal anything', () => {
    renderAction({ customerPhone: null })

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByTestId('receipt-link')).not.toBeInTheDocument()
  })
})

describe('a demonstration bill', () => {
  /*
   * Demo behaves as production [owner, 2026-09-30]. The link sends nothing: a
   * person still taps Send in WhatsApp, so opening a chat on a demo number is as
   * safe as opening one on a real number.
   */
  it('sends on WhatsApp exactly as a real bill does, and says its link will not open', () => {
    renderAction({ receiptUrl: DEMO })

    const send = screen.getByRole('link', { name: 'Send receipt on WhatsApp' })
    const href = new window.URL(send.getAttribute('href')!)
    expect(href.origin + href.pathname).toBe('https://wa.me/919876543210')
    expect(href.searchParams.get('text')!.split('\n').at(-1)).toBe(DEMO)
    expect(screen.getByTestId('receipt-link-demo')).toHaveTextContent(/will not open a receipt/i)
  })

  it('still opens its link when it has no number, and says the link will not open', () => {
    renderAction({ receiptUrl: DEMO, customerPhone: null })

    expect(screen.getByRole('link', { name: /open receipt/i })).toHaveAttribute('href', DEMO)
    expect(screen.getByTestId('receipt-link-demo')).toHaveTextContent(/will not open a receipt/i)
  })

  it('says nothing of the sort for a real bill', () => {
    renderAction()
    expect(screen.queryByTestId('receipt-link-demo')).not.toBeInTheDocument()
  })
})
