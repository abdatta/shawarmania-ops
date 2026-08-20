import { CircleSlash, Hourglass, LoaderCircle, LogIn, MapPinOff, TriangleAlert } from 'lucide-react'
import { useCallback, useState } from 'react'

import { FormSheet } from '@/components/layout/form-sheet'
import { Button } from '@/components/ui/button'
import { buttonVariants } from '@/components/ui/button-variants'
import { Card, CardTitle } from '@/components/ui/card'
import type { AttendanceCurrentContext, AttendanceRecord } from '@/data-access/adapters'
import { useAdapters, type Tables } from '@/data-access'
import { AttendanceActionError } from '@/data-access/adapters'
import {
  distanceMetres,
  evaluateFence,
  formatMetres,
  instantOnBusinessDay,
  type FenceVerdict,
} from '@/domain'
import { readPosition, type GeolocationFailureKind, type PositionReading } from '@/lib/geolocation'

import { isLate, isWaitingForApproval } from './attendance-record'
import { ApprovalNote, AttendanceHistory, DayVerdict, EventEvidence } from './evidence'

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
 * What the screen must never do is imply the day is done. A recorded arrival is
 * a claim, and it counts as nothing until the outlet's manager approves it.
 */

const FAILURE_COPY: Record<GeolocationFailureKind, { title: string; advice: string }> = {
  denied: {
    title: 'Location permission is off',
    advice:
      'This app needs your location only when you check in. Turn it on for this site in your browser settings, then try again.',
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
  | {
      kind: 'confirm'
      outlet: Tables<'outlets'>
      reading: PositionReading | null
      changes: string[]
    }
  | { kind: 'error'; message: string }

type FenceClass = 'inside' | 'outside' | 'unverifiable'

function fenceClass(distance: number | null, radius: number): FenceClass {
  if (distance === null) return 'unverifiable'
  return distance <= radius ? 'inside' : 'outside'
}

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
}: {
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

  const phase = cardPhase(record)
  const radius = outlet.geofence_radius_m
  const late = record !== null && isLate(record, outlet.business_day_cutover)

  const write = useCallback(
    async (action: () => Promise<AttendanceRecord>) => {
      setBusy(true)
      try {
        onChange(await action())
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

  const prepareCheckIn = useCallback(
    (target: Tables<'outlets'>, reading: PositionReading | null) => {
      if (!record) return commitCheckIn(target, reading)
      const previous = record.attempts.at(-1)
      if (!previous) return commitCheckIn(target, reading)
      const previousOutlet =
        outlets.find((candidate) => candidate.id === previous.outletId) ?? outlet
      const nextDistance =
        reading && target.latitude !== null && target.longitude !== null
          ? distanceMetres(
              { latitude: target.latitude, longitude: target.longitude },
              { latitude: reading.latitude, longitude: reading.longitude },
            )
          : null
      const beforeFence = fenceClass(previous.distanceMetres, previousOutlet.geofence_radius_m)
      const afterFence = fenceClass(nextDistance, target.geofence_radius_m)
      const previousLate =
        previous.at >
        instantOnBusinessDay(
          record.businessDate,
          previous.arrivalDeadline,
          previousOutlet.business_day_cutover,
        )
      const nextAt = context.serverAt
      const nextLate =
        nextAt >
        instantOnBusinessDay(
          record.businessDate,
          target.arrival_deadline,
          target.business_day_cutover,
        )
      const changes: string[] = []
      if (previous.outletId !== target.id) {
        changes.push(`${previous.outletName ?? 'Previous outlet'} → ${target.name}`)
      }
      if (previousLate !== nextLate) {
        changes.push(`${previousLate ? 'Late' : 'On time'} → ${nextLate ? 'late' : 'on time'}`)
      }
      if (beforeFence !== afterFence) changes.push(`${beforeFence} fence → ${afterFence} fence`)
      if (changes.length === 0) return commitCheckIn(target, reading)
      setAttempt({ kind: 'confirm', outlet: target, reading, changes })
    },
    [commitCheckIn, context.serverAt, outlet, outlets, record],
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
    const result = await readPosition()

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

    await prepareCheckIn(target, result.reading)
  }

  return (
    <Card className="space-y-4">
      <div className="flex items-baseline justify-between gap-2">
        <CardTitle>Today</CardTitle>
        {record && (
          <span className="text-sm">
            <DayVerdict record={record} late={late} />
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
          <ApprovalNote record={record} radiusMetres={radius} />
          <AttendanceHistory record={record} />
        </div>
      )}

      {attempt.kind === 'blocked' && (
        <BlockedState
          verdict={attempt.verdict}
          reading={attempt.reading}
          radiusMetres={attempt.outlet.geofence_radius_m}
          outletName={outlets.length > 1 ? attempt.outlet.name : null}
          busy={busy}
          onRequest={() => void prepareCheckIn(attempt.outlet, attempt.reading)}
          onDismiss={() => setAttempt({ kind: 'idle' })}
        />
      )}

      {attempt.kind === 'unlocatable' && (
        <UnlocatableState
          failure={attempt.failure}
          busy={busy}
          onRequest={() => void prepareCheckIn(outlet, null)}
          onRetry={() => void onCheckIn()}
        />
      )}

      {attempt.kind === 'which-outlet' && (
        <WhichOutletState
          failure={attempt.failure}
          outlets={outlets.filter((candidate) => candidate.is_active)}
          busy={busy}
          onChoose={(chosen) => void prepareCheckIn(chosen, null)}
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

      <RetryConfirmation
        attempt={attempt}
        onKeep={() => setAttempt({ kind: 'idle' })}
        onUse={() => {
          if (attempt.kind === 'confirm') void commitCheckIn(attempt.outlet, attempt.reading)
        }}
      />

      <PrimaryAction
        phase={phase}
        waiting={record !== null && isWaitingForApproval(record)}
        retry={
          record?.retry.allowed === true &&
          outlets.some(
            (candidate) =>
              candidate.is_active &&
              businessDateForOutlet(context, candidate) === record.businessDate,
          )
        }
        locating={attempt.kind === 'locating'}
        busy={busy}
        blocked={
          attempt.kind === 'blocked' ||
          attempt.kind === 'unlocatable' ||
          attempt.kind === 'which-outlet' ||
          attempt.kind === 'confirm'
        }
        onCheckIn={() => void onCheckIn()}
      />
    </Card>
  )
}

/**
 * What the card is showing. There is no open-and-then-closed day any more: an
 * arrival is recorded once, and after that the only question is whether a
 * manager has settled it.
 */
type CardPhase =
  /** Nothing recorded here today. */
  | 'not-started'
  /** An arrival is recorded — waiting for a manager, or already approved. */
  | 'recorded'
  /** A row with no arrival at all: a manager marked leave, or an absence. */
  | 'marked'

function cardPhase(record: AttendanceRecord | null): CardPhase {
  if (!record) return 'not-started'
  return record.checkIn ? 'recorded' : 'marked'
}

/**
 * The one big button. Deliberately the only primary action on the screen: an
 * Employee's home is a phone held one-handed, often on the way in.
 */
function PrimaryAction({
  phase,
  waiting,
  retry,
  locating,
  busy,
  blocked,
  onCheckIn,
}: {
  phase: CardPhase
  /** Recorded, and no manager has settled it yet. */
  waiting: boolean
  retry: boolean
  locating: boolean
  busy: boolean
  blocked: boolean
  onCheckIn: () => void
}) {
  if (locating || busy) {
    return (
      <Button size="tile" className="w-full" disabled data-testid="attendance-action">
        <LoaderCircle aria-hidden size={20} className="animate-spin" />
        {locating ? 'Finding your position…' : 'Saving…'}
      </Button>
    )
  }

  if (phase === 'recorded') {
    /*
      Never "your day is done". A recorded arrival counts as nothing until a
      manager approves it, and a screen that implied otherwise would be the one
      thing this change exists to stop.

      And no second action, for anybody. A day belongs to the person, so
      somebody who works at two shops has one day like everybody else, and an
      offer to start another would invite a row the database refuses
      (attendance-one-day-per-person).
    */
    if (retry) {
      return (
        <div className="space-y-2">
          <p
            data-testid={waiting ? 'attendance-waiting' : 'attendance-retry-open'}
            className="text-center text-sm text-content-muted"
          >
            {waiting
              ? 'Your arrival is recorded and is waiting for your manager to approve it.'
              : 'This day is absent. A new check-in will also need manager approval.'}
          </p>
          <Button size="tile" className="w-full" onClick={onCheckIn} data-testid="attendance-retry">
            <LogIn aria-hidden size={20} />
            Check in again
          </Button>
        </div>
      )
    }
    return (
      <p
        data-testid={waiting ? 'attendance-waiting' : 'attendance-approved'}
        className={
          waiting
            ? 'flex items-center justify-center gap-2 rounded-lg border border-warning bg-surface-raised px-4 py-3 text-sm font-semibold text-content'
            : 'flex items-center justify-center gap-2 rounded-lg border border-border bg-surface-raised px-4 py-3 text-sm font-semibold text-content'
        }
      >
        <Hourglass aria-hidden size={16} />
        {waiting
          ? 'Your arrival is recorded and is waiting for your manager to approve it.'
          : 'Your manager has approved today. Another check-in is not available.'}
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

function RetryConfirmation({
  attempt,
  onKeep,
  onUse,
}: {
  attempt: Attempt
  onKeep: () => void
  onUse: () => void
}) {
  const open = attempt.kind === 'confirm'
  const changes = attempt.kind === 'confirm' ? attempt.changes : []
  return (
    <FormSheet
      open={open}
      onClose={onKeep}
      title="Use this new check-in?"
      footer={
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" size="phone" onClick={onKeep}>
            Keep existing check-in
          </Button>
          <button
            type="button"
            onClick={onUse}
            className={buttonVariants({ size: 'phone' })}
            data-testid="confirm-retry"
          >
            Use new check-in
          </button>
        </div>
      }
    >
      <p className="text-sm text-content-muted">
        This keeps the earlier evidence and adds a new manager review. These facts will change:
      </p>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-content">
        {changes.map((change) => (
          <li key={change}>{change}</li>
        ))}
      </ul>
    </FormSheet>
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
        Phone locations drift, especially indoors. If you are at work, record it anyway — your
        manager will see this reading and decide. Because it was taken away from the outlet, they
        will have to give a reason when they approve it, and it will be stored on your day.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="phone" onClick={onRequest} disabled={busy} data-testid="request-override">
          Record it and ask my manager
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
        You can still record today without a position — it will wait for your manager to approve,
        and with no reading to vouch for you they will have to give a reason.
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
 * No position, and more than one shop it could be — so ask.
 *
 * The only place anybody chooses an outlet, and only because nothing else can
 * (design D5). Nothing is recorded until they press one: an abandoned attempt
 * leaves no row, exactly as a refused fence does. Each button says plainly what
 * pressing it means, because the row it writes carries no evidence at all and
 * their manager will be asked to vouch for it on their word.
 */
function WhichOutletState({
  failure,
  outlets,
  busy,
  onChoose,
  onRetry,
}: {
  failure: GeolocationFailureKind
  outlets: readonly Tables<'outlets'>[]
  busy: boolean
  onChoose: (outlet: Tables<'outlets'>) => void
  onRetry: () => void
}) {
  const copy = FAILURE_COPY[failure]

  return (
    <div
      role="group"
      aria-label="Which outlet are you at?"
      data-testid="attendance-which-outlet"
      data-failure={failure}
      className="space-y-3 rounded-xl border border-warning bg-surface-raised p-3"
    >
      <p className="flex items-center gap-2 font-semibold text-content">
        <MapPinOff aria-hidden size={18} className="text-warning" />
        {copy.title}
      </p>
      <p className="text-xs text-content-muted">{copy.advice}</p>
      <p className="text-sm text-content">
        You work at more than one shop, so tell us which one you are at. Nothing is recorded until
        you choose.
      </p>
      <div className="flex flex-wrap gap-2">
        {outlets.map((candidate) => (
          <Button
            key={candidate.id}
            size="phone"
            disabled={busy}
            data-testid={`choose-outlet-${candidate.id}`}
            onClick={() => onChoose(candidate)}
          >
            <LogIn aria-hidden size={16} />
            {candidate.name}
          </Button>
        ))}
        <Button variant="ghost" size="phone" onClick={onRetry} disabled={busy}>
          Try again
        </Button>
      </div>
      <p className="text-xs text-content-muted">
        With no position there is nothing to show you were there, so your manager at the shop you
        pick will have to give a reason when they approve it.
      </p>
    </div>
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
