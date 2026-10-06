import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { MenuCategoryWithItems } from '@/data-access/adapters'
import type { Tables } from '@/data-access/database.types'

import { MenuGrid } from './menu-grid'

const CREATED_AT = '2026-10-06T00:00:00+00:00'

function item(
  id: string,
  categoryId: string,
  name: string,
  available = true,
): Tables<'menu_items'> {
  return {
    id,
    outlet_id: 'o',
    category_id: categoryId,
    name,
    description: null,
    price_paise: 10_000,
    is_veg: false,
    is_available: available,
    is_active: true,
    sort_order: 1,
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
  }
}

const MENU: MenuCategoryWithItems[] = [
  {
    category: { id: 'c1', outlet_id: 'o', name: 'Shawarmas', sort_order: 1, is_active: true },
    items: [
      item('classic', 'c1', 'Classic Chicken Shawarma'),
      item('cheese', 'c1', 'Cheese Chicken Shawarma'),
      item('lebanese', 'c1', 'Lebanese Chicken Shawarma', false),
    ],
  },
  {
    category: { id: 'c2', outlet_id: 'o', name: 'Burgers', sort_order: 2, is_active: true },
    items: [item('nashville', 'c2', 'Nashville Chicken Burger')],
  },
]

function renderGrid(extra?: ReactNode) {
  const onAdd = vi.fn()
  render(
    <>
      <MenuGrid menu={MENU} quantities={new Map()} onAdd={onAdd} />
      {extra}
    </>,
  )
  return { onAdd, search: screen.getByRole('textbox', { name: 'Search the menu' }) }
}

const tiles = () => screen.getAllByTestId(/^tile-(?!count)/).map((tile) => tile.dataset['testid'])

describe('MenuGrid search', () => {
  it('narrows the grid to every typed word, hiding empty categories', async () => {
    const { search } = renderGrid()
    expect(tiles()).toHaveLength(4)

    await userEvent.type(search, 'chee chi')
    expect(tiles()).toEqual(['tile-cheese'])
    expect(screen.queryByRole('region', { name: 'Burgers' })).not.toBeInTheDocument()
  })

  it('says when nothing matches', async () => {
    const { search } = renderGrid()
    await userEvent.type(search, 'pizza')
    expect(screen.getByTestId('menu-search-empty')).toHaveTextContent('No item matches “pizza”.')
    expect(screen.queryAllByTestId(/^tile-/)).toHaveLength(0)
  })

  it('keeps a matching unavailable item unsellable', async () => {
    const { search, onAdd } = renderGrid()
    await userEvent.type(search, 'lebanese')
    expect(screen.getByTestId('tile-lebanese')).toBeDisabled()
    await userEvent.click(screen.getByTestId('tile-lebanese'))
    expect(onAdd).not.toHaveBeenCalled()
  })

  it('outlives a tap on a tile', async () => {
    const { search, onAdd } = renderGrid()
    await userEvent.type(search, 'chicken shawarma')
    await userEvent.click(screen.getByTestId('tile-classic'))
    await userEvent.click(screen.getByTestId('tile-classic'))

    expect(onAdd).toHaveBeenCalledTimes(2)
    expect(search).toHaveValue('chicken shawarma')
    expect(tiles()).toEqual(['tile-classic', 'tile-cheese', 'tile-lebanese'])
  })

  it('shows its clear control only once something is typed, and clearing drops the cursor', async () => {
    const { search } = renderGrid()
    expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument()

    await userEvent.type(search, 'burger')
    // A bare click, which leaves focus where it was: iOS Safari does not focus a
    // tapped button, so without the blur the field would keep the cursor and
    // the touch keyboard would stay up over the restored grid.
    expect(search).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))

    expect(search).toHaveValue('')
    expect(search).not.toHaveFocus()
    expect(tiles()).toHaveLength(4)
    expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument()
  })

  it('clears on Escape from the field, dropping the cursor', async () => {
    const { search } = renderGrid()
    await userEvent.type(search, 'burger')
    await userEvent.keyboard('{Escape}')
    expect(search).toHaveValue('')
    expect(search).not.toHaveFocus()
  })

  it('clears on Escape after a tap has taken focus to a tile', async () => {
    const { search } = renderGrid()
    await userEvent.type(search, 'burger')
    await userEvent.click(screen.getByTestId('tile-nashville'))
    expect(search).not.toHaveFocus()

    await userEvent.keyboard('{Escape}')
    expect(search).toHaveValue('')
  })

  it('leaves Escape to an open dialog', async () => {
    const { search } = renderGrid(<dialog open>Payment</dialog>)
    await userEvent.type(search, 'burger')
    await userEvent.keyboard('{Escape}')
    expect(search).toHaveValue('burger')
  })

  it('leaves Escape to an open account menu', async () => {
    const { search } = renderGrid(
      <details open>
        <summary>Account</summary>
      </details>,
    )
    await userEvent.type(search, 'burger')
    await userEvent.keyboard('{Escape}')
    expect(search).toHaveValue('burger')
  })

  it('leaves Escape to a pipeline card actions menu', async () => {
    const { search } = renderGrid(<div role="menu" aria-label="More actions" />)
    await userEvent.type(search, 'burger')
    await userEvent.keyboard('{Escape}')
    expect(search).toHaveValue('burger')
  })

  it('leaves Escape in another text field to that field', async () => {
    const { search } = renderGrid(<input aria-label="Reason to discard" />)
    await userEvent.type(search, 'burger')
    await userEvent.click(screen.getByRole('textbox', { name: 'Reason to discard' }))
    await userEvent.keyboard('{Escape}')
    expect(search).toHaveValue('burger')
  })

  it('ignores Escape with a modifier', async () => {
    const { search } = renderGrid()
    await userEvent.type(search, 'burger')
    await userEvent.keyboard('{Shift>}{Escape}{/Shift}')
    expect(search).toHaveValue('burger')
  })
})
