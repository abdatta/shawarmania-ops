import { render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { captureCardFlight, flyCapturedCardToDestination, useFlip } from './flip'

const ticketId = 'order-1'
let originalAnimate: PropertyDescriptor | undefined
let originalRect: PropertyDescriptor | undefined

function rectFor(element: HTMLElement): DOMRect {
  // Where a card sits in the one list: the second slot is one card lower than
  // the first, and a card that merely records a fact does not change slot.
  const top = element.closest<HTMLElement>('li')?.dataset.slot === 'second' ? 144 : 16
  return {
    bottom: top + 96,
    height: 96,
    left: 16,
    right: 296,
    top,
    width: 280,
    x: 16,
    y: top,
    toJSON: () => ({}),
  } as DOMRect
}

/**
 * The pipeline as it is now: one list, in which recording a fact changes the
 * card's colours and its slot not at all.
 */
function PipelineHarness({ prepared }: { prepared: boolean }) {
  const rootRef = useRef<HTMLElement>(null)
  useFlip(rootRef, [prepared])

  return (
    <section ref={rootRef}>
      <ul>
        <li data-slot="first">
          <article data-flip-id={ticketId} data-testid="moving-ticket" data-prepared={prepared}>
            Ticket
          </article>
        </li>
        <li data-slot="second">
          <article data-flip-id="order-2">Another ticket</article>
        </li>
      </ul>
    </section>
  )
}

function ArrivalHarness({ arrived }: { arrived: boolean }) {
  const rootRef = useRef<HTMLElement>(null)
  useFlip(rootRef, [arrived])

  return (
    <section ref={rootRef}>
      <ul>
        {arrived && (
          <li data-slot="first">
            <article data-flip-id={ticketId} data-testid="arriving-ticket">
              Ticket
            </article>
          </li>
        )}
      </ul>
    </section>
  )
}

beforeEach(() => {
  originalAnimate = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'animate')
  originalRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect')
  Object.defineProperty(HTMLElement.prototype, 'animate', {
    configurable: true,
    value: vi.fn(
      () =>
        ({
          cancel: vi.fn(),
          // Keep the flight in progress so the test can inspect its one visible
          // travelling card and the destination reservation.
          finished: new Promise<void>(() => undefined),
        }) as unknown as Animation,
    ),
  })
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: function getBoundingClientRect(this: HTMLElement) {
      return rectFor(this)
    },
  })
})

afterEach(() => {
  if (originalAnimate) Object.defineProperty(HTMLElement.prototype, 'animate', originalAnimate)
  else delete (HTMLElement.prototype as Partial<HTMLElement>).animate
  if (originalRect)
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalRect)
})

describe('useFlip', () => {
  it('animates nothing at all when a ticket merely records one of its two facts', () => {
    const view = render(<PipelineHarness prepared={false} />)

    view.rerender(<PipelineHarness prepared />)

    /*
      The whole of #55's rail, in one assertion: with no sections there is
      nowhere for a card to go, so the hook measures no movement and plays
      nothing. If this ever animates, the list is reordering itself and the
      card the biller was looking at has moved under their eye.
    */
    expect(HTMLElement.prototype.animate).not.toHaveBeenCalled()
    expect(document.body.querySelector('[data-flip-ghost]')).toBeNull()
    expect(view.container.querySelector('[data-flip-placeholder]')).toBeNull()
    expect(screen.getByTestId('moving-ticket')).toBeVisible()
  })

  it('does not replay existing-ticket motion when a newly ordered ticket arrives', () => {
    const view = render(<ArrivalHarness arrived={false} />)

    view.rerender(<ArrivalHarness arrived />)

    expect(screen.getByTestId('arriving-ticket')).toBeVisible()
    expect(HTMLElement.prototype.animate).not.toHaveBeenCalled()
    expect(document.body.querySelector('[data-flip-ghost]')).toBeNull()
  })

  it('carries the full ticket into a newly created bill row after payment', () => {
    const source = document.createElement('article')
    source.dataset.flipId = ticketId
    source.textContent = 'Order #' + '104 · ₹278'

    const billRow = document.createElement('li')
    billRow.dataset.slot = 'second'
    const destination = document.createElement('details')
    billRow.appendChild(destination)
    document.body.append(source, billRow)

    const flight = captureCardFlight(source)
    source.remove()
    flyCapturedCardToDestination(flight, destination)

    expect(destination).toHaveStyle({ opacity: '0' })
    expect(billRow.querySelector('[data-flip-placeholder]')).not.toBeNull()
    expect(document.body.querySelector('[data-flip-ghost]')).toHaveTextContent(
      'Order #' + '104 · ₹278',
    )

    billRow.remove()
    document.body.querySelector('[data-flip-ghost]')?.remove()
  })
})
