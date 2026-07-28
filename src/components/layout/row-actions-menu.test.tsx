import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { RowActionsMenu } from './row-actions-menu'

describe('RowActionsMenu', () => {
  it('keeps its actions hidden behind the trigger until opened', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()

    render(
      <RowActionsMenu
        label="Actions for Demo Person"
        actions={[{ label: 'New code', onSelect }]}
      />,
    )

    expect(screen.queryByRole('button', { name: 'New code' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Actions for Demo Person' }))
    await user.click(screen.getByRole('button', { name: 'New code' }))

    expect(onSelect).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: 'New code' })).not.toBeInTheDocument()
  })

  it('closes on Escape and returns focus to the trigger', async () => {
    const user = userEvent.setup()

    render(<RowActionsMenu label="Actions for Demo Person" actions={[{ label: 'Edit', onSelect: () => {} }]} />)

    const trigger = screen.getByRole('button', { name: 'Actions for Demo Person' })
    await user.click(trigger)
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('disables an action without dropping it from the menu', async () => {
    const user = userEvent.setup()

    render(
      <RowActionsMenu
        label="Actions for Demo Person"
        actions={[{ label: 'Deactivate', onSelect: () => {}, disabled: true }]}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Actions for Demo Person' }))
    expect(screen.getByRole('button', { name: 'Deactivate' })).toBeDisabled()
  })
})
