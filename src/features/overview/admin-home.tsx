import { LayoutDashboard } from 'lucide-react'
import { useEffect, useState } from 'react'

import { EmptyState } from '@/components/layout/empty-state'
import { PageHeader } from '@/components/layout/page-header'
import { Card, CardBody, CardTitle } from '@/components/ui/card'
import { LoadingRegion, Shimmer } from '@/components/ui/loading'
import { useAdapters, type Tables } from '@/data-access'
import { useOutletScope } from '@/features/outlet-scope'

/**
 * The Franchise Admin home: the outlet at a glance.
 *
 * Still a placeholder, deliberately. The operational surfaces behind it — Menu,
 * Expenses, the Drawer, the Ledger — are live now, but this surface has never
 * had figures of its own, and filling it with mock-derived ones would put
 * fabricated numbers in front of a real manager.
 *
 * **Nothing on the roadmap is going to fill it.** #13 would have, and was
 * withdrawn (`openspec/todos/owner-console-was-withdrawn.md`). A manager reads
 * their outlet in the Ledger and the Drawer, from recorded rows.
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
  // This branch returns before the header, so the placeholder reserves the
  // header too — otherwise the title drops in and pushes the card down.
  if (outlet === undefined) {
    return (
      <LoadingRegion label="this outlet" className="mx-auto max-w-3xl space-y-4">
        <Shimmer className="h-12" />
        <Shimmer className="h-32" />
      </LoadingRegion>
    )
  }

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
