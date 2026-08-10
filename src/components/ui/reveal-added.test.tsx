import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { RevealAdded } from './reveal-added'

describe('RevealAdded', () => {
  const scrollIntoView = vi.fn()

  beforeEach(() => {
    scrollIntoView.mockClear()
    Element.prototype.scrollIntoView = scrollIntoView
  })

  it('scrolls new work into view and identifies it briefly', () => {
    render(
      <RevealAdded active data-testid="new-row">
        New row
      </RevealAdded>,
    )
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
    expect(screen.getByTestId('new-row')).toHaveClass('ring-primary')
  })

  it('keeps the orientation scroll but suppresses highlight under reduced motion', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList)
    render(
      <RevealAdded active data-testid="new-row">
        New row
      </RevealAdded>,
    )
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
    expect(screen.getByTestId('new-row')).not.toHaveClass('ring-primary')
  })
})
