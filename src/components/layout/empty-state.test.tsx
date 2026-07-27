import { render, screen } from '@testing-library/react'
import { Package } from 'lucide-react'
import { describe, expect, it } from 'vitest'

import { EmptyState } from './empty-state'

describe('EmptyState', () => {
  it('says what to do next and renders the optional action', () => {
    render(
      <EmptyState
        icon={Package}
        title="Add the first inventory item to start the ledger."
        action={<button>Add item</button>}
      />,
    )
    expect(screen.getByText('Add the first inventory item to start the ledger.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add item' })).toBeInTheDocument()
  })
})
