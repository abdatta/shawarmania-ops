import type { ReactNode } from 'react'

import { Money } from '@/components/ui/money'
import { cn } from '@/lib/cn'

/**
 * A money column takes integer paise and renders through the single money
 * formatter, right-aligned in tabular numerals — declared, not remembered,
 * so a later surface cannot format rupees by hand in a cell.
 */
export type DataTableColumn<T> =
  | {
      id: string
      header: ReactNode
      align?: 'left' | 'right'
      cell: (row: T) => ReactNode
    }
  | {
      id: string
      header: ReactNode
      money: true
      paise: (row: T) => number
    }

function isMoneyColumn<T>(
  column: DataTableColumn<T>,
): column is Extract<DataTableColumn<T>, { money: true }> {
  return 'money' in column
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[]
  rows: readonly T[]
  rowKey: (row: T) => string
  /** Rendered instead of the table when there are no rows — never a bare gap. */
  empty: ReactNode
  /** Row density from docs/DESIGN_SYSTEM.md: 40px on phones, 44px at the counter. */
  density?: 'phone' | 'counter'
}

export function DataTable<T>({ columns, rows, rowKey, empty, density = 'phone' }: DataTableProps<T>) {
  if (rows.length === 0) return <>{empty}</>

  const rowHeight = density === 'counter' ? 'h-[var(--size-row)]' : 'h-[var(--size-row-phone)]'

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-content-muted">
            {columns.map((column) => (
              <th
                key={column.id}
                scope="col"
                className={cn(
                  'border-b border-border px-3 py-2 font-semibold',
                  (isMoneyColumn(column) || column.align === 'right') && 'text-right',
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} className={cn(rowHeight, 'border-b border-border last:border-0')}>
              {columns.map((column) => (
                <td
                  key={column.id}
                  className={cn(
                    'px-3',
                    (isMoneyColumn(column) || column.align === 'right') && 'text-right',
                  )}
                >
                  {isMoneyColumn(column) ? <Money paise={column.paise(row)} /> : column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
