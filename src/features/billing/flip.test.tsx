import { render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { captureCardFlight, flyCapturedCardToDestination, useFlip } from './flip'

const ticketId = 'order-1'
let originalAnimate: PropertyDescriptor | undefined
let originalRect: PropertyDescriptor | undefined

function rectFor(element: HTMLElement): DOMRect {
  const section = element.closest<HTMLElement>('[data-stage]')?.dataset.stage
  const top = section === 'prepared' ? 144 : 16
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

function PipelineHarness({ stage }: { stage: 'preparing' | 'prepared' }) {
  const rootRef = useRef<HTMLElement>(null)
  useFlip(rootRef, [stage])

  return (
    <section ref={rootRef}>
      <ul data-stage="preparing">
        {stage === 'preparing' && (
          <li>
            <article data-flip-id={ticketId} data-testid="moving-ticket">
              Ticket
            </article>
          </li>
        )}
      </ul>
      <ul data-stage="prepared">
        {stage === 'prepared' && (
          <li>
            <article data-flip-id={ticketId} data-testid="moving-ticket">
              Ticket
            </article>
          </li>
        )}
      </ul>
    </section>
  )
}

function ArrivalHarness({ arrived }: { arrived: boolean }) {
  const rootRef = useRef<HTMLElement>(null)
  useFlip(rootRef, [arrived])

  return (
    <section ref={rootRef}>
      <ul data-stage="preparing">
        {arrived && (
          <li>
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
  it('shows one ghost and a destination shimmer when a ticket changes pipeline sections', () => {
    const view = render(<PipelineHarness stage="preparing" />)

    view.rerender(<PipelineHarness stage="prepared" />)

    const destination = screen.getByTestId('moving-ticket')
    expect(destination).toHaveStyle({ opacity: '0' })
    expect(destination.parentElement?.querySelector('[data-flip-placeholder]')).not.toBeNull()
    expect(
      view.container.querySelector('[data-stage="preparing"] [data-flip-placeholder]'),
    ).toBeNull()
    expect(view.container.querySelector('[data-stage="preparing"] [data-flip-id]')).toBeNull()
    expect(document.body.querySelectorAll('[data-flip-ghost]')).toHaveLength(1)
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
    source.dataset.stage = 'preparing'
    source.textContent = 'Order #' + '104 · ₹278'

    const billRow = document.createElement('li')
    billRow.dataset.stage = 'prepared'
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
