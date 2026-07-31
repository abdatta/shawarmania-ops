import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Badge, BadgeDot } from './badge'

/**
 * The two things a badge has to get right are that zero is invisible and that
 * the meaning survives not being looked at. Everything else here is width.
 */
describe('Badge', () => {
  it('renders nothing at zero, so an absent badge always means nothing is waiting', () => {
    const { container } = render(<Badge count={0} label="No arrivals waiting" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing for a negative count rather than showing a minus sign', () => {
    const { container } = render(<Badge count={-3} label="Nonsense" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('states the number when work is waiting', () => {
    render(<Badge count={3} label="3 arrivals waiting for approval" />)
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('caps at 99+ rather than widening out of the entry it sits on', () => {
    render(<Badge count={140} label="140 arrivals waiting for approval" />)
    expect(screen.getByText('99+')).toBeInTheDocument()
    expect(screen.queryByText('140')).not.toBeInTheDocument()
  })

  it('shows the exact number at the ceiling itself', () => {
    render(<Badge count={99} label="99 arrivals waiting for approval" />)
    expect(screen.getByText('99')).toBeInTheDocument()
  })

  it('is read as a sentence, not as a bare number', () => {
    render(<Badge count={3} label="3 arrivals waiting for approval" />)
    expect(screen.getByText('3 arrivals waiting for approval')).toBeInTheDocument()
    // The digits themselves are decoration for anyone reading with their ears.
    expect(screen.getByText('3')).toHaveAttribute('aria-hidden')
  })

  it('takes its colour from the primary pair, the one the Approve button uses', () => {
    const { container } = render(<Badge count={1} label="1 arrival waiting for approval" />)
    const badge = container.firstElementChild
    expect(badge?.getAttribute('class')).toContain('bg-primary')
    expect(badge?.getAttribute('class')).toContain('text-on-primary')
  })

  it('requires an accessible name rather than treating it as optional', () => {
    // @ts-expect-error `label` is required: a badge with no name is colour-only.
    render(<Badge count={1} />)
  })
})

describe('BadgeDot', () => {
  it('says what it means even with no number on it', () => {
    render(<BadgeDot label="Earlier days hold arrivals waiting for approval" />)
    expect(screen.getByText('Earlier days hold arrivals waiting for approval')).toBeInTheDocument()
  })

  it('uses the same colour pair as the counted badge', () => {
    const { container } = render(<BadgeDot label="Work waiting" />)
    expect(container.firstElementChild?.getAttribute('class')).toContain('bg-primary')
    expect(container.firstElementChild?.getAttribute('class')).toContain('text-on-primary')
  })

  it('requires an accessible name too', () => {
    // @ts-expect-error `label` is required on the bare dot as well.
    render(<BadgeDot />)
  })
})
