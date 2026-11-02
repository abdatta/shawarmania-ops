import { useCallback, useState } from 'react'

import type { AttendanceCurrentContext, AttendanceRecord } from '@/data-access/adapters'
import { useAdapters, type Tables } from '@/data-access'
import { AttendanceActionError } from '@/data-access/adapters'
import { distanceMetres, evaluateFence, type FenceVerdict } from '@/domain'
import {
  readCheckInPosition,
  readPosition,
  type GeolocationFailureKind,
  type PositionReading,
} from '@/lib/geolocation'

import { isLate, type AttendanceTally } from './attendance-record'
import { TodayPass } from './today-pass'

/**
 * When a reading is answered at once, rather than read
 * a few seconds longer (a-check-in-at-the-shop-approves-itself, design D7):
 * inside a fence and no rougher than the first number, or sharp enough to be
 * believed wherever it lands — more reading will not move somebody standing a
 * kilometre away into the shop, and making them wait for it would be latency
 * they feel for nothing.
 */
const GOOD_ENOUGH_INSIDE_M = 50
const SHARP_ENOUGH_ANYWHERE_M = 25

/**
 * One large action, today's status, and — when the fence refuses — a state
 * designed rather than apologised for.
 *
 * The order of operations matters and is the whole point of the screen: read a
 * position, judge it locally, and only then decide what to *show*. A refused
 * check-in writes nothing at all until the person chooses to record it anyway,
 * so abandoning a blocked attempt leaves no record and does not burn the one row
 * that day allows.
 *
 * What the screen must never do is imply the day is done. A check-in at the
 * shop approves itself; any other is a claim, and it counts as nothing until
 * the outlet's manager approves it.
 */

type Attempt =
  | { kind: 'idle' }
  | { kind: 'locating' }
  | {
      kind: 'blocked'
      verdict: Extract<FenceVerdict, { kind: 'outside' }>
      reading: PositionReading
      /** The outlet the blocked attempt would be recorded against. */
      outlet: Tables<'outlets'>
    }
  | { kind: 'unlocatable'; failure: GeolocationFailureKind }
  /**
   * No position at all, and more than one outlet it could be. The one place
   * anybody is ever asked which shop they are at
   * (attendance-one-day-per-person, design D5).
   *
   * #28 refused the check-in outright here, reasoning that the fence must be the
   * only chooser. That reasoning is kept everywhere a reading exists — inside
   * one fence, inside several, or outside all of them — but it does not reach
   * this case: there is no ambiguity to resolve, there is no data, and a
   * question is the only honest input left. The safety cost is nil, because a
   * row written this way carries no coordinates, is already unverifiable, and
   * already needs a reasoned approval. The answer decides only whose queue it
   * lands in, and a manager who did not see that person does not approve it.
   */
  | { kind: 'which-outlet'; failure: GeolocationFailureKind }
  | { kind: 'error'; message: string }

/**
 * Which of the outlets this person works at are they standing at?
 *
 * The fence decides, never the person. Inside one, that one; inside several,
 * the nearest; inside none, still the nearest — so a blocked attempt always has
 * an outlet to be blocked *at*, and a manager there to clear it.
 *
 * An unsurveyed outlet has no position to compare against and cannot win on
 * distance; it is used only when it is the sole candidate, which is exactly how
 * a single-outlet person's unsurveyed shop behaves today.
 */
export function resolveOutlet(
  outlets: readonly Tables<'outlets'>[],
  reading: PositionReading,
): Tables<'outlets'> | null {
  const [only] = outlets
  if (outlets.length <= 1) return only ?? null

  let best: { outlet: Tables<'outlets'>; distance: number } | null = null
  for (const outlet of outlets) {
    if (outlet.latitude === null || outlet.longitude === null) continue
    const distance = distanceMetres(
      { latitude: outlet.latitude, longitude: outlet.longitude },
      { latitude: reading.latitude, longitude: reading.longitude },
    )
    if (best === null || distance < best.distance) best = { outlet, distance }
  }
  return best?.outlet ?? only ?? null
}

export function CheckInCard({
  personId,
  outlets,
  outlet,
  context,
  record,
  onChange,
  onReload,
  month = null,
}: {
  /** This month so far, for Home's one line about it. */
  month?: AttendanceTally | null
  /** Whose day this is — the signed-in session's own account id. */
  personId: string
  /**
   * Every outlet they are assigned to. The fence picks one of these at
   * check-in; nothing on this screen asks them to (multi-outlet-people).
   */
  outlets: readonly Tables<'outlets'>[]
  /**
   * The outlet the card is currently *about* — the one today's row was worked
   * at, or the only one they work at. What today's status is rendered against.
   */
  outlet: Tables<'outlets'>
  /** One backend timestamp and current date per assigned outlet. */
  context: AttendanceCurrentContext
  record: AttendanceRecord | null
  onChange: (record: AttendanceRecord) => void
  onReload: () => void
}) {
  const { attendance } = useAdapters()
  const [attempt, setAttempt] = useState<Attempt>({ kind: 'idle' })
  const [busy, setBusy] = useState(false)
  // Check in anyway reading afresh: the decision stays up with its button
  // spinning, rather than a screen of its own.
  const [rechecking, setRechecking] = useState(false)
  const [refining, setRefining] = useState<PositionReading | null>(null)

  const late = record !== null && isLate(record, outlet.business_day_cutover)

  const write = useCallback(
    async (action: () => Promise<AttendanceRecord>) => {
      setBusy(true)
      try {
        const settled = await action()
        // A short buzz when the day is in. iOS has no vibration, so it is never
        // the only sign: the tick and the words are.
        if (settled.status === 'present') navigator.vibrate?.(30)
        onChange(settled)
        // The write-time database instant is final. Refresh the shared outlet
        // context as well as adopting the returned row so a cutover crossed
        // while GPS or the network was in flight cannot leave retry visibility
        // comparing the canonical new day with a stale pre-write day.
        onReload()
        setAttempt({ kind: 'idle' })
      } catch (cause) {
        if (
          cause instanceof AttendanceActionError &&
          (cause.code === 'stale_state' || cause.code === 'day_closed')
        ) {
          onReload()
        }
        setAttempt({
          kind: 'error',
          message:
            cause instanceof AttendanceActionError
              ? cause.message
              : 'That did not work. Try again in a moment.',
        })
      } finally {
        setBusy(false)
      }
    },
    [onChange, onReload],
  )

  // No "Use this new check-in?". A second check-in only happens where it can
  // change the answer (from away to the shop, or after an absence), so it simply
  // replaces the first, late if it is late [owner, 2026-10-28: "if it is late,
  // it is late"].
  const commitCheckIn = useCallback(
    (target: Tables<'outlets'>, reading: PositionReading | null) =>
      write(() =>
        attendance.checkIn({
          personId,
          outletId: target.id,
          // A first attempt uses this target outlet's server-derived current
          // date. A retry keeps its canonical row's explicit date.
          businessDate: businessDateOf(record, target, context),
          reading,
          expectedVersion: record?.stateVersion ?? null,
        }),
      ),
    [attendance, context, personId, record, write],
  )

  async function onCheckIn() {
    const liveOutlets = outlets.filter((candidate) => candidate.is_active)
    if (liveOutlets.length === 0) {
      setAttempt({
        kind: 'error',
        message: 'None of your assigned outlets is accepting check-ins.',
      })
      return
    }
    setAttempt({ kind: 'locating' })
    // One reading, and a few seconds more only when it lands outside every
    // fence or reads rough.
    const result = await readCheckInPosition(
      (reading) => {
        const near = resolveOutlet(liveOutlets, reading) ?? outlet
        const fence = evaluateFence(
          {
            latitude: near.latitude,
            longitude: near.longitude,
            radiusMetres: near.geofence_radius_m,
          },
          reading,
        )
        return (
          reading.accuracyMetres <= SHARP_ENOUGH_ANYWHERE_M ||
          (fence.kind === 'inside' && reading.accuracyMetres <= GOOD_ENOUGH_INSIDE_M)
        )
      },
      { onRefining: setRefining },
    )
    setRefining(null)

    if (!result.ok) {
      // With one outlet there is nothing to resolve, so a missing position is
      // the state it always was: the row is written, the fence declines to
      // judge it, and a manager clears it. With several, nothing can choose —
      // so the person is asked, and nothing is recorded until they answer.
      setAttempt(
        liveOutlets.length > 1
          ? { kind: 'which-outlet', failure: result.kind }
          : { kind: 'unlocatable', failure: result.kind },
      )
      return
    }

    const target = resolveOutlet(liveOutlets, result.reading) ?? outlet
    const verdict = evaluateFence(
      {
        latitude: target.latitude,
        longitude: target.longitude,
        radiusMetres: target.geofence_radius_m,
      },
      result.reading,
    )

    if (verdict.kind === 'outside') {
      // Nothing is written. The fence refused, and asking for an override is
      // the person's decision to make, not a consequence of having tried.
      setAttempt({ kind: 'blocked', verdict, reading: result.reading, outlet: target })
      return
    }

    await commitCheckIn(target, result.reading)
  }

  /**
   * **Check in anyway**: a fresh reading first, so somebody who has walked in
   * since is approved like anyone at the shop, and the check-in carries the
   * latest place there is [owner, 2026-10-26]. If no reading comes back this
   * time, the earlier one stands, or none.
   */
  async function checkInAnyway(target: Tables<'outlets'>, earlier: PositionReading | null) {
    setRechecking(true)
    try {
      const fresh = await readPosition()
      const reading = fresh.ok ? fresh.reading : earlier
      const liveOutlets = outlets.filter((candidate) => candidate.is_active)
      const at = reading ? (resolveOutlet(liveOutlets, reading) ?? target) : target
      await commitCheckIn(at, reading)
    } finally {
      setRechecking(false)
    }
  }

  const retry =
    record?.retry.allowed === true &&
    outlets.some(
      (candidate) =>
        candidate.is_active && businessDateForOutlet(context, candidate) === record.businessDate,
    )

  return (
    <TodayPass
      businessDate={businessDateOf(record, outlet, context)}
      outlet={outlet}
      outlets={outlets}
      serverAt={context.serverAt}
      record={record}
      late={late}
      attempt={attempt}
      refining={refining}
      busy={busy || rechecking}
      retry={retry}
      blocksAway={(target) => target.attendance_blocks_away}
      month={month}
      onCheckIn={() => void onCheckIn()}
      onRecord={(target, reading) => void checkInAnyway(target, reading)}
      onChoose={(chosen) => void checkInAnyway(chosen, null)}
      onDismiss={() => setAttempt({ kind: 'idle' })}
    />
  )
}

/**
 * Which business day a check-in belongs to. Taken from the record when one
 * exists, so a second attempt against a day the manager already opened cannot
 * land on a different date from the row it is amending.
 */
function businessDateOf(
  record: AttendanceRecord | null,
  outlet: Tables<'outlets'>,
  context: AttendanceCurrentContext,
): string {
  return record?.businessDate ?? businessDateForOutlet(context, outlet)
}

/** The backend has already applied this outlet's own cutover. */
function businessDateForOutlet(
  context: AttendanceCurrentContext,
  outlet: Tables<'outlets'>,
): string {
  const date = context.outlets.find((entry) => entry.outletId === outlet.id)?.businessDate
  if (!date) throw new Error(`Attendance context omitted ${outlet.id}.`)
  return date
}
