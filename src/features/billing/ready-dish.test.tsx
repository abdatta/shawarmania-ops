import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { ReadyDish } from './ready-dish'

const line = {
  menuItemId: 'dish',
  itemName: 'Shawarma',
  unitPricePaise: 10000,
  quantity: 2,
  preparedQuantity: 0,
}

it('fills a Ready dish orange, keeps its checkbox gray, and clears on handover', () => {
  const tick = vi.fn()
  const { rerender } = render(<ReadyDish line={line} readyQuantity={2} interactive onTick={tick} />)
  const row = screen.getByRole('button', { name: 'Tick 2 Shawarma' })
  expect(row).toHaveClass('dish-ready-fill')
  expect(row.closest('li')).toHaveAttribute('data-ready', 'true')
  expect(screen.getByTestId('dish-checkbox')).toHaveClass('border-content-muted', 'bg-surface')

  rerender(<ReadyDish line={line} readyQuantity={0} interactive onTick={tick} />)
  expect(row).not.toHaveClass('dish-ready-fill')
  expect(row).toHaveClass('text-content')
  expect(screen.getByTestId('dish-checkbox')).not.toHaveClass('bg-surface')

  rerender(
    <ReadyDish
      line={{ ...line, preparedQuantity: 2 }}
      readyQuantity={2}
      interactive
      onTick={tick}
    />,
  )
  expect(screen.getByRole('button', { name: 'Untick 2 Shawarma' })).toBe(row)
  expect(row).not.toHaveClass('dish-ready-fill')
  expect(row).toHaveClass('text-primary')
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
