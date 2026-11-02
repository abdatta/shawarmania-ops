import { CalendarCheck } from 'lucide-react'
import { useMemo, useState } from 'react'

import { EmptyState } from '@/components/layout/empty-state'
import { PageHeader } from '@/components/layout/page-header'
import { LoadingList } from '@/components/ui/loading'
import { formatBusinessWeekday } from '@/domain'
import { useSession } from '@/session/context'
import { sessionOutlets } from '@/session/session'

import { tallyDays } from './attendance-record'
import { monthRange, type DateRange, type DayRow } from './attendance-range'
import { MonthCalendar, MonthTally } from './month-calendar'
import { RangePicker } from './range-picker'
import { useOwnAttendance } from './use-own-attendance'
import { useOwnMonth } from './use-own-month'

/**
 * My attendance — own history, own records only, enforced in the database
 * (docs/SCREENS.md).
 *
 * It renders each day with the *same* components the manager's person view uses.
 * That is not code reuse for its own sake: the proposal is explicit that an
 * employee must see exactly what their manager sees, and two independent
 * renderers would drift apart the first time one of them gained a field.
 *
 * The range spans every outlet they work at, because a person's own history
 * always has. **Each business date appears once** since
 * attendance-one-day-per-person: the range used to be assembled once per outlet
 * and the results concatenated, so somebody who worked at one shop read as
 * present there and absent at the other on the same day. There is one day, and
 * it names the outlet it was worked at.
 *
 * The month is a calendar (a-check-in-at-the-shop-approves-itself, design D8),
 * the same component the manager's By staff draws, and no sentence under the
 * heading.
 */
export function MyAttendance() {
  const session = useSession()
  const own = useOwnAttendance(session.userId, sessionOutlets(session))
  const [chosenRange, setChosenRange] = useState<DateRange | null>(null)
  const outlets = own.status === 'ready' ? own.outlets : null
  const today =
    own.status === 'ready'
      ? own.context.outlets
          .map((entry) => entry.businessDate)
          .reduce((latest, candidate) => (candidate > latest ? candidate : latest), '')
      : null
  const range: DateRange | null = useMemo(
    () => chosenRange ?? (today ? monthRange(today) : null),
    [chosenRange, today],
  )
  const month = useOwnMonth(own.status === 'ready' ? session.userId : null, outlets, range)
  const radiusFor = (row: DayRow) =>
    outlets?.find((outlet) => outlet.id === row.outletId)?.geofence_radius_m ?? 0

  return (
    <div className="mx-auto max-w-md">
      {/* No Back: My attendance is a tab of its own, and Back belongs to pages
          the tab bar cannot reach. Today's date under the heading takes the
          place of a ring on today in the calendar [owner, 2026-10-28]. */}
      <PageHeader
        title="My attendance"
        subtitle={today ? formatBusinessWeekday(today) : undefined}
      />

      {(own.status === 'loading' || (own.status === 'ready' && !month.days && !month.failed)) && (
        <LoadingList label="your attendance" data-testid="my-attendance-loading" />
      )}

      {(own.status === 'error' || month.failed) && (
        <p role="alert" className="text-sm font-semibold text-danger">
          Could not load your attendance. Try again in a moment.
        </p>
      )}

      {own.status === 'no-outlet' && (
        <EmptyState icon={CalendarCheck} title="Your account is not assigned to an outlet yet." />
      )}

      {own.status === 'ready' && month.days && range && today && (
        <div data-testid="attendance-history">
          <RangePicker range={range} today={today} onChange={setChosenRange} />
          <MonthTally tally={tallyDays(month.days)} />
          <MonthCalendar
            rows={month.days}
            range={range}
            radiusFor={radiusFor}
            personId={session.userId}
            showOutlet={(outlets?.length ?? 0) > 1}
            today={today}
          />
        </div>
      )}
    </div>
  )
}
