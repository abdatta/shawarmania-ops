import { CalendarCheck } from 'lucide-react'
import { useEffect, useState } from 'react'

import { EmptyState } from '@/components/layout/empty-state'
import { PageHeader } from '@/components/layout/page-header'
import { useAdapters, type Tables } from '@/data-access'
import { useSession } from '@/session/context'

/**
 * The Employee home — near-empty by design (docs/SCREENS.md): one check-in
 * action and today's status, which arrive with attendance (#5).
 */
export function StaffHome() {
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

  return (
    <div className="mx-auto max-w-md">
      <PageHeader
        title={`Hello, ${session.displayName}`}
        subtitle={outlet ? `Assigned to ${outlet.name}` : undefined}
      />
      <EmptyState
        icon={CalendarCheck}
        title="Check-in and check-out land here with the attendance change — one big button, and your day's status."
      />
    </div>
  )
}
