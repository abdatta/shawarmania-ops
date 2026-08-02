import { render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import {
  LoadingBlock,
  LoadingFigures,
  LoadingList,
  LoadingRegion,
  LoadingTable,
  Shimmer,
} from './loading'

/**
 * The placeholder's job is not to look busy. It is to reserve the space, say so
 * to a reader who cannot see it, and survive a reduced-motion preference — and
 * those are the three things asserted here.
 *
 * Every exported shape is held to all three, not just the two that existed
 * first, because the contract is what makes them interchangeable: a surface
 * picking the shape that matches its layout must not be picking a weaker
 * announcement along with it.
 */

/** Each named shape, as a surface would render it. */
const SHAPES = [
  { name: 'LoadingList', element: <LoadingList label="attendance for this day" /> },
  { name: 'LoadingBlock', element: <LoadingBlock label="attendance for this day" /> },
  { name: 'LoadingTable', element: <LoadingTable label="attendance for this day" /> },
  { name: 'LoadingFigures', element: <LoadingFigures label="attendance for this day" /> },
  {
    name: 'LoadingRegion',
    element: (
      <LoadingRegion label="attendance for this day">
        <Shimmer className="h-24" />
      </LoadingRegion>
    ),
  },
] as const

describe('loading placeholders', () => {
  describe.each(SHAPES)('$name', ({ element }) => {
    it('announces a busy region naming what is loading', () => {
      render(element)

      const region = screen.getByRole('status')
      expect(region).toHaveAttribute('aria-busy', 'true')
      expect(region).toHaveAttribute('aria-live', 'polite')
      expect(region).toHaveTextContent('Loading attendance for this day…')
    })

    it('does not rely on motion alone: blocks with reserved height remain without it', () => {
      const { container } = render(element)

      // The animation is switched off under prefers-reduced-motion, so what
      // must carry the wait without it is the reserved space and the
      // announcement — and both are independent of it: every block carries a
      // height class that is not the animation.
      const blocks = container.querySelectorAll('[aria-hidden]')
      expect(blocks.length).toBeGreaterThan(0)
      for (const block of blocks) {
        expect(block.className).toMatch(/\bh-/)
        expect(block.className).toContain('motion-reduce:animate-none')
      }
      expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true')
    })
  })

  it('reserves one block per expected row', () => {
    const { container } = render(<LoadingList label="days" rows={5} />)

    expect(container.querySelectorAll('[aria-hidden]')).toHaveLength(5)
  })

  it('lets a stack of short cards reserve a short card’s height', () => {
    const { container } = render(<LoadingList label="figures" rows={2} blockHeight="h-16" />)

    for (const block of container.querySelectorAll('[aria-hidden]')) {
      expect(block.className).toContain('h-16')
    }
  })

  it('reserves one strip per table row, and no odd strip for the header', () => {
    const { container } = render(<LoadingTable label="the comparison" rows={3} />)

    // A table waits behind rows, not behind cards — and behind an even stack of
    // them. A short header strip above taller rows reads as a mistake rather
    // than as a heading, which is the opposite of what a placeholder is for.
    expect(container.querySelectorAll('[aria-hidden]')).toHaveLength(3)
  })

  it('reserves a table row at the height its rows actually render', () => {
    // The density token is a minimum: a phone table with wordy columns wraps
    // past it, so the caller says what its rows really take.
    const { container } = render(<LoadingTable label="people" rows={1} rowHeight="h-16" />)

    const blocks = [...container.querySelectorAll('[aria-hidden]')]
    expect(blocks.at(-1)?.className).toContain('h-16')
  })

  it('falls back to the phone row density when the caller says nothing', () => {
    const { container } = render(<LoadingTable label="bills" rows={1} />)

    const blocks = [...container.querySelectorAll('[aria-hidden]')]
    expect(blocks.at(-1)?.className).toContain('h-[var(--size-row-phone)]')
  })

  it('reserves one strip per figure row', () => {
    const { container } = render(<LoadingFigures label="today’s cash" rows={5} />)

    expect(container.querySelectorAll('[aria-hidden]')).toHaveLength(5)
  })

  it('reserves a stack of cards when the surface waits behind more than one', () => {
    // P&L, reports and cash each wait behind several cards, so a single-card
    // placeholder would under-reserve by whole cards.
    const { container } = render(<LoadingFigures label="the period" rows={[3, 2, 4]} />)

    expect(container.querySelectorAll('[aria-hidden]')).toHaveLength(9)
  })

  it('applies the caller’s layout classes, which is what makes composition copy the page', () => {
    // A surface reproduces its own shape by passing the container classes its
    // loaded content uses. If the region dropped them, every composed
    // placeholder would silently collapse to a different layout.
    render(
      <LoadingRegion label="the counter" className="grid grid-cols-2 gap-3" data-testid="composed">
        <Shimmer className="h-24" />
      </LoadingRegion>,
    )

    const region = screen.getByTestId('composed')
    expect(region.className).toContain('grid-cols-2')
    expect(region.className).toContain('gap-3')
  })

  it('keeps the caller’s classes alongside a named shape’s own layout', () => {
    render(<LoadingList label="days" className="mt-4" data-testid="list" />)

    const region = screen.getByTestId('list')
    expect(region.className).toContain('space-y-3')
    expect(region.className).toContain('mt-4')
  })

  it('carries no hex literal, so both themes come from the tokens', () => {
    const source = readFileSync('src/components/ui/loading.tsx', 'utf8')

    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    // Semantic tokens rather than palette values: the same two the cards it
    // stands in for are built from, so it reads correctly in either theme.
    expect(source).toContain('border-border')
    expect(source).toContain('bg-surface-raised')
  })
})
