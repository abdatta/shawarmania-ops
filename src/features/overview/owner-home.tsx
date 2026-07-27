import { Store } from 'lucide-react'
import { useEffect, useState } from 'react'

import { DataTable, type DataTableColumn } from '@/components/layout/data-table'
import { EmptyState } from '@/components/layout/empty-state'
import { PageHeader } from '@/components/layout/page-header'
import { useAdapters, type Tables } from '@/data-access'

const columns: DataTableColumn<Tables<'outlets'>>[] = [
  { id: 'name', header: 'Outlet', cell: (outlet) => outlet.name },
  { id: 'location', header: 'Location', cell: (outlet) => outlet.location_label },
  {
    id: 'cutover',
    header: 'Day starts',
    align: 'right',
    cell: (outlet) => outlet.business_day_cutover.slice(0, 5),
  },
]

/**
 * The Super Admin home: a thin overview proving the seam, not yet the owner
 * dashboard (that arrives with ui-owner-console-and-demo, #8).
 */
export function OwnerHome() {
  const { outlets } = useAdapters()
  const [rows, setRows] = useState<Tables<'outlets'>[]>()

  useEffect(() => {
    let active = true
    void outlets.listOutlets().then((result) => {
      if (active) setRows(result)
    })
    return () => {
      active = false
    }
  }, [outlets])

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="All outlets" subtitle="Today's figures arrive with the owner console" />
      {rows ? (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(outlet) => outlet.id}
          empty={
            <EmptyState
              icon={Store}
              title="No outlets yet — create the first one from Outlets once that surface arrives."
            />
          }
        />
      ) : (
        <p className="text-sm text-content-muted">Loading…</p>
      )}
    </div>
  )
}
