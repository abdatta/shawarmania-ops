import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ConfirmDialog } from './confirm-dialog'

describe('ConfirmDialog', () => {
  it('states the consequence in plain words and wires both actions', async () => {
    const onConfirm = vi.fn()
    const onClose = vi.fn()
    const user = userEvent.setup()

    render(
      <ConfirmDialog
        open
        title="Void bill 142?"
        consequence="The bill stays on record as voided and stops counting towards today's sales."
        confirmLabel="Void bill"
        danger
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    )

    expect(
      screen.getByText(
        "The bill stays on record as voided and stops counting towards today's sales.",
      ),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Void bill' }))
    expect(onConfirm).toHaveBeenCalledOnce()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('renders nothing while closed', () => {
    render(
      <ConfirmDialog
        open={false}
        title="Void bill 142?"
        consequence="It stops counting."
        confirmLabel="Void bill"
        onConfirm={() => {}}
        onClose={() => {}}
      />,
    )
    expect(screen.queryByText('Void bill 142?')).not.toBeInTheDocument()
  })
})
