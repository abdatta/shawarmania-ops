import { useEffect, useRef, useState, type FormEvent } from 'react'

import { Card, CardBody, CardTitle } from '@/components/ui/card'
import { buttonVariants } from '@/components/ui/button-variants'
import { Input } from '@/components/ui/input'
import { ConfirmDialog } from '@/components/layout/confirm-dialog'
import { useAdapters } from '@/data-access'
import { DataActionError } from '@/data-access/adapters'
import type { CounterShiftRequest, LiveCounterShift } from '@/data-access/adapters'
import { formatDateTime, formatTime } from '@/domain'

import { useCounterHandshake } from './use-counter-handshake'

/**
 * The counter, on the phone of the person it is asking for.
 *
 * Mounted on all three personal home surfaces, because any of the three roles
 * may be the person standing at a counter: an Employee holding a Biller
 * assignment, a manager covering an evening, the owner. It renders nothing at
 * all when there is nothing waiting, which is most of the time — this is a card
 * that appears, not a section that sits there empty.
 *
 * **The card names the tablet, and asks for the code that is on it.** Both
 * halves matter. A prompt that said only "somebody wants to open a counter"
 * would be the shape people tap through out of habit, which is exactly what the
 * code exists to stop; and a code that could be approved without reading the
 * tablet would prove nothing about where the person is standing.
 *
 * **Rejecting needs no code.** Saying "that was not me" is not an act anybody
 * should have to prove they were standing in front of a counter to take — and if
 * a request is a stranger at your counter, demanding you walk over and read
 * their screen before you can refuse them is precisely backwards.
 */
export function CounterHandshakeCards() {
  const { requests, shifts, reread } = useCounterHandshake()
  const withdrawn = useWithdrawnNotice(requests, shifts)

  if (requests.length === 0 && shifts.length === 0 && !withdrawn) return null

  return (
    <div className="mb-4 space-y-3">
      {withdrawn && (
        <Card data-testid="counter-request-withdrawn">
          <CardBody className="mt-0">{withdrawn}</CardBody>
        </Card>
      )}
      {requests.map((request) => (
        <ShiftRequestCard key={request.id} request={request} onSettled={reread} />
      ))}
      {shifts.length > 1 ? (
        <ShiftListCard shifts={shifts} onEnded={reread} />
      ) : (
        shifts.map((shift) => <LiveShiftCard key={shift.id} shift={shift} onEnded={reread} />)
      )}
    </div>
  )
}

/**
 * A card that leaves the screen says why it left.
 *
 * A request the tablet withdrew and a request that timed out both simply stop
 * being returned, and a card that vanishes mid-sentence reads as a glitch — or
 * worse, sends somebody to type four digits into a form that is no longer there.
 * The sentence deliberately does not claim **which** of the two happened,
 * because the read cannot tell them apart and guessing would be worse than not
 * saying.
 *
 * A request that ended because this person confirmed it is not announced: the
 * shift card appearing in its place says that far better.
 */
function useWithdrawnNotice(
  requests: CounterShiftRequest[],
  shifts: LiveCounterShift[],
): string | null {
  const shown = useRef<CounterShiftRequest[]>([])
  const [gone, setGone] = useState<CounterShiftRequest | null>(null)

  // Written in an effect, read in render, and never both in the same pass: the
  // notice is derived below from a request that WAS on screen and is not any
  // more, so the effect only has to remember what was there.
  useEffect(() => {
    const vanished = shown.current.find((was) => !requests.some((now) => now.id === was.id))
    shown.current = requests
    if (vanished) setGone(vanished)
  }, [requests])

  if (requests.length > 0) return null
  if (!gone) return null
  // Explained by the shift card that took its place, which says it better.
  if (shifts.some((shift) => shift.deviceId === gone.deviceId)) return null

  return (
    `That request from ${gone.deviceLabel ?? 'the counter tablet'} is no longer waiting. ` +
    'It was withdrawn at the tablet, or it timed out. Ask them to try again.'
  )
}

/** Somewhere between "just now" and "over a minute ago", which is all that is useful. */
function waitingFor(createdAt: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(createdAt)) / 1000))
  if (seconds < 10) return 'just now'
  if (seconds < 60) return `${seconds} seconds ago`
  return 'over a minute ago'
}

function ShiftRequestCard({
  request,
  onSettled,
}: {
  request: CounterShiftRequest
  onSettled: () => void
}) {
  const { counter } = useAdapters()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const codeField = useRef<HTMLInputElement>(null)

  // The card exists to have four digits typed into it, and it appeared while the
  // person was looking at something else. Putting the cursor where it is going
  // saves a tap during the only two minutes this card is alive.
  useEffect(() => {
    codeField.current?.focus()
  }, [])

  async function confirm(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await counter.confirmShift(request.id, code)
      onSettled()
    } catch (cause) {
      setError(
        cause instanceof DataActionError
          ? cause.message
          : `Could not open the ${request.kind === 'kitchen' ? 'kitchen' : 'counter'}. Try again in a moment.`,
      )
      setCode('')
      setBusy(false)
      // A destroyed request has to leave the screen, and only a re-read knows
      // whether it was destroyed or merely mistyped.
      onSettled()
    }
  }

  async function reject() {
    setBusy(true)
    setError(null)
    try {
      await counter.rejectRequest(request.id)
    } catch {
      // A request that could not be rejected is one that has already gone. The
      // re-read below says so more honestly than an error would.
    }
    onSettled()
  }

  const job = request.kind === 'kitchen' ? 'kitchen' : 'counter'

  return (
    <Card data-testid="counter-request-card" className="border-accent">
      <CardTitle>Open the {job}?</CardTitle>
      <CardBody className="space-y-3">
        <p className="text-content">
          {request.deviceLabel ?? `A ${job} tablet`}
          {request.outletName ? ` at ${request.outletName}` : ''} asked for you{' '}
          {waitingFor(request.createdAt)}.
        </p>
        <p>
          Type the four digits showing on that tablet. If you are not at that {job}, reject this.
        </p>

        <form onSubmit={confirm} className="flex flex-wrap items-end gap-2" noValidate>
          <div className="space-y-1">
            <label htmlFor={`counter-code-${request.id}`} className="block text-sm font-semibold">
              Code on the tablet
            </label>
            <Input
              ref={codeField}
              id={`counter-code-${request.id}`}
              name="counter-code"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              maxLength={4}
              required
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
              className="w-28 text-center font-mono text-2xl tracking-[0.4em]"
            />
          </div>
          <button
            type="submit"
            disabled={busy || code.length < 4}
            className={buttonVariants({ size: 'phone' })}
          >
            Open {job}
          </button>
          <button
            type="button"
            onClick={reject}
            disabled={busy}
            className={buttonVariants({ variant: 'secondary', size: 'phone' })}
          >
            Not me
          </button>
        </form>

        {error && (
          <p
            role="alert"
            data-testid="counter-request-error"
            className="text-sm font-semibold text-danger"
          >
            {error}
          </p>
        )}
      </CardBody>
    </Card>
  )
}

/**
 * A counter this person is accountable for right now.
 *
 * Ending it is a server-side state change and deliberately **not** a remote
 * wipe: the tablet discovers it at its next request and goes back to asking, and
 * anything already accepted on it stays where it is, because it is money that
 * was already taken.
 */
function LiveShiftCard({ shift, onEnded }: { shift: LiveCounterShift; onEnded: () => void }) {
  const { counter } = useAdapters()
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)

  async function end() {
    setBusy(true)
    try {
      await counter.endShift(shift.id)
    } catch {
      // Either it ended or it had already ended. Both mean the same to the
      // person holding the phone, and the re-read settles which.
    }
    setConfirming(false)
    onEnded()
  }

  const kitchen = shift.kind === 'kitchen'

  return (
    <Card data-testid="counter-shift-card">
      <CardTitle>{kitchen ? 'You have the kitchen open' : 'You are on the counter'}</CardTitle>
      <CardBody className="space-y-3">
        <p className="text-content">
          {shift.deviceLabel ?? (kitchen ? 'A kitchen tablet' : 'A counter tablet')}
          {shift.outletName ? ` at ${shift.outletName}` : ''}, since{' '}
          {formatDateTime(shift.openedAt)}.
          {kitchen
            ? ' It shows the orders for this kitchen until you leave or the day ends.'
            : ' Bills recorded before you leave use your shift. If the tablet is offline, later ' +
              'sales keep your name only as flagged last-known context.'}
        </p>
        <button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={busy}
          className={buttonVariants({ variant: 'secondary', size: 'phone' })}
        >
          {busy ? 'Leaving…' : kitchen ? 'Leave kitchen' : 'Leave counter'}
        </button>
        <LeaveDialog
          shift={shift}
          open={confirming}
          busy={busy}
          onClose={() => setConfirming(false)}
          onConfirm={() => void end()}
        />
      </CardBody>
    </Card>
  )
}

/**
 * Leaving one shift, said so it cannot be mistaken for the other (#70). A
 * kitchen's consequence is small and says so; a counter's keeps its warning
 * about sales an offline tablet records after.
 */
function LeaveDialog({
  shift,
  open,
  busy,
  onClose,
  onConfirm,
}: {
  shift: LiveCounterShift
  open: boolean
  busy: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  const kitchen = shift.kind === 'kitchen'
  const tablet = shift.deviceLabel ?? (kitchen ? 'the kitchen tablet' : 'the counter tablet')
  return (
    <ConfirmDialog
      open={open}
      title={kitchen ? `Leave the kitchen on ${tablet}?` : `Leave the counter on ${tablet}?`}
      consequence={
        kitchen
          ? 'The kitchen tablet stops showing orders and asks for a new shift. Nothing is lost.'
          : 'Your authority ends immediately. For an ordinary operator change, use Hand over on the tablet instead. If that tablet is offline, sales it records before learning you left remain under your shift as flagged last-known context for a manager to review.'
      }
      confirmLabel={busy ? 'Leaving…' : kitchen ? 'Leave kitchen' : 'Leave counter'}
      cancelLabel={kitchen ? 'Stay on kitchen' : 'Stay on counter'}
      busy={busy}
      onClose={onClose}
      onConfirm={onConfirm}
    />
  )
}

/**
 * Several shifts held at once — a counter and a kitchen, often (#70, design
 * D11). One compact card, grouped by outlet, a row per shift naming its kind,
 * tablet and start, each with its own Leave. Leaving one ends only that one.
 */
function ShiftListCard({ shifts, onEnded }: { shifts: LiveCounterShift[]; onEnded: () => void }) {
  const { counter } = useAdapters()
  const [leaving, setLeaving] = useState<LiveCounterShift | null>(null)
  const [busy, setBusy] = useState(false)
  const byOutlet = new Map<string, LiveCounterShift[]>()
  for (const shift of shifts) {
    const key = shift.outletName ?? shift.outletId
    byOutlet.set(key, [...(byOutlet.get(key) ?? []), shift])
  }

  async function end(shift: LiveCounterShift) {
    setBusy(true)
    try {
      await counter.endShift(shift.id)
    } catch {
      // Ended already or ended now; the re-read settles which.
    }
    setBusy(false)
    setLeaving(null)
    onEnded()
  }

  return (
    <Card data-testid="counter-shift-list">
      <CardTitle>Your shifts</CardTitle>
      <CardBody className="space-y-4">
        {[...byOutlet.entries()].map(([outlet, rows]) => (
          <section key={outlet} className="space-y-2">
            <h3 className="text-sm font-semibold text-content-muted">{outlet}</h3>
            <ul className="divide-y divide-border rounded-xl border border-border">
              {rows.map((shift) => (
                <li
                  key={shift.id}
                  data-testid={`counter-shift-row-${shift.kind ?? 'counter'}`}
                  className="flex items-center justify-between gap-3 px-3 py-2"
                >
                  <span className="text-content">
                    {shift.kind === 'kitchen' ? 'Kitchen' : 'Counter'} ·{' '}
                    {shift.deviceLabel ?? 'Tablet'} · since {formatTime(shift.openedAt)}
                  </span>
                  <button
                    type="button"
                    onClick={() => setLeaving(shift)}
                    disabled={busy}
                    className={buttonVariants({ variant: 'secondary', size: 'phone' })}
                  >
                    Leave
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {leaving && (
          <LeaveDialog
            shift={leaving}
            open
            busy={busy}
            onClose={() => setLeaving(null)}
            onConfirm={() => void end(leaving)}
          />
        )}
      </CardBody>
    </Card>
  )
}
