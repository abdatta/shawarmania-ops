import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'

import { buttonVariants } from '@/components/ui/button-variants'
import { Card, CardBody, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useAdapters } from '@/data-access'
import { DataActionError, type IssuedShiftRequest } from '@/data-access/adapters'
import { useCounterDevice } from '@/session/counter-context'

/**
 * The tablet's own screen: ask for somebody, then show them four digits.
 *
 * **No password is ever typed here.** The tablet holds no secret belonging to
 * any person and learns nothing about them from the response: an unknown
 * username produces exactly the same code, the same waiting state and the same
 * timeout as a real one that is never confirmed. Nothing in this file branches
 * on whether the name was recognised, because nothing in the response says.
 *
 * The waiting state is the substantive piece of design here. The digits are
 * rendered as large as a counter tablet allows, because the person approving is
 * standing on the other side of it reading them off — that is the whole property
 * the code buys, and a code nobody can read across a counter buys nothing.
 */

interface Waiting extends IssuedShiftRequest {
  username: string
}

/** How often the tablet asks whether its own request has been answered. */
const POLL_MS = 2000

export function ShiftRequestScreen({
  onOpened,
  onGiveUp,
}: {
  onOpened: () => void
  /**
   * Present only during a handover: the shift on this tablet is still live, and
   * this abandons the handover and goes back to it. Absent when there is no
   * shift, because there is nothing to go back to.
   */
  onGiveUp?: (() => void) | undefined
}) {
  const { counter } = useAdapters()
  const device = useCounterDevice()

  const [username, setUsername] = useState('')
  const [waiting, setWaiting] = useState<Waiting | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<string | null>(null)
  const nameField = useRef<HTMLInputElement>(null)

  const stopWaiting = useCallback((reason: string | null) => {
    setWaiting(null)
    setOutcome(reason)
    setUsername('')
    setBusy(false)
  }, [])

  /**
   * Watch the request resolve, without anybody touching the tablet.
   *
   * Realtime is the fast path and the poll is the floor. Both are here on
   * purpose: the tablet is the one device in this system that nobody is holding,
   * so a channel that quietly stops delivering would leave a code on screen and
   * an operator standing there tapping it. A two-second poll costs one small
   * query while a request is open and nothing at all the rest of the time.
   */
  useEffect(() => {
    if (!waiting) return
    let active = true

    const check = () => {
      void counter
        .getRequestResolution(waiting.requestId)
        .then((resolution) => {
          if (!active || resolution === null) return
          if (resolution === 'confirmed') {
            onOpened()
            return
          }
          stopWaiting(
            resolution === 'rejected'
              ? 'That was rejected. Check the name and ask again.'
              : resolution === 'exhausted'
                ? 'Too many wrong codes. Ask again for a fresh one.'
                : resolution === 'not_eligible'
                  ? 'That person is not set up to bill at this outlet.'
                  : 'That request is no longer waiting.',
          )
        })
        .catch(() => undefined)
    }

    const unsubscribe = counter.subscribeToDeviceHandshake(device.device.deviceId, check)
    const timer = window.setInterval(check, POLL_MS)
    // The request dies by itself; the screen has to say so rather than sit on a
    // code nobody can use any more.
    const expiry = window.setTimeout(
      () => stopWaiting('Nobody answered in time. Ask again.'),
      Math.max(0, Date.parse(waiting.expiresAt) - Date.now()),
    )

    return () => {
      active = false
      unsubscribe()
      window.clearInterval(timer)
      window.clearTimeout(expiry)
    }
  }, [waiting, counter, device.device.deviceId, onOpened, stopWaiting])

  useEffect(() => {
    if (!waiting) nameField.current?.focus()
  }, [waiting])

  async function ask(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setOutcome(null)
    try {
      const issued = await counter.requestShift(username.trim())
      setWaiting({ ...issued, username: username.trim() })
    } catch (cause) {
      setError(
        cause instanceof DataActionError
          ? cause.message
          : 'Could not ask right now. Try again in a moment.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function cancel() {
    setBusy(true)
    try {
      await counter.cancelRequest()
    } catch {
      // Either it was withdrawn or it had already gone. Both leave this screen
      // in the same place, and the tablet is not the party who needs to know.
    }
    stopWaiting(null)
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas p-6 text-content">
      <Card className="w-full max-w-xl">
        {waiting ? (
          <>
            <CardTitle>Waiting for {waiting.username}</CardTitle>
            <CardBody className="space-y-4">
              <p>
                Ask them to open Shawarmania on their own phone and type this code. It is only good
                for the next couple of minutes.
              </p>
              <p
                data-testid="counter-shift-code"
                aria-label={`Confirmation code ${waiting.code.split('').join(' ')}`}
                className="text-center font-mono text-7xl font-bold tracking-[0.2em] text-content sm:text-8xl"
              >
                {waiting.code}
              </p>
              <button
                type="button"
                onClick={cancel}
                disabled={busy}
                className={buttonVariants({ variant: 'secondary', size: 'phone' })}
              >
                Cancel
              </button>
            </CardBody>
          </>
        ) : (
          <>
            <CardTitle>{device.device.label}</CardTitle>
            <CardBody className="space-y-4">
              <p>
                {onGiveUp
                  ? 'Type the username of the person taking over. The counter stays open under its ' +
                    'current operator until they approve it on their own phone.'
                  : 'Nobody is on this counter. Type the username of the person taking it, then ' +
                    'have them approve it on their own phone.'}
              </p>

              {outcome && (
                <p
                  role="status"
                  data-testid="counter-request-outcome"
                  className="rounded-lg border border-border bg-surface-raised p-3 text-sm"
                >
                  {outcome}
                </p>
              )}

              <form onSubmit={ask} className="space-y-3" noValidate>
                <div className="space-y-1">
                  <label htmlFor="counter-username" className="block text-sm font-semibold">
                    Username
                  </label>
                  <Input
                    ref={nameField}
                    id="counter-username"
                    name="counter-username"
                    type="text"
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    required
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    className="text-lg"
                  />
                </div>

                {error && (
                  <p role="alert" className="text-sm font-semibold text-danger">
                    {error}
                  </p>
                )}

                <div className="flex flex-wrap gap-2">
                  <button
                    type="submit"
                    disabled={busy || username.trim() === ''}
                    className={buttonVariants({ size: 'phone' })}
                  >
                    {busy ? 'Asking…' : 'Ask to open the counter'}
                  </button>
                  {onGiveUp && (
                    <button
                      type="button"
                      onClick={onGiveUp}
                      disabled={busy}
                      className={buttonVariants({ variant: 'secondary', size: 'phone' })}
                    >
                      Back to the counter
                    </button>
                  )}
                </div>
              </form>
            </CardBody>
          </>
        )}
      </Card>
    </div>
  )
}
