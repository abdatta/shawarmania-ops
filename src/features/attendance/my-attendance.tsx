import { CalendarCheck } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { EmptyState } from '@/components/layout/empty-state'
import { PageHeader } from '@/components/layout/page-header'
import { useAdapters } from '@/data-access'
import type { AttendanceRecord } from '@/data-access/adapters'
import { resolveBusinessDate } from '@/domain'
import { useSession } from '@/session/context'
import { sessionOutlets } from '@/session/session'

import { tallyDays } from './attendance-record'
import { assembleRange, monthRange, type DateRange, type DayRow } from './attendance-range'
import { RangeDayList, TallySummary } from './day-range-list'
import { RangePicker } from './range-picker'
import { useOwnAttendance } from './use-own-attendance'

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
 * always has. A day with nothing recorded reads as absent per outlet, which is
 * what the row model means: somebody who works at two shops and turned up at
 * neither was absent at both.
 */
export function MyAttendance() {
  const session = useSession()
  const { attendance } = useAdapters()
  const own = useOwnAttendance(session.userId, sessionOutlets(session))
  const [records, setRecords] = useState<AttendanceRecord[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [chosenRange, setChosenRange] = useState<DateRange | null>(null)

  const personId = own.status === 'ready' ? session.userId : null
  // Their first outlet's reckoning of today. Only used to bound the picker; each
  // day is assembled against its own outlet's clock below.
  const today =
    own.status === 'ready' && own.days[0]
      ? resolveBusinessDate(new Date(), own.days[0].outlet.business_day_cutover)
      : null

  // Derived rather than set from an effect once `today` is known: an effect that
  // seeds state cascades a render on every load, and this month is a function of
  // the outlet's clock rather than a decision anybody made. Memoised so the
  // fetch below depends on a stable value rather than on a fresh object each
  // render, which would re-fetch forever.
  const range: DateRange | null = useMemo(
    () => chosenRange ?? (today ? monthRange(today) : null),
    [chosenRange, today],
  )

  useEffect(() => {
    if (!personId || !range) return
    let active = true
    void attendance
      .listHistory(personId, range.from, range.to)
      .then((rows) => {
        if (active) setRecords(rows)
      })
      .catch(() => {
        if (active) setFailed(true)
      })
    return () => {
      active = false
    }
  }, [attendance, personId, range])

  const days: DayRow[] = useMemo(() => {
    if (own.status !== 'ready' || !records || !range) return []
    return own.days
      .flatMap(({ outlet }) =>
        assembleRange({
          records: records.filter((record) => record.outletId === outlet.id),
          outlet,
          range,
          // The session's own assignments, so a range reaching before they were
          // hired paints nothing there.
          windows: session.assignments
            .filter((assignment) => assignment.outletId === outlet.id)
            .map(({ startedOn, endedOn }) => ({ startedOn, endedOn })),
        }),
      )
      .sort(
        (a, b) =>
          b.businessDate.localeCompare(a.businessDate) ||
          (a.outletName ?? '').localeCompare(b.outletName ?? ''),
      )
  }, [own, records, range, session.assignments])

  const multiOutlet = own.status === 'ready' && own.days.length > 1
  // The radius each row was judged against is that row's own outlet's — a person
  // may have worked a morning at one and an evening at another, and one number
  // for both would mislabel one of them.
  const radiusFor = (row: DayRow) =>
    own.status === 'ready'
      ? (own.days.find((day) => day.outlet.id === row.outletId)?.outlet.geofence_radius_m ?? 0)
      : 0

  return (
    <div className="mx-auto max-w-md">
      <PageHeader
        title="My attendance"
        subtitle="Your own record. This is exactly what your manager sees."
        backTo=".."
      />

      {(own.status === 'loading' || (own.status === 'ready' && records === null && !failed)) && (
        <p className="text-sm text-content-muted">Loading…</p>
      )}

      {(own.status === 'error' || failed) && (
        <p role="alert" className="text-sm font-semibold text-danger">
          Could not load your attendance. Try again in a moment.
        </p>
      )}

      {own.status === 'no-outlet' && (
        <EmptyState icon={CalendarCheck} title="Your account is not assigned to an outlet yet." />
      )}

      {own.status === 'ready' && records !== null && range && today && (
        <div data-testid="attendance-history">
          <RangePicker range={range} today={today} onChange={setChosenRange} />
          <TallySummary tally={tallyDays(days)} />
          <RangeDayList rows={days} radiusFor={radiusFor} showOutlet={multiOutlet} />
        </div>
      )}
    </div>
  )
}
