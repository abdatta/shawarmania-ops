import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { BillReceiptShare } from './bill-receipt-share'

const URL = 'https://shawarmania.in/bill/Ab3-_x9QzT'

/**
 * The three device paths, which is the whole point of this control.
 *
 * jsdom provides neither `navigator.share` nor a working `navigator.clipboard`,
 * so each case is set up explicitly rather than inferred from the environment.
 * They are defined rather than assigned because both properties are read-only
 * getters on the real object.
 */
function givenDevice(device: { share?: unknown; clipboard?: unknown }) {
  for (const key of ['share', 'clipboard'] as const) {
    Object.defineProperty(window.navigator, key, {
      configurable: true,
      value: device[key],
    })
  }
}

afterEach(() => {
  givenDevice({})
  vi.restoreAllMocks()
})

describe('sharing a receipt link', () => {
  it('uses the device share sheet where there is one, carrying the link', async () => {
    const user = userEvent.setup()
    const share = vi.fn().mockResolvedValue(undefined)
    givenDevice({ share })

    render(<BillReceiptShare receiptUrl={URL} billNumber={42} />)
    await user.click(screen.getByRole('button', { name: /share receipt/i }))

    expect(share).toHaveBeenCalledWith(expect.objectContaining({ url: URL, title: 'Bill 42' }))
    // The sheet is the whole interaction: nothing is copied and no link is
    // revealed behind it.
    expect(screen.queryByTestId('receipt-link')).not.toBeInTheDocument()
    expect(screen.queryByText('Link copied.')).not.toBeInTheDocument()
  })

  it('does not fall through to the clipboard when the sheet is dismissed', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    givenDevice({
      share: vi.fn().mockRejectedValue(new Error('AbortError')),
      clipboard: { writeText },
    })

    render(<BillReceiptShare receiptUrl={URL} billNumber={42} />)
    await user.click(screen.getByRole('button', { name: /share receipt/i }))

    // Dismissing a share sheet is a decision, not a failure. Copying instead
    // would put a customer's receipt on the clipboard of somebody who had just
    // changed their mind.
    expect(writeText).not.toHaveBeenCalled()
    expect(screen.queryByText('Link copied.')).not.toBeInTheDocument()
  })

  it('copies to the clipboard where there is no share sheet, and says so', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    givenDevice({ clipboard: { writeText } })

    render(<BillReceiptShare receiptUrl={URL} billNumber={42} />)
    await user.click(screen.getByRole('button', { name: /share receipt/i }))

    expect(writeText).toHaveBeenCalledWith(URL)
    expect(screen.getByRole('button', { name: /copied/i })).toBeVisible()
    expect(screen.getByText('Link copied.')).toBeVisible()
    expect(screen.queryByTestId('receipt-link')).not.toBeInTheDocument()
  })

  /*
   * The case the repo has already paid for once, in `account-handover.tsx`:
   * clipboard access is unavailable on an ordinary HTTP tablet, and a control
   * claiming `Copied` there sends somebody to paste nothing.
   */
  it('shows the link as selectable text where neither is available, claiming nothing', async () => {
    const user = userEvent.setup()
    givenDevice({})

    render(<BillReceiptShare receiptUrl={URL} billNumber={42} />)
    await user.click(screen.getByRole('button', { name: /share receipt/i }))

    expect(screen.getByTestId('receipt-link')).toHaveTextContent(URL)
    expect(screen.queryByText('Link copied.')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /copied/i })).not.toBeInTheDocument()
  })

  it('claims nothing when the clipboard is present but refuses the write', async () => {
    const user = userEvent.setup()
    givenDevice({ clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } })

    render(<BillReceiptShare receiptUrl={URL} billNumber={42} />)
    await user.click(screen.getByRole('button', { name: /share receipt/i }))

    expect(screen.getByTestId('receipt-link')).toHaveTextContent(URL)
    expect(screen.queryByText('Link copied.')).not.toBeInTheDocument()
  })
})

describe('a demonstration link', () => {
  const DEMO = 'https://shawarmania.in/bill/demo~26'

  /*
   * A demo token is built never to resolve, so a demonstration over fabricated
   * data can never hand out a URL that reaches a real bill. That is right, and
   * it used to mean the owner got a dead link with nothing saying so.
   */
  it('says it will not open', () => {
    render(<BillReceiptShare receiptUrl={DEMO} billNumber={26} />)
    expect(screen.getByTestId('receipt-link-demo')).toHaveTextContent(/will not open a receipt/i)
  })

  it('still shares, so the whole story can be walked in a demonstration', async () => {
    const user = userEvent.setup()
    const share = vi.fn().mockResolvedValue(undefined)
    givenDevice({ share })

    render(<BillReceiptShare receiptUrl={DEMO} billNumber={26} />)
    await user.click(screen.getByRole('button', { name: /share receipt/i }))

    expect(share).toHaveBeenCalledWith(expect.objectContaining({ url: DEMO }))
  })

  it('says nothing of the sort for a real link', () => {
    render(<BillReceiptShare receiptUrl={URL} billNumber={42} />)
    expect(screen.queryByTestId('receipt-link-demo')).not.toBeInTheDocument()
  })
})
