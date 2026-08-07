import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import { CategoryInput } from './category-input'

function Example() {
  const [value, setValue] = useState('')
  return (
    <CategoryInput
      id="category"
      label="Expense category"
      value={value}
      suggestions={['Chicken', 'Hyperpure', 'Staff Food']}
      onChange={setValue}
    />
  )
}

describe('CategoryInput', () => {
  it('suggests on focus and filters case-insensitively while preserving free text', async () => {
    render(<Example />)
    const input = screen.getByRole('combobox', { name: 'Expense category' })

    await userEvent.click(input)
    expect(screen.getByRole('option', { name: 'Chicken' })).toBeVisible()
    await userEvent.type(input, 'STAFF')
    expect(screen.getByRole('option', { name: 'Staff Food' })).toBeVisible()
    expect(screen.queryByRole('option', { name: 'Chicken' })).not.toBeInTheDocument()

    await userEvent.clear(input)
    await userEvent.type(input, 'Travel')
    expect(input).toHaveValue('Travel')
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
  })

  it('is reachable and dismissable from the keyboard', async () => {
    render(<Example />)
    const input = screen.getByRole('combobox', { name: 'Expense category' })
    await userEvent.click(input)
    await userEvent.keyboard('{ArrowDown}{Enter}')
    expect(input).toHaveValue('Chicken')
    expect(input).toHaveAttribute('aria-expanded', 'false')

    await userEvent.click(input)
    await userEvent.keyboard('{Escape}')
    expect(input).toHaveAttribute('aria-expanded', 'false')
  })

  it('carries no font-size class, so the base layer keeps it at 16px', () => {
    // A utility class beats the `input { font-size: 1.143rem }` rule in
    // `index.css`, and `text-base` resolves to 14px at this root — which is
    // exactly the size that makes iOS Safari zoom the viewport on focus.
    render(<Example />)
    const input = screen.getByRole('combobox', { name: 'Expense category' })
    expect([...input.classList].filter((name) => name.startsWith('text-['))).toEqual([])
    expect(input.className).not.toMatch(/\btext-(xs|sm|base|lg|xl)\b/)
  })

  it('warns about double counting without blocking the value', async () => {
    render(<Example />)
    const input = screen.getByRole('combobox', { name: 'Expense category' })
    await userEvent.type(input, 'Aggregator commission')

    expect(screen.getByRole('status')).toHaveTextContent(/netted from aggregator revenue/i)
    expect(input).toHaveValue('Aggregator commission')
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss category warning' }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(input).toHaveValue('Aggregator commission')
  })
})
