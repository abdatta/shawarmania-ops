import { useCallback, useEffect, useState } from 'react'

import { useAdapters, type Tables } from '@/data-access'
import type { AttendanceCurrentContext, AttendanceRecord } from '@/data-access/adapters'

/**
 * What every Employee attendance surface needs: which outlets judge them, and
 * today's record.
 *
 * Kept in one hook because the home screen and the history screen must agree
 * about both. Staff are accounts, so a signed-in employee *is* the person their
 * attendance belongs to and the person id is the session's own.
 *
 * **Outlets, plural, since multi-outlet-people.** Somebody may work at one shop
 * on some days and another on others, so "their outlet" stopped being a value
 * and became a set. **Today's record is singular again since
 * attendance-one-day-per-person**: they hold at most one row a business date
 * whatever outlet it was worked at, so the hook asks for a day rather than for a
 * day per outlet, and the row it gets back names where it was worked.
 *
 * Where two outlets reckon the day differently, both dates are asked for — one
 * row will answer, at most. Production's two outlets share a cutover; the code
 * does not assume it (design D7).
 */

export type OwnAttendance =
  | { status: 'loading' }
  | { status: 'no-outlet' }
  | {
      status: 'ready'
      /** Every outlet they are assigned to, for the fence to choose between. */
      outlets: Tables<'outlets'>[]
      /** One backend reference clock and every assigned outlet's current day. */
      context: AttendanceCurrentContext
      /**
       * The outlet today's status is rendered against: the one their record was
       * worked at, or their first while there is nothing recorded and the fence
       * has not yet had a reading to judge.
       */
      outlet: Tables<'outlets'>
      /** Today, as `outlet` reckons it. */
      businessDate: string
      /** Today's row, wherever it was recorded. */
      record: AttendanceRecord | null
      setRecord: (record: AttendanceRecord) => void
      reload: () => void
    }
  | { status: 'error' }

export function useOwnAttendance(personId: string, outletIds: readonly string[]): OwnAttendance {
  const { outlets, attendance } = useAdapters()
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'error' }
    | {
        kind: 'loaded'
        /** Which outlets this result is for, so a stale one reads as loading. */
        key: string
        outlets: Tables<'outlets'>[]
        context: AttendanceCurrentContext
        record: AttendanceRecord | null
      }
  >({ kind: 'loading' })
  const [nonce, setNonce] = useState(0)

  // A stable key for the set, so the effect does not re-run on every render
  // just because the caller built a fresh array.
  const key = [...outletIds].sort().join(',')
  const reload = useCallback(() => setNonce((value) => value + 1), [])

  useEffect(() => {
    if (key === '') return
    let active = true

    void (async () => {
      try {
        const ids = key.split(',')
        const found = (await Promise.all(ids.map((id) => outlets.getOutlet(id)))).filter(
          (outlet): outlet is Tables<'outlets'> => outlet !== null,
        )
        if (!active) return
        if (found.length === 0) {
          setState({ kind: 'error' })
          return
        }

        const context = await attendance.getCurrentContext(found.map((outlet) => outlet.id))
        const currentDates = new Map(
          context.outlets.map((entry) => [entry.outletId, entry.businessDate]),
        )
        if (found.some((outlet) => !currentDates.has(outlet.id))) {
          throw new Error('Attendance context omitted an assigned outlet.')
        }

        // One date for nearly everybody. Two only where cutovers disagree and
        // the one server reference instant sits between them. At most one can
        // hold a row because attendance is one-person-one-business-day.
        const dates = [...new Set(found.map((outlet) => currentDates.get(outlet.id) as string))]
        const rows = (
          await Promise.all(dates.map((date) => attendance.getDay(personId, date)))
        ).filter((row): row is AttendanceRecord => row !== null)
        if (!active) return

        setState({ kind: 'loaded', key, outlets: found, context, record: rows[0] ?? null })
      } catch {
        if (active) setState({ kind: 'error' })
      }
    })()

    return () => {
      active = false
    }
  }, [personId, key, outlets, attendance, nonce])

  // A foreground return is the only regular refresh. There is no attendance
  // clock timer or background location read; the write remains final at a
  // boundary crossed while the app was away.
  useEffect(() => {
    if (typeof document === 'undefined') return
    const onVisible = () => {
      if (document.visibilityState === 'visible') reload()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [reload])

  const setRecord = useCallback((record: AttendanceRecord) => {
    setState((current) => (current.kind === 'loaded' ? { ...current, record } : current))
  }, [])

  if (key === '') return { status: 'no-outlet' }
  if (state.kind === 'error') return { status: 'error' }
  // A result for a different set of outlets is stale, not shown — derived
  // rather than reset in the effect, which would cascade a render on every load.
  if (state.kind === 'loading' || state.key !== key) return { status: 'loading' }

  // The outlet the card is about. Their record's own outlet once there is one,
  // so the day is rendered against the clock and fence it was judged by;
  // otherwise their first, so the card has somewhere to be about while it offers
  // a check-in the fence has not resolved yet.
  const outlet =
    state.outlets.find((candidate) => candidate.id === state.record?.outletId) ?? state.outlets[0]
  const businessDate = state.context.outlets.find(
    (entry) => entry.outletId === outlet?.id,
  )?.businessDate
  if (!outlet || !businessDate) return { status: 'error' }

  return {
    status: 'ready',
    outlets: state.outlets,
    outlet,
    context: state.context,
    businessDate,
    record: state.record,
    setRecord,
    reload,
  }
}
