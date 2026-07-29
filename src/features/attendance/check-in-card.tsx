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
import { evaluateFence, formatMetres, resolveBusinessDate, type FenceVerdict } from '@/domain'
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
    }
  | { kind: 'unlocatable'; failure: GeolocationFailureKind }
  | { kind: 'error'; message: string }

export function CheckInCard({
  personId,
  outlet,
  record,
  onChange,
}: {
  /** Whose day this is — the signed-in session's own account id. */
  personId: string
  outlet: Tables<'outlets'>
  record: AttendanceRecord | null
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
    (reading: PositionReading | null) =>
      write(() =>
        attendance.checkIn({
          personId,
          outletId: outlet.id,
          businessDate: businessDateOf(record, outlet),
          reading,
        }),
      ),
    [attendance, personId, outlet, record, write],
  )

  async function onCheckIn() {
    setAttempt({ kind: 'locating' })
    const result = await readPosition()

    if (!result.ok) {
      setAttempt({ kind: 'unlocatable', failure: result.kind })
      return
    }

    const verdict = evaluateFence(
      { latitude: outlet.latitude, longitude: outlet.longitude, radiusMetres: radius },
      result.reading,
    )

    if (verdict.kind === 'outside') {
      // Nothing is written. The fence refused, and asking for an override is
      // the person's decision to make, not a consequence of having tried.
      setAttempt({ kind: 'blocked', verdict, reading: result.reading })
      return
    }

    await submitCheckIn(result.reading)
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
          radiusMetres={radius}
          busy={busy}
          onRequest={() => void submitCheckIn(attempt.reading)}
          onDismiss={() => setAttempt({ kind: 'idle' })}
        />
      )}

      {attempt.kind === 'unlocatable' && (
        <UnlocatableState
          failure={attempt.failure}
          busy={busy}
          onRequest={() => void submitCheckIn(null)}
          onRetry={() => void onCheckIn()}
        />
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
        blocked={attempt.kind === 'blocked' || attempt.kind === 'unlocatable'}
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
  onCheckIn,
  onCheckOut,
}: {
  phase: ReturnType<typeof dayPhase>
  locating: boolean
  busy: boolean
  blocked: boolean
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
      <p
        data-testid="attendance-complete"
        className="flex items-center justify-center gap-2 rounded-lg border border-border bg-surface-raised px-4 py-3 text-sm font-semibold text-content"
      >
        <Clock aria-hidden size={16} />
        Your day is recorded. Nothing more to do.
      </p>
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
  busy,
  onRequest,
  onDismiss,
}: {
  verdict: Extract<FenceVerdict, { kind: 'outside' }>
  reading: PositionReading
  radiusMetres: number
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
        You are too far from the outlet to check in
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
