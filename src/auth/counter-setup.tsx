import { useEffect, useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router'

import { buttonVariants } from '@/components/ui/button-variants'
import { Card, CardBody, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { LoadingShell } from '@/components/ui/loading'
import { CounterSetupError, setUpCounterDevice } from '@/data-access/auth'

import { useRealSessionContext } from './real-session-context'
import { UnconfirmedSession } from './unconfirmed-session'

/**
 * Setting a tablet up: one field, and it is not a password.
 *
 * This is the screen the whole "no password on shared hardware" decision exists
 * to produce. An admin generates a code on their own phone, walks to the
 * counter, and types it here. Nothing personal is entered on the tablet at
 * setup, and nothing personal is entered on it afterwards either — the shift
 * handshake keeps that promise for the rest of the tablet's life.
 *
 * **There is deliberately no password field anywhere in this tree**, and a test
 * asserts it: a text input that accepts a secret is the thing an observer behind
 * a counter is watching for, and the surest way not to have one is not to build
 * one.
 */
export function CounterSetup() {
  const navigate = useNavigate()
  const { state, revalidate } = useRealSessionContext()

  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [accepted, setAccepted] = useState(false)

  // Leave only once the session says it is a tablet, for the reason SignIn
  // leaves only once the session resolves: accepted credentials and a resolved
  // session are two different moments, and navigating on the first lands in a
  // resolver that still believes the second.
  useEffect(() => {
    if (!accepted) return
    if (state.status !== 'counter') return
    navigate('/counter', { replace: true })
  }, [accepted, state.status, navigate])

  if (state.status === 'loading') return <LoadingShell />
  if (state.status === 'unavailable') return <UnconfirmedSession onRetry={revalidate} />

  // Already a tablet. Setting one up twice is not a thing to warn about; it is a
  // thing to skip.
  if (state.status === 'counter' && !accepted) return <Navigate to="/counter" replace />

  // Anybody signed in as a person is on the wrong device or the wrong URL. Their
  // own shell knows where they belong.
  if (state.status === 'ready') return <Navigate to="/" replace />

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await setUpCounterDevice(code)
      setAccepted(true)
      revalidate()
    } catch (cause) {
      setError(
        cause instanceof CounterSetupError
          ? cause.message
          : 'Could not set this tablet up right now. Try again in a moment.',
      )
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-dvh flex-1 items-center justify-center bg-canvas p-4 text-content">
      <Card className="w-full max-w-md">
        <CardTitle>Set up this tablet</CardTitle>
        <CardBody>
          <p className="mb-4">
            Ask a manager or the owner to generate a setup code on their own phone, then type it
            here. This tablet never asks anybody for a password.
          </p>

          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <div className="space-y-1">
              <label htmlFor="counter-setup-code" className="block text-sm font-semibold">
                Setup code
              </label>
              <Input
                id="counter-setup-code"
                name="setup-code"
                type="text"
                inputMode="text"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                required
                value={code}
                onChange={(event) => setCode(event.target.value)}
                className="font-mono text-lg tracking-widest"
              />
            </div>

            {error && (
              <p
                data-testid="counter-setup-error"
                role="alert"
                className="text-sm font-semibold text-danger"
              >
                {error}
              </p>
            )}

            <button type="submit" disabled={busy} className={buttonVariants({ size: 'phone' })}>
              {busy ? 'Setting up…' : 'Set up'}
            </button>
          </form>
        </CardBody>
      </Card>
    </div>
  )
}
