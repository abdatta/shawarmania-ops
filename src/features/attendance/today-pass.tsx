import {
  CircleSlash,
  Clock,
  LoaderCircle,
  LogIn,
  MapPin,
  MapPinOff,
  CircleX,
  X,
} from 'lucide-react'
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { Card } from '@/components/ui/card'
import type { AttendanceRecord } from '@/data-access/adapters'
import type { Tables } from '@/data-access'
import {
  formatBusinessWeekday,
  formatMetres,
  formatTime,
  instantOnBusinessDay,
  type FenceVerdict,
} from '@/domain'
import type { GeolocationFailureKind, PositionReading } from '@/lib/geolocation'

import { TallySummary } from './day-range-list'
import {
  STATUS_LABELS,
  isAbsence,
  isWaitingForApproval,
  type AttendanceTally,
} from './attendance-record'
import { AbsenceReason, LateTag } from './evidence'

/**
 * Today, as a pass the person carries: the date and the shop, when they are
 * expected, whether they are in and whether it counted, and one action at the
 * bottom of the card where a thumb reaches it
 * (a-check-in-at-the-shop-approves-itself, design D7; `refreshed-staff-screens`).
 *
 * Presentational. Everything that decides — reading a position, judging the
 * fence, writing — stays in `CheckInCard`, whose state this draws: a
 * different screen over the same machine, so turning the gate off puts back
 * the old screen and changes nothing about what a check-in does.
 *
 * Every problem is one sentence and one decision. The numbers behind it are a
 * tap away under **Why?**, because the person needs to know what to do, and the
 * manager, who reads the same day on the roll-call, keeps the numbers.
 *
 * A check-in with nothing to decide never leaves the card: the button spins
 * while the phone reads and the row saves, and the day appears. A decision
 * (away from the shop, no position, which shop) opens a popup in the middle of
 * the screen, where the button that was pressed was, and the button pressed
 * there spins in its turn: no screen in between says what is being read
 * [owner, 2026-10-28]. Closing the popup is **Not now**: nothing is written.
 * While a reading or a save is in flight it does not close, because the
 * reading would only land and open it again.
 */

/** What the popup's buttons need to know: whether to wait, and which one spins. */
const Pressing = createContext<{
  working: boolean
  pressed: string | null
  press: (key: string, action: () => void) => () => void
}>({ working: false, pressed: null, press: (_key, action) => action })

function isDecision(attempt: PassAttempt): boolean {
  return (
    attempt.kind === 'blocked' ||
    attempt.kind === 'unlocatable' ||
    attempt.kind === 'which-outlet' ||
    attempt.kind === 'error'
  )
}

/** What the card is in the middle of, mirrored from `CheckInCard`'s own state. */
export type PassAttempt =
  | { kind: 'idle' }
  | { kind: 'locating' }
  | {
      kind: 'blocked'
      verdict: Extract<FenceVerdict, { kind: 'outside' }>
      reading: PositionReading
      outlet: Tables<'outlets'>
    }
  | { kind: 'unlocatable'; failure: GeolocationFailureKind }
  | { kind: 'which-outlet'; failure: GeolocationFailureKind }
  | { kind: 'confirm' }
  | { kind: 'error'; message: string }

export interface TodayPassProps {
  /** Today's business date, as the outlet reckons it. */
  businessDate: string
  /** The outlet the card is about, and every outlet the person works at. */
  outlet: Tables<'outlets'>
  outlets: readonly Tables<'outlets'>[]
  /** The backend's now, for whether the deadline has passed. */
  serverAt: string
  record: AttendanceRecord | null
  late: boolean
  attempt: PassAttempt
  /** The reading improving while the phone keeps reading, if it is. */
  refining: PositionReading | null
  busy: boolean
  /** Whether another check-in may be sent for today. */
  retry: boolean
  /** Whether the outlet's rules refuse a check-in away from the shop. */
  blocksAway: (outlet: Tables<'outlets'>) => boolean
  /** This month so far, or null while it is read. */
  month: AttendanceTally | null
  /** The retry confirmation sheet, which the card owns. */
  confirmation: ReactNode
  onCheckIn: () => void
  onRecord: (outlet: Tables<'outlets'>, reading: PositionReading | null) => void
  onChoose: (outlet: Tables<'outlets'>) => void
  onDismiss: () => void
}

/**
 * Has the browser already said no to location? Asked once, where the browser
 * can be asked, so a denied permission is explained before the button is
 * pressed rather than after. Unknown is not denied: a browser with no
 * Permissions API simply asks when the button is pressed, as it always has.
 */
function useLocationDenied(): boolean {
  const [denied, setDenied] = useState(false)
  useEffect(() => {
    const permissions = typeof navigator === 'undefined' ? undefined : navigator.permissions
    if (!permissions?.query) return
    let active = true
    let status: PermissionStatus | null = null
    const update = () => {
      if (active && status) setDenied(status.state === 'denied')
    }
    permissions
      .query({ name: 'geolocation' })
      .then((answer) => {
        status = answer
        update()
        answer.addEventListener('change', update)
      })
      .catch(() => {})
    return () => {
      active = false
      status?.removeEventListener('change', update)
    }
  }, [])
  return denied
}

/** `1:00 pm`, not `01:00 pm`: a time said out loud, on the person's own screen. */
function clock(instant: string): string {
  return formatTime(instant).replace(/^0/, '')
}

export function TodayPass(props: TodayPassProps) {
  const { record, outlet, outlets, attempt, busy, businessDate } = props
  const locationDenied = useLocationDenied()
  const shop =
    record?.outletName ??
    (outlets.length > 1 ? outlets.map((o) => o.name).join(' · ') : outlet.name)
  const deadline = instantOnBusinessDay(
    businessDate,
    outlet.arrival_deadline,
    outlet.business_day_cutover,
  )
  const pastDeadline = props.serverAt > deadline
  // Rechecking a day already waiting from away only matters if it turns the
  // answer to inside. Still away, or no position: nothing is saved and no
  // question is asked, just a line under the link [owner, 2026-10-28: "the
  // useful information is the Boolean state"].
  const recheckMissed =
    record !== null &&
    isWaitingForApproval(record) &&
    (attempt.kind === 'blocked' ||
      attempt.kind === 'unlocatable' ||
      attempt.kind === 'which-outlet')
  const panel = isDecision(attempt) && !recheckMissed
  const working = attempt.kind === 'locating' || busy
  // Check in again reads afresh, and the card's machine says so by going back
  // to locating; the decision it was pressed from stays up, spinning, until the
  // new answer replaces it or the day is in.
  const [held, setHeld] = useState<PassAttempt | null>(null)
  const shown = panel ? attempt : attempt.kind === 'locating' ? held : null
  if (shown !== held) setHeld(shown)
  const [pressed, setPressed] = useState<string | null>(null)
  if (shown === null && pressed !== null) setPressed(null)
  // The tick draws itself once, when the day turns approved while the card
  // is on screen; a day already approved when Home opens just shows it.
  const approved = record !== null && record.status === 'present' && !isWaitingForApproval(record)
  const [wasApproved, setWasApproved] = useState(approved)
  const [celebrate, setCelebrate] = useState(false)
  if (approved !== wasApproved) {
    setWasApproved(approved)
    setCelebrate(approved)
  }
  // The link comes back with a fade after a missed recheck, not a jump.
  const [wasMissed, setWasMissed] = useState(recheckMissed)
  const [backFromMiss, setBackFromMiss] = useState(false)
  if (recheckMissed !== wasMissed) {
    setWasMissed(recheckMissed)
    setBackFromMiss(!recheckMissed)
  }
  const pressing = {
    working,
    pressed,
    press: (key: string, action: () => void) => () => {
      setPressed(key)
      action()
    },
  }

  return (
    // As tall as what it says, with the button straight after it: an early
    // version held the button low for the thumb, and left a hole above it.
    <Card className="flex flex-col gap-4" data-testid="today-pass">
      <div>
        <h1 className="text-xl font-bold text-content" data-testid="today-pass-heading">
          {formatBusinessWeekday(businessDate)}
        </h1>
        <p data-testid="today-pass-shop" className="text-sm text-content-muted">
          {shop}
        </p>
        {!record?.checkIn && (
          <p data-testid="today-pass-deadline" className="mt-2 text-sm text-content">
            {pastDeadline
              ? `Not checked in · late since ${clock(deadline)}`
              : `Late after ${clock(deadline)}`}
          </p>
        )}
      </div>

      {outlet.latitude === null && !record && (
        <p className="text-sm text-content-muted">Your manager approves check-ins here.</p>
      )}

      {locationDenied && !record && !panel && <LocationHelp intro="Location is off for this app" />}

      {/* The month as My attendance counts it in production today [owner, 2026-10-27]. */}
      {props.month && (
        <section data-testid="today-pass-month" aria-label="This month" className="[&_dl]:mb-0">
          <h3 className="mb-1.5 text-xs font-semibold text-content-muted">This month</h3>
          <TallySummary tally={props.month} />
        </section>
      )}

      {props.confirmation}

      {/* Where Check in was pressed is where the day appears: the button has
          done its work, and the answer belongs where the thumb still is. */}
      {record && (
        <DayLine record={record} late={props.late} outlets={outlets} celebrate={celebrate} />
      )}

      {recheckMissed ? (
        <RecheckMissed
          words={
            attempt.kind === 'blocked' ? 'Still not at the shop' : 'Couldn’t get your location'
          }
          onDone={props.onDismiss}
        />
      ) : (
        <FadeIn play={backFromMiss}>
          <PassAction {...props} />
        </FadeIn>
      )}

      {/* Centred, as the app's yes-or-no popups are: the button pressed was in
          the middle of the card, and the question follows it there. */}
      <Modal
        open={shown !== null}
        // A dialog fires close when the app shuts it too, as it does on the way
        // to the confirmation sheet; only a person shutting a decision is Not now.
        onClose={() => {
          if (!working && panel) props.onDismiss()
        }}
        dismissOnOutsideTap={!working}
        aria-label="Check in"
        className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-xl p-4"
      >
        <Pressing.Provider value={pressing}>
          <div data-testid="check-in-steps" className="space-y-3">
            <div className="-mt-1 -mr-2 flex items-center justify-between">
              <h2 className="text-base font-semibold text-content">Check in</h2>
              <Button
                variant="ghost"
                size="phone"
                aria-label="Close"
                disabled={working}
                onClick={props.onDismiss}
              >
                <X aria-hidden size={18} />
              </Button>
            </div>

            {shown?.kind === 'blocked' && (
              <AwayPanel
                verdict={shown.verdict}
                reading={shown.reading}
                outlet={shown.outlet}
                named={outlets.length > 1}
                blocked={props.blocksAway(shown.outlet)}
                busy={working}
                onRecord={() => props.onRecord(shown.outlet, shown.reading)}
                onLater={props.onDismiss}
              />
            )}

            {shown?.kind === 'unlocatable' && (
              <NoLocationPanel
                failure={shown.failure}
                blocked={props.blocksAway(outlet)}
                busy={working}
                onRecord={() => props.onRecord(outlet, null)}
                onLater={props.onDismiss}
              />
            )}

            {shown?.kind === 'which-outlet' && (
              <WhichShopPanel
                failure={shown.failure}
                outlets={outlets.filter((candidate) => candidate.is_active)}
                blocksAway={props.blocksAway}
                busy={working}
                onChoose={props.onChoose}
                onLater={props.onDismiss}
              />
            )}

            {shown?.kind === 'error' && (
              <p
                role="alert"
                data-testid="attendance-error"
                className="text-sm font-semibold text-danger"
              >
                {shown.message}
              </p>
            )}
          </div>
        </Pressing.Provider>
      </Modal>
    </Card>
  )
}

/** Where the check-in was, in the person's words rather than the manager's. */
export function PlaceChip({
  event,
  outlet,
}: {
  event: AttendanceRecord['checkIn']
  outlet: Pick<Tables<'outlets'>, 'geofence_radius_m'> | undefined
}) {
  if (!event || event.source === 'manual') return null
  const distance = event.distanceMetres
  const atShop = distance !== null && outlet !== undefined && distance <= outlet.geofence_radius_m
  const Icon = distance === null ? MapPinOff : MapPin
  const words =
    distance === null ? 'No location' : atShop ? 'At the shop' : `${formatMetres(distance)} away`
  return (
    <span
      data-testid="place-chip"
      className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs font-semibold text-content"
    >
      <Icon aria-hidden size={12} />
      {words}
    </span>
  )
}

/**
 * A tick that draws itself: the circle goes round, then the check is made,
 * with a small swell at the end [owner, 2026-10-28: "a success feeling comes
 * when I see that animation"]. Drawn with the Web Animations API so it needs
 * no stylesheet, and still, already drawn, for anyone who asks the phone for
 * less motion, or when it is not the moment of checking in.
 */
function SuccessTick({ play }: { play: boolean }) {
  const ring = useRef<SVGCircleElement>(null)
  const check = useRef<SVGPathElement>(null)
  const whole = useRef<SVGSVGElement>(null)
  useEffect(() => {
    if (!play || !ring.current || !check.current || !whole.current) return
    if (typeof ring.current.animate !== 'function') return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    // Hidden until each stroke starts: a round cap draws a dot even at no length.
    const draw = [
      { strokeDashoffset: 1, opacity: 0 },
      { strokeDashoffset: 0.98, opacity: 1, offset: 0.04 },
      { strokeDashoffset: 0, opacity: 1 },
    ]
    ring.current.animate(draw, { duration: 520, easing: 'ease-out', fill: 'backwards' })
    check.current.animate(draw, {
      duration: 340,
      delay: 460,
      easing: 'ease-out',
      fill: 'backwards',
    })
    whole.current.animate(
      [{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }],
      { duration: 280, delay: 780, easing: 'ease-out' },
    )
  }, [play])
  return (
    <svg
      ref={whole}
      aria-hidden
      data-testid="success-tick"
      data-play={play || undefined}
      viewBox="0 0 40 40"
      className="size-10 shrink-0 text-success"
    >
      <circle
        ref={ring}
        cx="20"
        cy="20"
        r="17"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        pathLength={1}
        strokeDasharray="1"
        transform="rotate(-90 20 20)"
      />
      <path
        ref={check}
        d="M12.5 20.5l5 5 10-11"
        fill="none"
        stroke="currentColor"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={1}
        strokeDasharray="1"
      />
    </svg>
  )
}

/**
 * Today, where the Check in button was: in or not, when, and whether it
 * counted, as one tile with the state's mark beside it.
 */
function DayLine({
  record,
  late,
  outlets,
  celebrate,
}: {
  record: AttendanceRecord
  late: boolean
  outlets: readonly Tables<'outlets'>[]
  /** Draw the tick: the day has just turned approved. */
  celebrate: boolean
}) {
  const waiting = isWaitingForApproval(record)
  const outlet = outlets.find((candidate) => candidate.id === record.outletId)
  const latest = record.decisions.find((decision) => decision.id === record.latestDecisionId)

  if (!record.checkIn) {
    return (
      <p data-testid="today-pass-marked" className="flex items-center gap-2 text-base text-content">
        <CircleSlash aria-hidden size={20} className="text-content-muted" />
        {STATUS_LABELS[record.status]} · recorded by your manager
      </p>
    )
  }

  const settledBy =
    latest?.kind === 'auto_approved'
      ? 'Approved'
      : record.checkIn.source === 'manual'
        ? `Recorded by ${record.checkIn.enteredByName ?? 'your manager'}`
        : record.approval
          ? `Approved by ${record.approval.byName ?? 'your manager'}`
          : 'Approved'

  const state = waiting
    ? 'waiting'
    : record.status === 'present'
      ? 'approved'
      : record.status === 'absent'
        ? 'absent'
        : 'other'

  return (
    <div
      data-testid="today-pass-day"
      data-state={state}
      // Centred, as the Check in button it replaces was: the tile reads as that
      // button having become the answer, not as a row of a list [owner, 2026-10-28].
      className="flex items-center justify-center gap-3 rounded-xl border border-border bg-surface-raised p-3"
    >
      {state === 'approved' && <SuccessTick play={celebrate} />}
      {state === 'waiting' && (
        <Clock aria-hidden size={40} strokeWidth={1.5} className="shrink-0 text-content-muted" />
      )}
      {state === 'absent' && (
        <CircleX aria-hidden size={40} strokeWidth={1.5} className="shrink-0 text-danger" />
      )}
      <div className="min-w-0 space-y-1">
        <p className="flex flex-wrap items-center justify-center gap-2 text-base font-semibold text-content">
          Checked in {clock(record.checkIn.at)}
          {late && <LateTag />}
        </p>
        <p className="flex flex-wrap items-center justify-center gap-2 text-sm text-content">
          {state === 'approved' && <span data-testid="today-pass-approved">{settledBy}</span>}
          {state === 'waiting' && (
            <span data-testid="attendance-waiting">
              {isAbsence(record)
                ? 'Absent until your manager approves this new check-in'
                : 'Waiting for your manager'}
            </span>
          )}
          {state === 'absent' && <span className="font-semibold text-danger">Absent</span>}
          {state === 'other' && <span>{STATUS_LABELS[record.status]}</span>}
          <PlaceChip event={record.checkIn} outlet={outlet} />
        </p>
        {state === 'absent' && (
          <AbsenceReason reading={{ kind: 'recorded', record }} subjectId={record.personId} />
        )}
      </div>
    </div>
  )
}

/** How long a missed recheck answers in the link's place before the link returns. */
const RECHECK_MISSED_MS = 3_000
const FADE_MS = 300

function motionAllowed(element: Element | null): element is HTMLElement {
  return (
    element instanceof HTMLElement &&
    typeof element.animate === 'function' &&
    !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  )
}

/**
 * A recheck that is still away answers where it was asked: the link becomes
 * the answer, in the alert colour, with one shake for no, then fades back to
 * the link [owner, 2026-10-28]. Words only, no fill: a filled shape reads as
 * something to press, and this is information. Three seconds is enough to read four words
 * the person is already looking at, and short enough that the link is back
 * before they reach for it again. Nothing is saved, so nothing is left behind.
 */
function RecheckMissed({ words, onDone }: { words: string; onDone: () => void }) {
  const box = useRef<HTMLDivElement>(null)
  const done = useRef(onDone)
  useEffect(() => {
    done.current = onDone
  })
  useEffect(() => {
    const element = box.current
    if (motionAllowed(element)) {
      element.animate(
        [
          { transform: 'translateX(0)' },
          { transform: 'translateX(-8px)' },
          { transform: 'translateX(7px)' },
          { transform: 'translateX(-5px)' },
          { transform: 'translateX(3px)' },
          { transform: 'translateX(0)' },
        ],
        { duration: 420, easing: 'ease-out' },
      )
      element.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: FADE_MS,
        delay: RECHECK_MISSED_MS - FADE_MS,
        fill: 'forwards',
      })
    }
    const timer = setTimeout(() => done.current(), RECHECK_MISSED_MS)
    return () => clearTimeout(timer)
  }, [])
  return (
    <div
      ref={box}
      role="status"
      data-testid="recheck-missed"
      className="flex h-[var(--size-control-phone)] w-full items-center justify-center gap-2 px-4 text-sm font-semibold text-danger"
    >
      <MapPinOff aria-hidden size={16} />
      {words}
    </div>
  )
}

/** Its children fading in once, when `play` is set as they appear. */
function FadeIn({ play, children }: { play: boolean; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (play && motionAllowed(box.current)) {
      box.current.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS })
    }
  }, [play])
  return (
    <div ref={box} className="empty:hidden">
      {children}
    </div>
  )
}

/** The one button at the foot of the card, when there is one. */
function PassAction({ record, attempt, busy, retry, onCheckIn }: TodayPassProps) {
  // The button spins while the phone reads and the row saves; nothing else
  // says what is being read.
  const working = attempt.kind === 'locating' || busy
  const icon = (Icon: typeof LogIn, size: number) =>
    working ? (
      <LoaderCircle aria-hidden size={size} className="animate-spin" />
    ) : (
      <Icon aria-hidden size={size} />
    )
  if (!record) {
    return (
      <Button
        size="tile"
        className="w-full"
        onClick={onCheckIn}
        disabled={working}
        data-testid="attendance-action"
      >
        {icon(LogIn, 20)}
        Check in
      </Button>
    )
  }
  if (!retry) return null
  // After checking in, a button only where another check-in can change the
  // answer [owner, 2026-10-28]: waiting from away, where arriving approves the
  // day, offered quietly; and a day marked absent, where another check-in is
  // the whole point. An approved day is done, however it was approved.
  if (!isWaitingForApproval(record) && record.status !== 'absent') return null
  return isWaitingForApproval(record) ? (
    <Button
      variant="ghost"
      size="phone"
      className="w-full"
      onClick={onCheckIn}
      disabled={working}
      data-testid="attendance-retry"
    >
      {icon(MapPin, 16)}
      Check my location again
    </Button>
  ) : (
    <Button
      size="tile"
      className="w-full"
      onClick={onCheckIn}
      disabled={working}
      data-testid="attendance-retry"
    >
      {icon(LogIn, 20)}
      Check in again
    </Button>
  )
}

/** The numbers behind a sentence, for whoever wants them. */
function Why({ rows }: { rows: readonly [string, string][] }) {
  return (
    <details className="text-sm" data-testid="attendance-why">
      <summary className="cursor-pointer font-semibold text-content-muted">Why?</summary>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-content-muted">{label}</dt>
            <dd className="text-content">{value}</dd>
          </div>
        ))}
      </dl>
    </details>
  )
}

/**
 * A reading outside the fence. A title and the decision, nothing else on the
 * face of it: the numbers are under Why? [owner, 2026-10-26: "text should be
 * less, so people are inclined to read it"].
 */
function AwayPanel({
  verdict,
  reading,
  outlet,
  named,
  blocked,
  busy,
  onRecord,
  onLater,
}: {
  verdict: Extract<FenceVerdict, { kind: 'outside' }>
  reading: PositionReading
  outlet: Tables<'outlets'>
  named: boolean
  blocked: boolean
  busy: boolean
  onRecord: () => void
  onLater: () => void
}) {
  const why = (
    <Why
      rows={[
        ['Your distance', formatMetres(verdict.distanceMetres)],
        ['The shop’s limit', formatMetres(outlet.geofence_radius_m)],
        ['Your phone’s accuracy', `±${formatMetres(reading.accuracyMetres)}`],
      ]}
    />
  )
  if (blocked) {
    return (
      <Panel
        testId="attendance-refused"
        icon={MapPinOff}
        tone="text-danger"
        title="Check-in denied"
      >
        <p className="text-sm text-content-muted">{DENIED}</p>
        {why}
        <Okay busy={busy} onLater={onLater} />
      </Panel>
    )
  }
  // The person's question is "am I checked in?", so the buttons are about
  // checking in. That a manager then approves it is a detail, said small
  // [owner, 2026-10-26].
  return (
    <Panel
      testId="attendance-blocked"
      icon={MapPin}
      tone="text-content-muted"
      title={named ? `You don’t seem to be at ${outlet.name}` : 'You don’t seem to be at the shop'}
    >
      <CheckInAnyway busy={busy} onConfirm={onRecord} />
      <NotNow busy={busy} onLater={onLater} />
      {why}
    </Panel>
  )
}

/** The confirmation, with the manager's part said small beneath it. */
function CheckInAnyway({ onConfirm }: { busy: boolean; onConfirm: () => void }) {
  return (
    <div className="space-y-1">
      <StepButton id="anyway" testId="request-override" onClick={onConfirm}>
        Check in anyway
      </StepButton>
      <p className="text-center text-xs text-content-muted">
        Your manager will need to approve it.
      </p>
    </div>
  )
}

/** One problem, as a titled panel: an icon, a few words, and its decision. */
function Panel({
  testId,
  icon: Icon,
  tone,
  title,
  children,
}: {
  testId: string
  icon: typeof MapPin
  tone: string
  title: string
  children: ReactNode
}) {
  return (
    <div data-testid={testId} className="space-y-3">
      <p className="flex items-center gap-2 text-base font-semibold text-content">
        <Icon aria-hidden size={20} className={`shrink-0 ${tone}`} />
        {title}
      </p>
      {children}
    </div>
  )
}

/**
 * A popup button that checks in. Pressed, it spins and every button waits:
 * the reading and the save show here, not on a screen of their own.
 */
function StepButton({
  id,
  testId,
  size = 'tile',
  icon = true,
  onClick,
  children,
}: {
  id: string
  testId: string
  size?: 'tile' | 'phone'
  icon?: boolean
  onClick: () => void
  children: ReactNode
}) {
  const { working, pressed, press } = useContext(Pressing)
  const spinning = working && pressed === id
  return (
    <Button
      size={size}
      className="w-full"
      onClick={press(id, onClick)}
      disabled={working}
      aria-busy={spinning || undefined}
      data-testid={testId}
    >
      {spinning ? (
        <LoaderCircle aria-hidden size={20} className="animate-spin" />
      ) : (
        icon && <LogIn aria-hidden size={20} />
      )}
      {children}
    </Button>
  )
}

/** The way out: nothing is written, and Home is back to its one button. */
function NotNow({ busy, onLater }: { busy: boolean; onLater: () => void }) {
  return (
    <Button
      variant="ghost"
      size="phone"
      className="w-full"
      onClick={onLater}
      disabled={busy}
      data-testid="attendance-not-now"
    >
      Not now
    </Button>
  )
}

/**
 * A refusal says so and has nothing to decide [owner, 2026-10-29]: no Check in
 * again, which on a refusal only brought the same popup back and looked like
 * nothing had happened. Home's own button is there for a try from elsewhere.
 */
const DENIED = 'You’re not at the shop. Ask your manager.'

/** A refusal with no position: denied first, then why there was none. */
function Denied({ children }: { children: ReactNode }) {
  return (
    <Panel testId="attendance-refused" icon={MapPinOff} tone="text-danger" title="Check-in denied">
      <p className="text-sm text-content-muted">{DENIED}</p>
      {children}
    </Panel>
  )
}

/** The only button on a refusal: it closes the popup, and nothing is written. */
function Okay({ busy, onLater }: { busy: boolean; onLater: () => void }) {
  return (
    <Button
      size="phone"
      className="w-full"
      onClick={onLater}
      disabled={busy}
      data-testid="attendance-okay"
    >
      OK
    </Button>
  )
}

/** How to turn location back on, folded away until somebody asks. */
function LocationHelp({ intro }: { intro: string }) {
  return (
    <div
      data-testid="location-help"
      className="space-y-2 rounded-xl border border-border bg-surface-raised p-3 text-sm"
    >
      <p className="flex items-center gap-2 text-base font-semibold text-content">
        <MapPinOff aria-hidden size={20} className="shrink-0 text-warning" />
        {intro}
      </p>
      <details>
        <summary className="cursor-pointer font-semibold text-content-muted">
          How to turn it on
        </summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-content">
          <li>
            App: hold its icon → <b>App info</b> → <b>Permissions</b> → <b>Location</b> →{' '}
            <b>Allow</b>
          </li>
          <li>
            Chrome: tap the icon left of the address → <b>Permissions</b> → <b>Location</b> →{' '}
            <b>Allow</b>
          </li>
        </ul>
      </details>
    </div>
  )
}

const NO_POSITION: Record<Exclude<GeolocationFailureKind, 'denied'>, string> = {
  // The phone gave no position, or none in time. Where to stand is the
  // person's business, not the app's [owner, 2026-10-28].
  unavailable: 'Couldn’t get your location',
  timeout: 'Couldn’t get your location',
  unsupported: 'This browser can’t share your location.',
}

/** Why there is no position, in a title, or how to turn location on. */
function NoPosition({ failure }: { failure: GeolocationFailureKind }) {
  return failure === 'denied' ? (
    <LocationHelp intro="Location is off for this app" />
  ) : (
    <p className="flex items-center gap-2 text-base font-semibold text-content">
      <MapPinOff aria-hidden size={20} className="shrink-0 text-warning" />
      {NO_POSITION[failure]}
    </p>
  )
}

function NoLocationPanel({
  failure,
  blocked,
  busy,
  onRecord,
  onLater,
}: {
  failure: GeolocationFailureKind
  blocked: boolean
  busy: boolean
  onRecord: () => void
  onLater: () => void
}) {
  return (
    <div data-testid="attendance-unlocatable" data-failure={failure} className="space-y-3">
      {blocked ? (
        <Denied>
          <NoPosition failure={failure} />
          <Okay busy={busy} onLater={onLater} />
        </Denied>
      ) : (
        <>
          <NoPosition failure={failure} />
          <CheckInAnyway busy={busy} onConfirm={onRecord} />
          <NotNow busy={busy} onLater={onLater} />
        </>
      )}
    </div>
  )
}

function WhichShopPanel({
  failure,
  outlets,
  blocksAway,
  busy,
  onChoose,
  onLater,
}: {
  failure: GeolocationFailureKind
  outlets: readonly Tables<'outlets'>[]
  blocksAway: (outlet: Tables<'outlets'>) => boolean
  busy: boolean
  onChoose: (outlet: Tables<'outlets'>) => void
  onLater: () => void
}) {
  // A shop that refuses check-ins with no position cannot be chosen without
  // one: offering it would be offering a refusal.
  const choosable = outlets.filter((candidate) => !blocksAway(candidate))
  return (
    <div
      role="group"
      aria-label="Which shop are you at?"
      data-testid="attendance-which-outlet"
      data-failure={failure}
      className="space-y-3"
    >
      {choosable.length > 0 && <NoPosition failure={failure} />}
      {choosable.length > 0 ? (
        <div className="space-y-2">
          <p className="text-sm font-semibold text-content">Check in anyway at:</p>
          <div className="grid gap-2">
            {choosable.map((candidate) => (
              <StepButton
                key={candidate.id}
                id={candidate.id}
                size="phone"
                icon={false}
                testId={`choose-outlet-${candidate.id}`}
                onClick={() => onChoose(candidate)}
              >
                {candidate.name}
              </StepButton>
            ))}
          </div>
          <p className="text-center text-xs text-content-muted">
            Your manager will need to approve it.
          </p>
          <NotNow busy={busy} onLater={onLater} />
        </div>
      ) : (
        <Denied>
          <NoPosition failure={failure} />
          <Okay busy={busy} onLater={onLater} />
        </Denied>
      )}
    </div>
  )
}
