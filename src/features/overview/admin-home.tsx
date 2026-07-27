import { LayoutDashboard } from 'lucide-react'
import { useEffect, useState } from 'react'

import { EmptyState } from '@/components/layout/empty-state'
import { PageHeader } from '@/components/layout/page-header'
import { Card, CardBody, CardTitle } from '@/components/ui/card'
import { useAdapters, type Tables } from '@/data-access'
import { useSession } from '@/session/context'

/**
 * The Franchise Admin home: the outlet at a glance. The real dashboard —
 * sales so far, cash position, low stock, who is in — arrives with
 * ui-outlet-operations (#7); this proves the shell and the seam.
 */
export function AdminHome() {
  const session = useSession()
  const { outlets } = useAdapters()
  const [fetched, setFetched] = useState<Tables<'outlets'> | null>()
  const outletId = session.outletId

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
      <PageHeader title={outlet?.name ?? 'Your outlet'} subtitle={outlet?.location_label} />
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
              <dt className="font-semibold">Business day starts</dt>
              <dd>{outlet.business_day_cutover.slice(0, 5)}</dd>
            </dl>
          </CardBody>
        </Card>
      )}
      <EmptyState
        icon={LayoutDashboard}
        title="Sales, cash, stock and attendance land here with the outlet-operations surfaces — walk them in this demo once they ship."
      />
    </div>
  )
}
