import { CalendarCheck } from 'lucide-react'
import { useMemo } from 'react'
import { Link } from 'react-router'

import { useChangeGate } from '@/change-gates/context'

import { EmptyState } from '@/components/layout/empty-state'
import { PageHeader } from '@/components/layout/page-header'
import { buttonVariants } from '@/components/ui/button-variants'
import { LoadingBlock } from '@/components/ui/loading'
import { tallyDays } from '@/features/attendance/attendance-record'
import { monthRange } from '@/features/attendance/attendance-range'
import { CheckInCard } from '@/features/attendance/check-in-card'
import { useOwnAttendance } from '@/features/attendance/use-own-attendance'
import { useOwnMonth } from '@/features/attendance/use-own-month'
import { useSession } from '@/session/context'
import { sessionOutlets } from '@/session/session'

/**
 * The Employee home: one large check-in action, today's status, and the outlet
 * it is judged against (docs/SCREENS.md).
 *
 * "Today's status" includes a state it did not always have: recorded, and
 * waiting for a manager. The card owns that wording, because a home screen that
 * read "your day is recorded" about a day that counts for nothing would be the
 * exact misunderstanding to avoid. Since #81 a check-in at the shop is approved
 * by the database itself, and the Today pass says so; one away still waits.
 */
export function StaffHome() {
  const refreshed = useChangeGate('refreshed-staff-screens')
  return refreshed ? <TodayHome /> : <StaffHomeAsItWas />
}

/**
 * Home as a pass for today (a-check-in-at-the-shop-approves-itself, design D7;
 * `refreshed-staff-screens`). No greeting, no "Assigned to…", and no My
 * attendance button: the card names the shop, and the bottom tab is the way to
 * the month. The card's own heading is the date, so the page has no other.
 */
function TodayHome() {
  const session = useSession()
  const own = useOwnAttendance(session.userId, sessionOutlets(session))
  const today =
    own.status === 'ready'
      ? own.context.outlets
          .map((entry) => entry.businessDate)
          .reduce((latest, candidate) => (candidate > latest ? candidate : latest), '')
      : null
  const range = useMemo(() => (today ? monthRange(today) : null), [today])
  // Read again once a check-in lands, so the month line counts today.
  const month = useOwnMonth(
    own.status === 'ready' ? session.userId : null,
    own.status === 'ready' ? own.outlets : null,
    range,
    own.status === 'ready' ? own.record?.stateVersion : null,
  )

  return (
    <div className="mx-auto max-w-md">
      {own.status === 'loading' && <LoadingBlock label="today" className="h-48" />}

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
          outlet={own.outlet}
          context={own.context}
          record={own.record}
          onChange={own.setRecord}
          onReload={own.reload}
          month={month.days ? tallyDays(month.days) : null}
        />
      )}
    </div>
  )
}

function StaffHomeAsItWas() {
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

      {/* One card, at the check-in card's height: a title, the day's evidence,
          and the tile-sized action beneath them. */}
      {own.status === 'loading' && <LoadingBlock label="today" className="h-48" />}

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
          context={own.context}
          record={own.record}
          onChange={own.setRecord}
          onReload={own.reload}
        />
      )}
    </div>
  )
}
