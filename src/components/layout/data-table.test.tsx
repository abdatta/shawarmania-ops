import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { DataTable, type DataTableColumn } from './data-table'

interface Row {
  id: string
  name: string
  totalPaise: number
}

const columns: DataTableColumn<Row>[] = [
  { id: 'name', header: 'Item', cell: (row) => row.name },
  { id: 'total', header: 'Total', money: true, paise: (row) => row.totalPaise },
]

describe('DataTable', () => {
  it('renders money through the single formatter, right-aligned in tabular numerals', () => {
    render(
      <DataTable
        columns={columns}
        rows={[{ id: '1', name: 'Classic Shawarma', totalPaise: 12345600 }]}
        rowKey={(row) => row.id}
        empty={<p>empty</p>}
      />,
    )

    // Indian digit grouping, whole rupees drop the paise part.
    const money = screen.getByText('₹1,23,456')
    // Tabular numerals come from the [data-numeric] rule the Money component carries.
    expect(money).toHaveAttribute('data-numeric')
    expect(money.closest('td')).toHaveClass('text-right')
  })

  it('renders the provided empty state instead of a bare table', () => {
    render(
      <DataTable
        columns={columns}
        rows={[]}
        rowKey={(row: Row) => row.id}
        empty={<p>Record the first expense to see it here.</p>}
      />,
    )
    expect(screen.getByText('Record the first expense to see it here.')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('uses the denser phone rows by default and counter rows on request', () => {
    const { unmount } = render(
      <DataTable
        columns={columns}
        rows={[{ id: '1', name: 'x', totalPaise: 100 }]}
        rowKey={(row) => row.id}
        empty={null}
      />,
    )
    expect(document.querySelector('tbody tr')).toHaveClass('h-[var(--size-row-phone)]')
    unmount()

    render(
      <DataTable
        columns={columns}
        rows={[{ id: '1', name: 'x', totalPaise: 100 }]}
        rowKey={(row) => row.id}
        empty={null}
        density="counter"
      />,
    )
    expect(document.querySelector('tbody tr')).toHaveClass('h-[var(--size-row)]')
  })
})
