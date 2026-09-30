import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ReceiptViewer } from './receipt-viewer'

const URL = 'https://shawarmania.in/bill/Ab3-_x9QzT'
const DEMO = 'https://shawarmania.in/bill/demo~26'

function givenOnline(online: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: online })
}

afterEach(() => {
  givenOnline(true)
})

function renderViewer(receiptUrl = URL, onClose = vi.fn()) {
  render(<ReceiptViewer open receiptUrl={receiptUrl} billNumber={27} onClose={onClose} />)
  return onClose
}

describe('the counter’s receipt viewer', () => {
  it('shows the bill’s own receipt page inside the app', () => {
    renderViewer()

    const frame = screen.getByTitle('Receipt for bill 27')
    expect(frame.tagName).toBe('IFRAME')
    expect(frame).toHaveAttribute('src', URL)
  })

  /*
   * The empty sandbox is the whole guard against the tablet being walked out of
   * the app: no script, no form, no pop-up, no download, no navigating the app.
   * The receipt page needs none of them. An attribute that grew a permission
   * would still render and would still pass every other test here.
   */
  it('locks the page down completely and sends no referrer', () => {
    renderViewer()

    const frame = screen.getByTitle('Receipt for bill 27')
    expect(frame.getAttribute('sandbox')).toBe('')
    expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer')
  })

  it('says the receipt needs the internet when the tablet is offline, and shows no frame', () => {
    givenOnline(false)
    renderViewer()

    expect(screen.getByText(/needs the internet/i)).toBeVisible()
    expect(screen.queryByTitle('Receipt for bill 27')).not.toBeInTheDocument()
  })

  it('shows the receipt once the tablet comes back online', () => {
    givenOnline(false)
    renderViewer()

    act(() => {
      givenOnline(true)
      window.dispatchEvent(new Event('online'))
    })

    expect(screen.getByTitle('Receipt for bill 27')).toBeInTheDocument()
    expect(screen.queryByText(/needs the internet/i)).not.toBeInTheDocument()
  })

  it('carries the demo note for a demonstration bill, and frames it all the same', () => {
    renderViewer(DEMO)

    expect(screen.getByTitle('Receipt for bill 27')).toHaveAttribute('src', DEMO)
    expect(screen.getByTestId('receipt-viewer-demo')).toHaveTextContent(/will not open a receipt/i)
  })

  it('says nothing of the sort for a real bill', () => {
    renderViewer()
    expect(screen.queryByTestId('receipt-viewer-demo')).not.toBeInTheDocument()
  })

  it('closes from its own button', async () => {
    const user = userEvent.setup()
    const onClose = renderViewer()

    await user.click(screen.getByRole('button', { name: 'Close' }))

    expect(onClose).toHaveBeenCalled()
  })
})
