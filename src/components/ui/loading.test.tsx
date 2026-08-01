import { render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { LoadingBlock, LoadingList } from './loading'

/**
 * The placeholder's job is not to look busy. It is to reserve the space, say so
 * to a reader who cannot see it, and survive a reduced-motion preference — and
 * those are the three things asserted here.
 */
describe('loading placeholders', () => {
  it('announces a busy region naming what is loading', () => {
    render(<LoadingList label="attendance for this day" />)

    const region = screen.getByRole('status')
    expect(region).toHaveAttribute('aria-busy', 'true')
    expect(region).toHaveTextContent('Loading attendance for this day…')
  })

  it('reserves one block per expected row', () => {
    const { container } = render(<LoadingList label="days" rows={5} />)

    expect(container.querySelectorAll('[aria-hidden]')).toHaveLength(5)
  })

  it('names what a single block is waiting for too', () => {
    render(<LoadingBlock label="the summary" />)

    expect(screen.getByRole('status')).toHaveTextContent('Loading the summary…')
  })

  it('carries no hex literal, so both themes come from the tokens', () => {
    const source = readFileSync('src/components/ui/loading.tsx', 'utf8')

    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    // Semantic tokens rather than palette values: the same two the cards it
    // stands in for are built from, so it reads correctly in either theme.
    expect(source).toContain('border-border')
    expect(source).toContain('bg-surface-raised')
  })

  it('does not rely on motion alone: the blocks are there without the animation', () => {
    const { container } = render(<LoadingList label="days" rows={2} />)

    // `animate-pulse` is Tailwind's, which is disabled under
    // prefers-reduced-motion. What must remain is the reserved space and the
    // announcement, and both are independent of it.
    for (const block of container.querySelectorAll('[aria-hidden]')) {
      expect(block.className).toContain('h-24')
    }
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true')
  })
})
