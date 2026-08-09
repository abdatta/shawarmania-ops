import { ScrollText } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useParams } from 'react-router'

import { DataTable, type DataTableColumn } from '@/components/layout/data-table'
import { EmptyState } from '@/components/layout/empty-state'
import { PageHeader } from '@/components/layout/page-header'
import { LoadingTable } from '@/components/ui/loading'
import { useAdapters } from '@/data-access'
import type { InventoryItemSummary, InventoryMovementRecord } from '@/data-access/adapters'
import { formatBusinessDate, formatDelta, formatQuantity } from '@/domain'

/**
 * One item's ledger — the answer to *"why does it say 4 kg?"*.
 *
 * It has its own address so that question can be settled by sending a link,
 * which is how it actually gets asked: by phone, mid-shift.
 *
 * **Nothing here is editable, and that is the feature.** The ledger is history;
 * a mistake is corrected by recording a correction with a note, and both rows
 * stay. There is deliberately no edit control to find, because a screen offering
 * one would be describing a system where stock history can be quietly rewritten.
 */

const MOVEMENT_WORDS = {
  added: 'Added',
  used: 'Used',
  wasted: 'Wasted',
  correction: 'Correction',
} as const

export function MovementLedger() {
  const { itemId } = useParams()
  const { inventory: adapter } = useAdapters()

  const [item, setItem] = useState<InventoryItemSummary | null>()
  const [movements, setMovements] = useState<InventoryMovementRecord[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!itemId) return
    let active = true
    void Promise.all([adapter.getItem(itemId), adapter.listMovements(itemId)])
      .then(([loadedItem, loadedMovements]) => {
        if (!active) return
        setItem(loadedItem)
        setMovements(loadedMovements)
      })
      .catch(() => {
        if (active) setError('Could not load that ledger. Try again in a moment.')
      })
    return () => {
      active = false
    }
  }, [adapter, itemId])

  const unit = item?.unit ?? ''

  const columns: DataTableColumn<InventoryMovementRecord>[] = [
    {
      id: 'date',
      header: 'Day',
      cell: (row) => formatBusinessDate(row.businessDate),
    },
    {
      id: 'type',
      header: 'What',
      cell: (row) => MOVEMENT_WORDS[row.movementType],
    },
    {
      id: 'delta',
      header: 'Change',
      align: 'right',
      cell: (row) => (
        <span data-numeric="" data-testid={`delta-${row.id}`}>
          {formatDelta(row.quantityDelta)}
        </span>
      ),
    },
    {
      id: 'after',
      header: 'Left',
      align: 'right',
      cell: (row) => (
        <span data-numeric="" data-testid={`after-${row.id}`}>
          {formatQuantity(row.quantityAfter, unit)}
        </span>
      ),
    },
    {
      id: 'note',
      header: 'Note',
      cell: (row) => <span className="text-content-muted">{row.note ?? '—'}</span>,
    },
  ]

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={item?.name ?? 'Movements'}
        subtitle={
          item
            ? `Now: ${formatQuantity(item.currentQuantity, item.unit)}. Every figure on this screen is the sum of the rows below it.`
            : undefined
        }
        backTo=".."
      />

      {error && (
        <p role="alert" className="mb-3 text-sm font-semibold text-danger">
          {error}
        </p>
      )}

      {movements === null ? (
        // A ledger is a table, so it waits behind rows.
        <LoadingTable label="this item’s ledger" rows={5} rowHeight="h-12" />
      ) : (
        <DataTable
          columns={columns}
          rows={movements}
          rowKey={(row) => row.id}
          empty={
            <EmptyState
              icon={ScrollText}
              title="Nothing has moved yet. Record what arrived and it appears here — this list is where the quantity comes from."
            />
          }
        />
      )}

      <p className="mt-3 text-xs text-content-muted">
        Nothing here can be edited or removed. If a row is wrong, record a correction with a note
        saying what was wrong — both stay on the ledger, which is what makes the figure above
        accountable.
      </p>
    </div>
  )
}
