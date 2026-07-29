import {
  CircleSlash,
  Clock,
  LoaderCircle,
  LogIn,
  LogOut,
  MapPinOff,
  TriangleAlert,
} from 'lucide-react'
import { useCallback, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardTitle } from '@/components/ui/card'
import type { AttendanceRecord } from '@/data-access/adapters'
import { useAdapters, type Tables } from '@/data-access'
import { AttendanceActionError } from '@/data-access/adapters'
import {
  distanceMetres,
  evaluateFence,
  formatMetres,
  resolveBusinessDate,
  type FenceVerdict,
} from '@/domain'
import { readPosition, type GeolocationFailureKind, type PositionReading } from '@/lib/geolocation'

import { dayPhase } from './attendance-record'
import { DayVerdict, EventEvidence, OverrideNote } from './evidence'

/**
 * One large action, today's status, and — when the fence refuses — a state
 * designed rather than apologised for.
 *
 * The order of operations matters and is the whole point of the screen: read a
 * position, judge it locally, and only then decide what to *show*. A refused
 * check-in writes nothing at all until the person chooses to ask for an
 * override, so abandoning a blocked attempt leaves no record and does not burn
 * the one row that day allows.
 */

const FAILURE_COPY: Record<GeolocationFailureKind, { title: string; advice: string }> = {
  denied: {
    title: 'Location permission is off',
    advice:
      'This app needs your location only when you check in or out. Turn it on for this site in your browser settings, then try again.',
  },
  unavailable: {
    title: 'Your phone could not find a position',
    advice: 'Step outside or near a window and try again — indoors the signal is often blocked.',
  },
  timeout: {
    title: 'Finding your position took too long',
    advice: 'Try again. If it keeps timing out, step outside for a clearer signal.',
  },
  unsupported: {
    title: 'This browser cannot share a location',
    advice: 'Try a different browser, or ask your manager to record today for you.',
  },
}

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
   * No position at all, and more than one outlet to choose between. The one
   * place a multi-outlet person is ever stopped (design D5) — nothing can
   * honestly resolve where they are, so they are handed to a human rather than
   * to a control they would have to understand.
   */
  | { kind: 'unresolvable' }
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
  record,
  canStartElsewhere = false,
  onChange,
}: {
  /** Whose day this is — the signed-in session's own account id. */
  personId: string
  /**
   * Every outlet they are assigned to. The fence picks one of these at
   * check-in; nothing on this screen asks them to (multi-outlet-people).
   */
  outlets: readonly Tables<'outlets'>[]
  /**
   * The outlet the card is currently *about* — the one with an open day, or
   * the only one they work at. What today's status is rendered against.
   */
  outlet: Tables<'outlets'>
  record: AttendanceRecord | null
  /**
   * Is there another outlet they work at with nothing recorded today? A
   * completed day usually ends the screen; for somebody who works at two it
   * does not, because the evening shift is at the other shop.
   */
  canStartElsewhere?: boolean
  onChange: (record: AttendanceRecord) => void
}) {
  const { attendance } = useAdapters()
  const [attempt, setAttempt] = useState<Attempt>({ kind: 'idle' })
  const [busy, setBusy] = useState(false)

  const phase = dayPhase(record)
  const radius = outlet.geofence_radius_m

  const write = useCallback(
    async (action: () => Promise<AttendanceRecord>) => {
      setBusy(true)
      try {
        onChange(await action())
        setAttempt({ kind: 'idle' })
      } catch (cause) {
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
    [onChange],
  )

  const submitCheckIn = useCallback(
    (target: Tables<'outlets'>, reading: PositionReading | null) =>
      write(() =>
        attendance.checkIn({
          personId,
          outletId: target.id,
          // The resolved outlet's own cutover, not the card's: the business
          // day is the day at the shop they are standing in.
          businessDate: businessDateOf(record, target),
          reading,
        }),
      ),
    [attendance, personId, record, write],
  )

  async function onCheckIn() {
    setAttempt({ kind: 'locating' })
    const result = await readPosition()

    if (!result.ok) {
      // With one outlet there is nothing to resolve, so a missing position is
      // the state it always was: the row is written, the fence declines to
      // judge it, and a manager clears it. With several, nothing can honestly
      // choose — and guessing would put somebody's day at the wrong shop.
      if (outlets.length > 1) {
        setAttempt({ kind: 'unresolvable' })
        return
      }
      setAttempt({ kind: 'unlocatable', failure: result.kind })
      return
    }

    const target = resolveOutlet(outlets, result.reading) ?? outlet
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

    await submitCheckIn(target, result.reading)
  }

  async function onCheckOut() {
    if (!record) return
    setAttempt({ kind: 'locating' })
    const result = await readPosition()
    // A check-out is never refused, however far away it is taken (design D3).
    await write(() =>
      attendance.checkOut({ attendanceId: record.id, reading: result.ok ? result.reading : null }),
    )
  }

  return (
    <Card className="space-y-4">
      <div className="flex items-baseline justify-between gap-2">
        <CardTitle>Today</CardTitle>
        {record && (
          <span className="text-sm">
            <DayVerdict record={record} radiusMetres={radius} />
          </span>
        )}
      </div>

      {outlet.latitude === null && (
        <p className="rounded-lg border border-border bg-surface-raised p-2 text-xs text-content-muted">
          This outlet’s position has not been captured yet, so check-ins here are not measured
          against a geofence.
        </p>
      )}

      {record && (
        <div className="space-y-2">
          <EventEvidence label="Checked in" event={record.checkIn} radiusMetres={radius} />
          {record.checkOut && (
            <EventEvidence label="Checked out" event={record.checkOut} radiusMetres={radius} />
          )}
          <OverrideNote record={record} />
        </div>
      )}

      {attempt.kind === 'blocked' && (
        <BlockedState
          verdict={attempt.verdict}
          reading={attempt.reading}
          radiusMetres={attempt.outlet.geofence_radius_m}
          outletName={outlets.length > 1 ? attempt.outlet.name : null}
          busy={busy}
          onRequest={() => void submitCheckIn(attempt.outlet, attempt.reading)}
          onDismiss={() => setAttempt({ kind: 'idle' })}
        />
      )}

      {attempt.kind === 'unlocatable' && (
        <UnlocatableState
          failure={attempt.failure}
          busy={busy}
          onRequest={() => void submitCheckIn(outlet, null)}
          onRetry={() => void onCheckIn()}
        />
      )}

      {attempt.kind === 'unresolvable' && (
        <div
          role="alert"
          data-testid="attendance-unresolvable"
          className="space-y-2 rounded-lg border border-warning bg-surface-raised p-3"
        >
          <p className="text-sm font-semibold text-content">
            We could not work out which shop you are at
          </p>
          <p className="text-sm text-content-muted">
            You work at more than one, and without a position there is no way to tell them apart —
            so nothing has been recorded. Try again outside, or ask your manager to record today for
            you.
          </p>
          <Button size="phone" variant="secondary" onClick={() => void onCheckIn()}>
            Try again
          </Button>
        </div>
      )}

      {attempt.kind === 'error' && (
        <p
          role="alert"
          data-testid="attendance-error"
          className="text-sm font-semibold text-danger"
        >
          {attempt.message}
        </p>
      )}

      <PrimaryAction
        phase={phase}
        locating={attempt.kind === 'locating'}
        busy={busy}
        blocked={
          attempt.kind === 'blocked' ||
          attempt.kind === 'unlocatable' ||
          attempt.kind === 'unresolvable'
        }
        canStartElsewhere={canStartElsewhere}
        onCheckIn={() => void onCheckIn()}
        onCheckOut={() => void onCheckOut()}
      />
    </Card>
  )
}

/**
 * The one big button. Deliberately the only primary action on the screen: an
 * Employee's home is a phone held one-handed, often on the way in.
 */
function PrimaryAction({
  phase,
  locating,
  busy,
  blocked,
  canStartElsewhere = false,
  onCheckIn,
  onCheckOut,
}: {
  phase: ReturnType<typeof dayPhase>
  locating: boolean
  busy: boolean
  blocked: boolean
  canStartElsewhere?: boolean
  onCheckIn: () => void
  onCheckOut: () => void
}) {
  if (locating || busy) {
    return (
      <Button size="tile" className="w-full" disabled data-testid="attendance-action">
        <LoaderCircle aria-hidden size={20} className="animate-spin" />
        {locating ? 'Finding your position…' : 'Saving…'}
      </Button>
    )
  }

  if (phase === 'complete') {
    return (
      <div className="space-y-3">
        <p
          data-testid="attendance-complete"
          className="flex items-center justify-center gap-2 rounded-lg border border-border bg-surface-raised px-4 py-3 text-sm font-semibold text-content"
        >
          <Clock aria-hidden size={16} />
          Your day is recorded
          {canStartElsewhere ? ' here.' : '. Nothing more to do.'}
        </p>
        {/*
          A completed day is the end of it for somebody who works at one shop.
          For somebody who works at two it is not: the evening shift is at the
          other one, and the fence will resolve which when they press this
          (multi-outlet-people, design D5).
        */}
        {canStartElsewhere && (
          <Button
            size="phone"
            data-testid="attendance-action"
            onClick={onCheckIn}
            disabled={blocked}
          >
            <LogIn aria-hidden size={20} />
            Check in at another outlet
          </Button>
        )}
      </div>
    )
  }

  if (phase === 'marked') {
    return (
      <p
        data-testid="attendance-marked"
        className="flex items-center justify-center gap-2 rounded-lg border border-border bg-surface-raised px-4 py-3 text-sm text-content-muted"
      >
        <CircleSlash aria-hidden size={16} />
        Today is already recorded by your manager.
      </p>
    )
  }

  if (phase === 'open') {
    return (
      <Button size="tile" className="w-full" onClick={onCheckOut} data-testid="attendance-action">
        <LogOut aria-hidden size={20} />
        Check out
      </Button>
    )
  }

  return (
    <Button
      size="tile"
      className="w-full"
      onClick={onCheckIn}
      data-testid="attendance-action"
      // After a refusal the button stays, but the blocked panel above owns the
      // decision — pressing it again just retakes the same reading.
      variant={blocked ? 'secondary' : 'primary'}
    >
      <LogIn aria-hidden size={20} />
      {blocked ? 'Try again' : 'Check in'}
    </Button>
  )
}

/** Why it was refused, by how much, how sure the phone was, and the way through. */
function BlockedState({
  verdict,
  reading,
  radiusMetres,
  outletName,
  busy,
  onRequest,
  onDismiss,
}: {
  verdict: Extract<FenceVerdict, { kind: 'outside' }>
  reading: PositionReading
  radiusMetres: number
  /**
   * Which outlet the attempt would land at — named only for somebody who works
   * at more than one, where "the outlet" is otherwise ambiguous. The fence
   * chose it (the nearest they are assigned to); this says which.
   */
  outletName: string | null
  busy: boolean
  onRequest: () => void
  onDismiss: () => void
}) {
  return (
    <div
      data-testid="attendance-blocked"
      className="space-y-3 rounded-xl border border-warning bg-surface-raised p-3"
    >
      <p className="flex items-center gap-2 font-semibold text-content">
        <TriangleAlert aria-hidden size={18} className="text-warning" />
        {outletName
          ? `You are too far from ${outletName} to check in`
          : 'You are too far from the outlet to check in'}
      </p>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
        <dt className="text-content-muted">Your distance</dt>
        <dd className="font-semibold text-content">{formatMetres(verdict.distanceMetres)}</dd>
        <dt className="text-content-muted">Allowed</dt>
        <dd className="text-content">{formatMetres(radiusMetres)}</dd>
        <dt className="text-content-muted">Beyond the limit by</dt>
        <dd className="font-semibold text-content">{formatMetres(verdict.beyondMetres)}</dd>
        <dt className="text-content-muted">Your phone’s accuracy</dt>
        <dd className="text-content">±{formatMetres(reading.accuracyMetres)}</dd>
      </dl>
      <p className="text-xs text-content-muted">
        Phone locations drift, especially indoors. If you are at work, ask your manager to approve
        it — they will see this reading and decide.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="phone" onClick={onRequest} disabled={busy} data-testid="request-override">
          Ask my manager to approve
        </Button>
        <Button variant="ghost" size="phone" onClick={onDismiss} disabled={busy}>
          Not now
        </Button>
      </div>
    </div>
  )
}

/** No position at all — named, so the advice can be specific. */
function UnlocatableState({
  failure,
  busy,
  onRequest,
  onRetry,
}: {
  failure: GeolocationFailureKind
  busy: boolean
  onRequest: () => void
  onRetry: () => void
}) {
  const copy = FAILURE_COPY[failure]

  return (
    <div
      data-testid="attendance-unlocatable"
      data-failure={failure}
      className="space-y-3 rounded-xl border border-warning bg-surface-raised p-3"
    >
      <p className="flex items-center gap-2 font-semibold text-content">
        <MapPinOff aria-hidden size={18} className="text-warning" />
        {copy.title}
      </p>
      <p className="text-xs text-content-muted">{copy.advice}</p>
      <p className="text-xs text-content-muted">
        You can still record today without a position — it will wait for your manager to approve.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="phone" onClick={onRetry} disabled={busy}>
          Try again
        </Button>
        <Button size="phone" onClick={onRequest} disabled={busy} data-testid="request-override">
          Record it and ask my manager
        </Button>
      </div>
    </div>
  )
}

/**
 * Which business day a check-in belongs to. Taken from the record when one
 * exists, so a check-out at 00:30 cannot land on a different day from the
 * check-in it closes.
 */
function businessDateOf(record: AttendanceRecord | null, outlet: Tables<'outlets'>): string {
  return record?.businessDate ?? currentBusinessDate(outlet)
}

/** Today, as this outlet reckons days. */
function currentBusinessDate(outlet: Tables<'outlets'>): string {
  return resolveBusinessDate(new Date(), outlet.business_day_cutover)
}
