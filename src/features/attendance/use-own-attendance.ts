import { useCallback, useEffect, useState } from 'react'

import { useAdapters, type Tables } from '@/data-access'
import type { AttendanceRecord } from '@/data-access/adapters'
import { resolveBusinessDate } from '@/domain'

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
        record: AttendanceRecord | null
      }
  >({ kind: 'loading' })
  const [nonce, setNonce] = useState(0)

  // A stable key for the set, so the effect does not re-run on every render
  // just because the caller built a fresh array.
  const key = [...outletIds].sort().join(',')

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

        // One date for nearly everybody. Two only where the cutovers disagree
        // and the clock happens to sit between them, and at most one of them
        // can hold a row.
        const dates = [
          ...new Set(found.map((o) => resolveBusinessDate(new Date(), o.business_day_cutover))),
        ]
        const rows = (
          await Promise.all(dates.map((date) => attendance.getDay(personId, date)))
        ).filter((row): row is AttendanceRecord => row !== null)
        if (!active) return

        setState({ kind: 'loaded', key, outlets: found, record: rows[0] ?? null })
      } catch {
        if (active) setState({ kind: 'error' })
      }
    })()

    return () => {
      active = false
    }
  }, [personId, key, outlets, attendance, nonce])

  const setRecord = useCallback((record: AttendanceRecord) => {
    setState((current) => (current.kind === 'loaded' ? { ...current, record } : current))
  }, [])

  const reload = useCallback(() => setNonce((value) => value + 1), [])

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
  if (!outlet) return { status: 'error' }

  return {
    status: 'ready',
    outlets: state.outlets,
    outlet,
    businessDate: resolveBusinessDate(new Date(), outlet.business_day_cutover),
    record: state.record,
    setRecord,
    reload,
  }
}
