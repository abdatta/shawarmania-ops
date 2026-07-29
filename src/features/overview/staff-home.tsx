import { CalendarCheck } from 'lucide-react'
import { Link } from 'react-router'

import { EmptyState } from '@/components/layout/empty-state'
import { PageHeader } from '@/components/layout/page-header'
import { buttonVariants } from '@/components/ui/button-variants'
import { CheckInCard } from '@/features/attendance/check-in-card'
import { useOwnAttendance } from '@/features/attendance/use-own-attendance'
import { useSession } from '@/session/context'
import { sessionOutlets } from '@/session/session'

/**
 * The Employee home: one large check-in or check-out action, today's status,
 * and the outlet it is judged against (docs/SCREENS.md).
 */
export function StaffHome() {
  const session = useSession()
  // Every outlet they work at. The fence decides which one they are standing
  // at when they check in; nothing here asks them (multi-outlet-people, D5).
  const own = useOwnAttendance(session.userId, sessionOutlets(session))

  return (
    <div className="mx-auto max-w-md">
      <PageHeader
        title={`Hello, ${session.displayName}`}
        subtitle={
          own.status === 'ready'
            ? `Assigned to ${own.days.map((day) => day.outlet.name).join(' and ')}`
            : undefined
        }
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

      {own.status === 'ready' && (
        <CheckInCard
          personId={session.userId}
          outlets={own.days.map((day) => day.outlet)}
          // The day in progress, if there is one; otherwise their first
          // outlet, which is what today's status is rendered against until the
          // fence picks one.
          outlet={(own.current ?? own.days[0])!.outlet}
          record={own.current?.record ?? null}
          canStartElsewhere={own.canStartElsewhere}
          onChange={own.setRecord}
        />
      )}
    </div>
  )
}
