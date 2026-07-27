import { useCallback, useEffect, useState } from 'react'

import { useAdapters, type Tables } from '@/data-access'
import type { AttendanceRecord, EmployeeSummary } from '@/data-access/adapters'
import { resolveBusinessDate } from '@/domain'

/**
 * What every Employee attendance surface needs: who they are on the roster,
 * which outlet judges them, and today's record.
 *
 * Kept in one hook because the home screen and the history screen must agree
 * about all three — and because "not on a roster" is a real state that both
 * have to say something honest about, rather than rendering an empty day.
 */

export type OwnAttendance =
  | { status: 'loading' }
  | { status: 'no-outlet' }
  | { status: 'no-roster'; outlet: Tables<'outlets'> }
  | {
      status: 'ready'
      employee: EmployeeSummary
      outlet: Tables<'outlets'>
      businessDate: string
      today: AttendanceRecord | null
      setToday: (record: AttendanceRecord) => void
      reload: () => void
    }
  | { status: 'error' }

export function useOwnAttendance(outletId: string | null): OwnAttendance {
  const { outlets, employees, attendance } = useAdapters()
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'error' }
    | {
        kind: 'loaded'
        /** Which outlet this result is for, so a stale one reads as loading. */
        outletId: string
        employee: EmployeeSummary | null
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
        const [outlet, employee] = await Promise.all([
          outlets.getOutlet(outletId),
          employees.getOwnEmployee(),
        ])
        if (!active) return
        if (!outlet) {
          setState({ kind: 'error' })
          return
        }

        const businessDate = resolveBusinessDate(new Date(), outlet.business_day_cutover)
        const today = employee ? await attendance.getDay(employee.id, businessDate) : null
        if (!active) return
        setState({ kind: 'loaded', outletId, employee, outlet, businessDate, today })
      } catch {
        if (active) setState({ kind: 'error' })
      }
    })()

    return () => {
      active = false
    }
  }, [outletId, outlets, employees, attendance, nonce])

  const setToday = useCallback((record: AttendanceRecord) => {
    setState((current) => (current.kind === 'loaded' ? { ...current, today: record } : current))
  }, [])

  const reload = useCallback(() => setNonce((value) => value + 1), [])

  if (!outletId) return { status: 'no-outlet' }
  if (state.kind === 'error') return { status: 'error' }
  // A result for a different outlet is stale, not shown — derived rather than
  // reset in the effect, which would cascade a render on every load.
  if (state.kind === 'loading' || state.outletId !== outletId) return { status: 'loading' }
  if (!state.employee) return { status: 'no-roster', outlet: state.outlet }

  return {
    status: 'ready',
    employee: state.employee,
    outlet: state.outlet,
    businessDate: state.businessDate,
    today: state.today,
    setToday,
    reload,
  }
}
