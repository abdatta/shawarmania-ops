import { useCallback, useEffect, useState } from 'react'

import { useAdapters, type Tables } from '@/data-access'
import type { AttendanceRecord } from '@/data-access/adapters'
import { resolveBusinessDate } from '@/domain'

import { dayPhase } from './attendance-record'

/**
 * What every Employee attendance surface needs: which outlets judge them, and
 * today's records.
 *
 * Kept in one hook because the home screen and the history screen must agree
 * about both. Staff are accounts, so a signed-in employee *is* the person their
 * attendance belongs to and the person id is the session's own.
 *
 * **Outlets, plural, since multi-outlet-people.** Somebody may work a morning
 * at one and an evening at another, so "their outlet" stopped being a value
 * and became a set — and today may hold one row per outlet. The overwhelmingly
 * common case is still a single outlet with a single row, and it reads exactly
 * as it did.
 */

export interface OwnDay {
  outlet: Tables<'outlets'>
  businessDate: string
  record: AttendanceRecord | null
}

export type OwnAttendance =
  | { status: 'loading' }
  | { status: 'no-outlet' }
  | {
      status: 'ready'
      /** Every outlet they are assigned to, with today's row at each. */
      days: OwnDay[]
      /**
       * The day the card is *about*.
       *
       * A day in progress wherever that is; failing that, the single outlet's
       * day for somebody who works at one place — complete, absent or not yet
       * started, it is still their day and the screen says so. Null only for a
       * multi-outlet person with nothing open, which is precisely when the
       * fence gets to decide where they are (design D5).
       */
      current: OwnDay | null
      /**
       * Is there an outlet they work at with nothing recorded today? Which is
       * what makes a completed day non-final for a multi-outlet person.
       */
      canStartElsewhere: boolean
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
        days: OwnDay[]
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
        const loaded = await Promise.all(
          ids.map(async (outletId) => {
            const outlet = await outlets.getOutlet(outletId)
            if (!outlet) return null
            const businessDate = resolveBusinessDate(new Date(), outlet.business_day_cutover)
            // Per outlet, because the row is per outlet: a person who worked
            // both today has two, and neither is the other's.
            const record = await attendance.getDay(personId, businessDate, outletId)
            return { outlet, businessDate, record }
          }),
        )
        if (!active) return

        const days = loaded.filter((day): day is OwnDay => day !== null)
        if (days.length === 0) {
          setState({ kind: 'error' })
          return
        }
        setState({ kind: 'loaded', key, days })
      } catch {
        if (active) setState({ kind: 'error' })
      }
    })()

    return () => {
      active = false
    }
  }, [personId, key, outlets, attendance, nonce])

  const setRecord = useCallback((record: AttendanceRecord) => {
    setState((current) =>
      current.kind === 'loaded'
        ? {
            ...current,
            days: current.days.map((day) =>
              day.outlet.id === record.outletId ? { ...day, record } : day,
            ),
          }
        : current,
    )
  }, [])

  const reload = useCallback(() => setNonce((value) => value + 1), [])

  if (key === '') return { status: 'no-outlet' }
  if (state.kind === 'error') return { status: 'error' }
  // A result for a different set of outlets is stale, not shown — derived
  // rather than reset in the effect, which would cascade a render on every load.
  if (state.kind === 'loading' || state.key !== key) return { status: 'loading' }

  // Started and not finished, wherever that is — that day owns the screen.
  // Failing that, whatever they DID record today, so a day just completed does
  // not vanish off the screen that recorded it. Failing that, their first
  // outlet, so the card has an outlet to be about while it offers a check-in.
  const current =
    state.days.find((day) => day.record !== null && dayPhase(day.record) === 'open') ??
    state.days.find((day) => day.record !== null) ??
    state.days[0] ??
    null

  // Somewhere else to start. A completed day usually ends the screen — but
  // somebody who finished a morning at Kalyani can still work an evening at
  // Kanchrapara, and the button has to offer it (multi-outlet-people, D5).
  const canStartElsewhere = state.days.some((day) => day.record === null)

  return { status: 'ready', days: state.days, current, canStartElsewhere, setRecord, reload }
}
