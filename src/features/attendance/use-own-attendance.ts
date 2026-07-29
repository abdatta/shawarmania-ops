import { useCallback, useEffect, useState } from 'react'

import { useAdapters, type Tables } from '@/data-access'
import type { AttendanceRecord } from '@/data-access/adapters'
import { resolveBusinessDate } from '@/domain'

/**
 * What every Employee attendance surface needs: which outlet judges them, and
 * today's record.
 *
 * Kept in one hook because the home screen and the history screen must agree
 * about both. Staff are accounts, so a signed-in employee *is* the person
 * their attendance belongs to — the old "not on a roster" state cannot exist,
 * and the person id is the session's own.
 */

export type OwnAttendance =
  | { status: 'loading' }
  | { status: 'no-outlet' }
  | {
      status: 'ready'
      outlet: Tables<'outlets'>
      businessDate: string
      today: AttendanceRecord | null
      setToday: (record: AttendanceRecord) => void
      reload: () => void
    }
  | { status: 'error' }

export function useOwnAttendance(personId: string, outletId: string | null): OwnAttendance {
  const { outlets, attendance } = useAdapters()
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'error' }
    | {
        kind: 'loaded'
        /** Which outlet this result is for, so a stale one reads as loading. */
        outletId: string
        outlet: Tables<'outlets'>
        businessDate: string
        today: AttendanceRecord | null
      }
  >({ kind: 'loading' })
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    if (!outletId) return
    let active = true

    void (async () => {
      try {
        const outlet = await outlets.getOutlet(outletId)
        if (!active) return
        if (!outlet) {
          setState({ kind: 'error' })
          return
        }

        const businessDate = resolveBusinessDate(new Date(), outlet.business_day_cutover)
        const today = await attendance.getDay(personId, businessDate)
        if (!active) return
        setState({ kind: 'loaded', outletId, outlet, businessDate, today })
      } catch {
        if (active) setState({ kind: 'error' })
      }
    })()

    return () => {
      active = false
    }
  }, [personId, outletId, outlets, attendance, nonce])

  const setToday = useCallback((record: AttendanceRecord) => {
    setState((current) => (current.kind === 'loaded' ? { ...current, today: record } : current))
  }, [])

  const reload = useCallback(() => setNonce((value) => value + 1), [])

  if (!outletId) return { status: 'no-outlet' }
  if (state.kind === 'error') return { status: 'error' }
  // A result for a different outlet is stale, not shown — derived rather than
  // reset in the effect, which would cascade a render on every load.
  if (state.kind === 'loading' || state.outletId !== outletId) return { status: 'loading' }

  return {
    status: 'ready',
    outlet: state.outlet,
    businessDate: state.businessDate,
    today: state.today,
    setToday,
    reload,
  }
}
