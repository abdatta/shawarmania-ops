import { render } from '@testing-library/react'
import { useRef } from 'react'
import { expect, it } from 'vitest'

import { useKitchenMasonry } from './use-kitchen-masonry'

interface Card {
  key: string
  group?: string
  height: number
}

/** jsdom lays nothing out, so each card says its own height and the board its width. */
function Board({ cards }: { cards: Card[] }) {
  const grid = useRef<HTMLDivElement>(null)
  useKitchenMasonry(grid, cards.map((card) => `${card.key}:${card.height}`).join(','))
  return (
    <div
      ref={(node) => {
        grid.current = node
        // Two columns of 22rem at 16px, with the 16px gap between them.
        if (node) Object.defineProperty(node, 'clientWidth', { value: 736, configurable: true })
      }}
      data-testid="grid"
    >
      {cards.map((card) => (
        <div
          key={card.key}
          data-masonry-key={card.key}
          data-masonry-group={card.group ?? card.key}
          ref={(node) => {
            if (node)
              Object.defineProperty(node, 'offsetHeight', {
                value: card.height,
                configurable: true,
              })
          }}
        />
      ))}
    </div>
  )
}

const columnOf = (grid: HTMLElement) =>
  Object.fromEntries(
    [...grid.children].map((item) => [
      (item as HTMLElement).dataset.masonryKey,
      (item as HTMLElement).style.left === '0px' ? 0 : 1,
    ]),
  )

it('keeps every card in its column when another card changes height', () => {
  const view = render(
    <Board
      cards={[
        { key: 'a', height: 100 },
        { key: 'b', height: 300 },
        { key: 'c', height: 100 },
      ]}
    />,
  )
  const grid = view.getByTestId('grid')
  expect(columnOf(grid)).toEqual({ a: 0, b: 1, c: 0 })
  // A grows past B, as an expanded receipt or an ACK's change of shape does.
  // Dealt again into the shortest column, C would cross to B's.
  view.rerender(
    <Board
      cards={[
        { key: 'a', height: 400 },
        { key: 'b', height: 300 },
        { key: 'c', height: 100 },
      ]}
    />,
  )
  expect(columnOf(grid)).toEqual({ a: 0, b: 1, c: 0 })
  expect((grid.children[2] as HTMLElement).style.top).toBe('416px')
})

it('gives the column of a card that left to the next card of the same order', () => {
  const view = render(
    <Board
      cards={[
        { key: 'a', height: 50 },
        { key: 'b', height: 300 },
        { key: 'receipt', group: 'order-7', height: 80 },
      ]}
    />,
  )
  const grid = view.getByTestId('grid')
  expect(columnOf(grid)).toEqual({ a: 0, b: 1, receipt: 0 })
  // Undo, after the first column has grown: the second is now the shortest,
  // but the order's ticket opens where its receipt was.
  view.rerender(
    <Board
      cards={[
        { key: 'a', height: 400 },
        { key: 'b', height: 300 },
        { key: 'ticket', group: 'order-7', height: 250 },
      ]}
    />,
  )
  expect(columnOf(grid)).toEqual({ a: 0, b: 1, ticket: 0 })
})

it('slides a card already placed, but not one placing for the first time', () => {
  const view = render(<Board cards={[{ key: 'a', height: 100 }]} />)
  const grid = view.getByTestId('grid')
  expect((grid.children[0] as HTMLElement).style.transition).toBe('')
  view.rerender(
    <Board
      cards={[
        { key: 'a', height: 120 },
        { key: 'b', height: 100 },
      ]}
    />,
  )
  expect((grid.children[0] as HTMLElement).style.transition).toContain('top')
  expect((grid.children[1] as HTMLElement).style.transition).toBe('')
})
