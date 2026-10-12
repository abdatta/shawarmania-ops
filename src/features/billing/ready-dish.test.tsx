import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { ReadyDish } from './ready-dish'

it('shows a third checkbox state for Ready, keeping text still and clearing the cue on handover', () => {
  const tick = vi.fn()
  const line = {
    menuItemId: 'dish',
    itemName: 'Shawarma',
    unitPricePaise: 10000,
    quantity: 2,
    preparedQuantity: 0,
  }
  const { rerender } = render(<ReadyDish line={line} readyQuantity={2} interactive onTick={tick} />)
  const first = screen.getByRole('button', { name: 'Tick 2 Shawarma' })
  expect(first).toHaveClass('text-content')
  expect(screen.getByTestId('dish-ready-cue')).toHaveAttribute('data-cue', 'pulse-dot')
  expect(screen.getByTestId('dish-ready-cue')).toHaveClass('ready-dot-pulse')
  expect(screen.getByTestId('dish-checkbox')).toHaveClass('border-primary')
  expect(screen.getByTestId('dish-quantity').parentElement).toHaveClass('border-transparent')
  rerender(<ReadyDish line={line} readyQuantity={0} interactive onTick={tick} />)
  expect(screen.queryByTestId('dish-ready-cue')).toBeNull()
  expect(screen.getByTestId('dish-checkbox')).toHaveClass('border-content-muted')
  for (const cue of ['halo', 'steady-dot'] as const) {
    rerender(<ReadyDish line={line} readyQuantity={2} interactive onTick={tick} cue={cue} />)
    expect(screen.getByTestId('dish-ready-cue')).toHaveAttribute('data-cue', cue)
    expect(screen.getByTestId('dish-checkbox')).toHaveClass('border-primary')
  }
  rerender(
    <ReadyDish
      line={{ ...line, preparedQuantity: 2 }}
      readyQuantity={2}
      interactive
      onTick={tick}
    />,
  )
  expect(screen.queryByTestId('dish-ready-cue')).toBeNull()
  expect(screen.getByRole('button', { name: 'Untick 2 Shawarma' })).toBe(first)
  expect(first).toHaveClass('text-primary')
  expect(screen.getByTestId('dish-quantity')).toHaveTextContent('2')
  expect(screen.getByTestId('dish-checkbox').querySelector('svg')).not.toBeNull()
  expect(document.querySelector('audio')).toBeNull()
})
it('ticks one dish rather than the whole order', async () => {
  const tick = vi.fn()
  render(
    <ReadyDish
      line={{
        menuItemId: 'dish',
        itemName: 'Shawarma',
        unitPricePaise: 10000,
        quantity: 1,
        note: 'No sauce',
      }}
      readyQuantity={0}
      interactive
      onTick={tick}
    />,
  )
  await userEvent.click(screen.getByRole('button', { name: 'Tick 1 Shawarma, No sauce' }))
  expect(tick).toHaveBeenCalledOnce()
})
