import { useEffect, useMemo, useState } from 'react'

import { useAdapters, type Tables } from '@/data-access'
import type { AttendanceRecord } from '@/data-access/adapters'
import { useSession } from '@/session/context'

import { assembleRange, type DateRange, type DayRow } from './attendance-range'

/**
 * One month of a person's own days, as My attendance reads them, for the
 * refreshed screens (a-check-in-at-the-shop-approves-itself, design D7–D8):
 * the month calendar, and Home's one line about the month so far.
 *
 * One read of `listHistory` for the range, again when the app returns to the
 * foreground and when `nonce` changes (a check-in just landed), and never on a
 * timer.
 */
export function useOwnMonth(
  personId: string | null,
  outlets: readonly Tables<'outlets'>[] | null,
  range: DateRange | null,
  nonce: unknown = null,
): { days: DayRow[] | null; failed: boolean } {
  const session = useSession()
  const { attendance } = useAdapters()
  const [records, setRecords] = useState<{ key: string; rows: AttendanceRecord[] } | null>(null)
  const [failed, setFailed] = useState(false)
  const [visible, setVisible] = useState(0)
  const key = personId && range ? `${personId}:${range.from}:${range.to}` : ''

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') setVisible((count) => count + 1)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  useEffect(() => {
    if (!personId || !range) return
    let active = true
    void attendance
      .listHistory(personId, range.from, range.to)
      .then((rows) => {
        if (!active) return
        setFailed(false)
        setRecords({ key: `${personId}:${range.from}:${range.to}`, rows })
      })
      .catch(() => {
        if (active) setFailed(true)
      })
    return () => {
      active = false
    }
  }, [attendance, personId, range, visible, nonce])

  const days = useMemo(() => {
    if (!outlets || !range || !records || records.key !== key) return null
    return assembleRange({
      records: records.rows,
      outlets,
      range,
      // The session's own assignments, so a range reaching before they were
      // hired paints nothing there.
      windows: session.assignments
        .filter((assignment) => assignment.outletId !== null)
        .map(({ outletId, startedOn, endedOn }) => ({
          outletId: outletId as string,
          startedOn,
          endedOn,
        })),
    })
  }, [key, outlets, range, records, session.assignments])

  return { days, failed }
}
