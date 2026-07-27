import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { Input } from '@/components/ui/input'

import { FormSheet } from './form-sheet'

describe('FormSheet', () => {
  it('renders title, content and footer, and closes explicitly', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()

    render(
      <FormSheet open onClose={onClose} title="Add expense" footer={<button>Save</button>}>
        <label>
          Amount
          <Input name="amount" />
        </label>
      </FormSheet>,
    )

    expect(screen.getByRole('heading', { name: 'Add expense' })).toBeInTheDocument()
    expect(screen.getByLabelText('Amount')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('renders nothing while closed', () => {
    render(
      <FormSheet open={false} onClose={() => {}} title="Add expense">
        <p>body</p>
      </FormSheet>,
    )
    expect(screen.queryByRole('heading', { name: 'Add expense' })).not.toBeInTheDocument()
  })
})
