import { CalendarCheck, UserRoundX } from 'lucide-react'
import { Link } from 'react-router'

import { EmptyState } from '@/components/layout/empty-state'
import { PageHeader } from '@/components/layout/page-header'
import { buttonVariants } from '@/components/ui/button-variants'
import { CheckInCard } from '@/features/attendance/check-in-card'
import { useOwnAttendance } from '@/features/attendance/use-own-attendance'
import { useSession } from '@/session/context'

/**
 * The Employee home: one large check-in or check-out action, today's status,
 * and the outlet it is judged against (docs/SCREENS.md).
 */
export function StaffHome() {
  const session = useSession()
  const own = useOwnAttendance(session.outletId)

  return (
    <div className="mx-auto max-w-md">
      <PageHeader
        title={`Hello, ${session.displayName}`}
        subtitle={own.status === 'ready' ? `Assigned to ${own.outlet.name}` : undefined}
        action={
          own.status === 'ready' ? (
            <Link
              to="my-attendance"
              className={buttonVariants({ variant: 'secondary', size: 'phone' })}
            >
              My attendance
            </Link>
          ) : undefined
        }
      />

      {own.status === 'loading' && <p className="text-sm text-content-muted">Loading…</p>}

      {own.status === 'error' && (
        <p role="alert" className="text-sm font-semibold text-danger">
          Could not load today. Try again in a moment.
        </p>
      )}

      {own.status === 'no-outlet' && (
        <EmptyState
          icon={CalendarCheck}
          title="Your account is not assigned to an outlet yet. Ask your manager to set that up."
        />
      )}

      {own.status === 'no-roster' && (
        <EmptyState
          icon={UserRoundX}
          title={`You are not on ${own.outlet.name}’s staff list yet, so there is nothing to check in to. Ask your manager to add you.`}
        />
      )}

      {own.status === 'ready' && (
        <CheckInCard
          employee={own.employee}
          outlet={own.outlet}
          record={own.today}
          onChange={own.setToday}
        />
      )}
    </div>
  )
}
