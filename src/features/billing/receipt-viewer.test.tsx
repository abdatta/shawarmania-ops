import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ReceiptViewer } from './receipt-viewer'

const URL = 'https://shawarmania.in/bill?t=Ab3-_x9QzT'
const DEMO = 'https://shawarmania.in/bill?t=demo~26'

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
  /*
   * `?view=counter` asks the receipt page to leave out Download PDF, a dead
   * control inside this sandbox (the site's the-counter-views-the-receipt).
   * Until the site is deployed it ignores the parameter, so neither side can
   * break the other.
   */
  it('shows the bill’s own receipt page inside the app, in the counter’s view', () => {
    renderViewer()

    const frame = screen.getByTitle('Receipt for bill 27')
    expect(frame.tagName).toBe('IFRAME')
    expect(frame).toHaveAttribute('src', `${URL}&view=counter`)
  })

  it('shows a spinner until the receipt has loaded, then only the receipt', () => {
    renderViewer()

    expect(screen.getByRole('status')).toHaveTextContent('Loading receipt…')

    fireEvent.load(screen.getByTitle('Receipt for bill 27'))

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('spins again when the tablet comes back online and the receipt reloads', () => {
    renderViewer()
    fireEvent.load(screen.getByTitle('Receipt for bill 27'))

    act(() => {
      givenOnline(false)
      window.dispatchEvent(new Event('offline'))
    })
    act(() => {
      givenOnline(true)
      window.dispatchEvent(new Event('online'))
    })

    expect(screen.getByRole('status')).toHaveTextContent('Loading receipt…')
  })

  /*
   * The sandbox is the guard against the tablet being walked out of the app. It
   * permits scripts, which the counter view needs to report its height, and
   * nothing else: no same-origin access, no form, no pop-up, no download, no
   * navigating the app. A token that crept in would still render and would still
   * pass every other test here, so the whole attribute is pinned.
   */
  it('permits the page scripts and nothing else, and sends no referrer', () => {
    renderViewer()

    const frame = screen.getByTitle('Receipt for bill 27')
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
    expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer')
  })

  /*
   * The pop-up cannot measure a page on another origin, so the counter view of
   * the receipt reports its own height (the site's the-counter-views-the-receipt).
   * The pop-up grows to it, up to its own ceiling, and scrolls beyond that.
   */
  it('grows the frame to the height the receipt reports', () => {
    renderViewer()
    const frame = screen.getByTitle('Receipt for bill 27') as HTMLIFrameElement

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'shawarmania-receipt-height', height: 1234 },
          source: frame.contentWindow,
        }),
      )
    })

    expect(frame.style.height).toBe('1234px')
  })

  it('ignores a height from anything but its own frame, and anything that is not one', () => {
    renderViewer()
    const frame = screen.getByTitle('Receipt for bill 27') as HTMLIFrameElement
    const before = frame.style.height

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'shawarmania-receipt-height', height: 900 },
          source: window,
        }),
      )
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'shawarmania-receipt-height', height: 'tall' },
          source: frame.contentWindow,
        }),
      )
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'something-else', height: 900 },
          source: frame.contentWindow,
        }),
      )
    })

    expect(frame.style.height).toBe(before)
  })

  /*
   * Until the site knows `?view=counter`, or wherever a report never comes, the
   * frame keeps a fixed fallback height rather than collapsing to nothing.
   */
  it('keeps a fallback height until a report arrives', () => {
    renderViewer()
    const frame = screen.getByTitle('Receipt for bill 27') as HTMLIFrameElement

    expect(frame.style.height).not.toBe('')
    expect(frame.style.height).not.toBe('0px')
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

    // Read as a URL rather than compared as a string: re-serialising the query
    // percent-encodes the demo token's `~`, which a real token never carries.
    const src = new globalThis.URL(
      screen.getByTitle('Receipt for bill 27').getAttribute('src') ?? '',
    )
    expect(src.origin + src.pathname).toBe('https://shawarmania.in/bill')
    expect(src.searchParams.get('t')).toBe('demo~26')
    expect(src.searchParams.get('view')).toBe('counter')
    expect(screen.getByTestId('receipt-viewer-demo')).toHaveTextContent(/will not open a receipt/i)
  })

  it('says nothing of the sort for a real bill', () => {
    renderViewer()
    expect(screen.queryByTestId('receipt-viewer-demo')).not.toBeInTheDocument()
  })

  /*
   * The tablet is turned to a customer, and behind the pop-up sit other
   * customers' names, orders and totals. The blur is the only thing keeping
   * them unreadable, so it is pinned rather than left to a class list someone
   * tidies away [owner, 2026-09-30].
   */
  it('blurs the counter behind it, so nothing there can be read', () => {
    renderViewer()

    const dialog = screen.getByRole('dialog', { name: 'Receipt for bill 27' })
    expect(dialog.className).toMatch(/backdrop:backdrop-blur-/)
  })

  it('closes from its own button', async () => {
    const user = userEvent.setup()
    const onClose = renderViewer()

    await user.click(screen.getByRole('button', { name: 'Close' }))

    expect(onClose).toHaveBeenCalled()
  })
})
