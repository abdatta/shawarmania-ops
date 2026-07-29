import { LayoutDashboard } from 'lucide-react'
import { useEffect, useState } from 'react'

import { EmptyState } from '@/components/layout/empty-state'
import { PageHeader } from '@/components/layout/page-header'
import { Card, CardBody, CardTitle } from '@/components/ui/card'
import { useAdapters, type Tables } from '@/data-access'
import { useOutletScope } from '@/features/outlet-scope'

/**
 * The Franchise Admin home: the outlet at a glance.
 *
 * Still a placeholder, deliberately. The operational surfaces behind it — Menu,
 * Stock, Expenses, Cash — are walkable in demo now, but this surface is `live`,
 * so filling it with mock-derived figures would put fabricated numbers in front
 * of a real manager. It gets its real dashboard when those figures become real
 * (#11, #13).
 */
export function AdminHome() {
  const { outlets } = useAdapters()
  const [fetched, setFetched] = useState<Tables<'outlets'> | null>()
  // Which outlet this surface is about. One for nearly everybody; a
  // per-surface choice for somebody who manages more than one, which
  // confers nothing — the database decides every write from the
  // assignment (multi-outlet-people, design D6).
  const { outletId, selector: outletSelector } = useOutletScope()

  useEffect(() => {
    if (!outletId) return
    let active = true
    void outlets.getOutlet(outletId).then((result) => {
      if (active) setFetched(result)
    })
    return () => {
      active = false
    }
  }, [outlets, outletId])

  // A session with no outlet is resolved, not loading.
  const outlet = outletId ? fetched : null
  if (outlet === undefined) return <p className="text-sm text-content-muted">Loading…</p>

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader
        title={outlet?.name ?? 'Your outlet'}
        subtitle={outlet?.location_label}
        scope={outletSelector}
      />
      {outlet && (
        <Card>
          <CardTitle>Outlet details</CardTitle>
          <CardBody>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <dt className="font-semibold">Address</dt>
              <dd>
                {[outlet.address_line1, outlet.city, outlet.pincode].filter(Boolean).join(', ')}
              </dd>
              <dt className="font-semibold">Phone</dt>
              <dd>{outlet.phone ?? '—'}</dd>
              <dt className="font-semibold">Day rolls over at</dt>
              <dd>{outlet.business_day_cutover.slice(0, 5)}</dd>
            </dl>
          </CardBody>
        </Card>
      )}
      <EmptyState
        icon={LayoutDashboard}
        title="Today at a glance lands here once these figures are real. Menu, Stock, Expenses and Cash are already walkable — this page is the summary of them, and it waits for the data rather than inventing it."
      />
    </div>
  )
}
