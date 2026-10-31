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
      /**
       * As narrow as its widest cell, leaving the spare width to the other
       * columns — so two tables with the same columns line up whatever their rows say.
       */
      shrink?: boolean
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
  /**
   * Classes for one row. A table whose rows each open something gives its rows
   * `relative` here and stretches one link over the row from inside a cell, so
   * the whole row is one tap target and still one link to a screen reader.
   * Anything positioned in a later cell paints above that link and swallows
   * the taps on it, so give it `pointer-events-none` unless it is a control.
   */
  rowClassName?: (row: T) => string | undefined
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  empty,
  density = 'phone',
  rowClassName,
}: DataTableProps<T>) {
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
                  !isMoneyColumn(column) && column.shrink && 'w-px whitespace-nowrap',
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className={cn(rowHeight, 'border-b border-border last:border-0', rowClassName?.(row))}
            >
              {columns.map((column) => (
                <td
                  key={column.id}
                  className={cn(
                    'px-3',
                    (isMoneyColumn(column) || column.align === 'right') && 'text-right',
                    !isMoneyColumn(column) && column.shrink && 'w-px whitespace-nowrap',
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
