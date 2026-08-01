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
 * The Employee home: one large check-in action, today's status, and the outlet
 * it is judged against (docs/SCREENS.md).
 *
 * "Today's status" now includes a state it did not have: recorded, and waiting
 * for a manager. The card owns that wording, because a home screen that read
 * "your day is recorded" about a day that counts for nothing would be the exact
 * misunderstanding this change exists to remove.
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
            ? `Assigned to ${own.outlets.map((outlet) => outlet.name).join(' and ')}`
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
          outlets={own.outlets}
          // Where today's row was worked, or their first outlet while there is
          // no row and the fence has had nothing to judge.
          outlet={own.outlet}
          record={own.record}
          onChange={own.setRecord}
        />
      )}
    </div>
  )
}
