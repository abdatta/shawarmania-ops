import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { describe, expect, it } from 'vitest'

import { PageHeader } from './page-header'

function renderWithRouter(ui: React.ReactElement) {
  const router = createMemoryRouter([{ path: '/', element: ui }])
  return render(<RouterProvider router={router} />)
}

describe('PageHeader', () => {
  it('renders title, subtitle and the action slot', () => {
    renderWithRouter(
      <PageHeader title="Daily cash" subtitle="Friday 26 July" action={<button>Close day</button>} />,
    )
    expect(screen.getByRole('heading', { level: 1, name: 'Daily cash' })).toBeInTheDocument()
    expect(screen.getByText('Friday 26 July')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close day' })).toBeInTheDocument()
  })

  it('shows a back affordance only when given somewhere to go', () => {
    const { unmount } = renderWithRouter(<PageHeader title="Item" backTo="/inventory" />)
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/inventory')
    unmount()

    renderWithRouter(<PageHeader title="Inventory" />)
    expect(screen.queryByRole('link', { name: 'Back' })).not.toBeInTheDocument()
  })
})
