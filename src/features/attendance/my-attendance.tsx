import { CalendarCheck } from 'lucide-react'
import { useEffect, useState } from 'react'

import { EmptyState } from '@/components/layout/empty-state'
import { PageHeader } from '@/components/layout/page-header'
import { Card } from '@/components/ui/card'
import { useAdapters } from '@/data-access'
import type { AttendanceRecord } from '@/data-access/adapters'
import { formatBusinessDate } from '@/domain'
import { useSession } from '@/session/context'
import { sessionOutlets } from '@/session/session'

import { DayVerdict, EventEvidence, OverrideNote } from './evidence'
import { useOwnAttendance } from './use-own-attendance'

/**
 * My attendance — own history, own records only, enforced in the database
 * (docs/SCREENS.md).
 *
 * It renders each day with the *same* components the manager's day view uses.
 * That is not code reuse for its own sake: the proposal is explicit that an
 * employee must see exactly what their manager sees, and two independent
 * renderers would drift apart the first time one of them gained a field.
 */
export function MyAttendance() {
  const session = useSession()
  const { attendance } = useAdapters()
  const own = useOwnAttendance(session.userId, sessionOutlets(session))
  const [history, setHistory] = useState<AttendanceRecord[] | null>(null)
  const [failed, setFailed] = useState(false)

  const personId = own.status === 'ready' ? session.userId : null

  useEffect(() => {
    if (!personId) return
    let active = true
    void attendance
      .listHistory(personId)
      .then((rows) => {
        if (active) setHistory(rows)
      })
      .catch(() => {
        if (active) setFailed(true)
      })
    return () => {
      active = false
    }
  }, [attendance, personId])

  // The radius each row was judged against is that row's own outlet's — a
  // person may have worked a morning at one and an evening at another, and one
  // number for both would mislabel one of them.
  const radiusFor = (record: AttendanceRecord) =>
    own.status === 'ready'
      ? (own.days.find((day) => day.outlet.id === record.outletId)?.outlet.geofence_radius_m ?? 0)
      : 0

  return (
    <div className="mx-auto max-w-md">
      <PageHeader
        title="My attendance"
        subtitle="Your own record. This is exactly what your manager sees."
        backTo=".."
      />

      {(own.status === 'loading' || (own.status === 'ready' && history === null && !failed)) && (
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

      {own.status === 'ready' && history !== null && (
        <div data-testid="attendance-history" className="space-y-3">
          {history.length === 0 ? (
            <EmptyState
              icon={CalendarCheck}
              title="Nothing recorded yet. Your first check-in will show up here."
            />
          ) : (
            history.map((record) => (
              <DayCard
                key={record.id}
                record={record}
                radiusMetres={radiusFor(record)}
                // Named only for somebody who works at more than one: a person
                // with a single outlet already knows which shop a day was at,
                // and the label would be noise on every row.
                outletName={
                  own.status === 'ready' && own.days.length > 1 ? record.outletName : null
                }
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}

export function DayCard({
  record,
  radiusMetres,
  outletName = null,
}: {
  record: AttendanceRecord
  radiusMetres: number
  /** Which outlet this day was worked at, where that is not obvious. */
  outletName?: string | null
}) {
  return (
    <Card className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold text-content">
          {formatBusinessDate(record.businessDate)}
          {outletName && (
            <span className="block font-normal text-xs text-content-muted">{outletName}</span>
          )}
        </h2>
        <span className="text-sm">
          <DayVerdict record={record} radiusMetres={radiusMetres} />
        </span>
      </div>
      <EventEvidence label="In" event={record.checkIn} radiusMetres={radiusMetres} />
      <EventEvidence label="Out" event={record.checkOut} radiusMetres={radiusMetres} />
      <OverrideNote record={record} />
    </Card>
  )
}
