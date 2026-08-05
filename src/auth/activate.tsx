import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'

import { buttonVariants } from '@/components/ui/button-variants'
import { Card, CardBody, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  ActivationError,
  MIN_PASSWORD_LENGTH,
  previewInvite,
  redeemInvite,
  signIn,
} from '@/data-access/auth'
import { canonicalUsername } from '../../shared/username'

import { useRealSessionContext } from './real-session-context'

/**
 * Three states, and none of them asks for a code.
 *
 * There used to be a fourth that did, and it contradicted a requirement already
 * in force: the code SHALL NOT be typed. The issuing panel hands over a QR, the
 * link, and a copy action, and deliberately never prints a raw code — so the form
 * asked for a value nobody is given, and the only way to fill it was to read it
 * out of a URL you already had (the-root-resolves-instead-of-greeting, design
 * D8).
 *
 * So a mount with no `?code=` is `dead`, and says the link is **incomplete**
 * rather than invalid. Those are different facts and the person can act on the
 * first one: open the whole link, or ask for a new one.
 */
type State =
  | { kind: 'checking' }
  | { kind: 'form'; code: string; username: string }
  | { kind: 'dead'; message: string; title?: string }

/**
 * An address with no code at all, told apart from a code that will not work.
 * "This link will not work" would send somebody to ask for a replacement for a
 * link that is probably fine, when what happened is that they opened part of it.
 */
const INCOMPLETE_LINK = {
  title: 'This link is incomplete',
  message:
    'This address is missing its one-time code. Open the whole link your admin sent you, or ask them for a new one.',
} as const

function deadMessage(cause: unknown): string {
  return cause instanceof ActivationError
    ? cause.message
    : 'Could not check that link right now. Try again in a moment.'
}

export function Activate() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const linkCode = params.get('code')
  const [state, setState] = useState<State>(
    linkCode ? { kind: 'checking' } : { kind: 'dead', ...INCOMPLETE_LINK },
  )
  const [typedUsername, setTypedUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [accepted, setAccepted] = useState(false)
  const { state: session, revalidate } = useRealSessionContext()

  /**
   * The same wait sign-in does, for the same reason: a redeemed code and a
   * resolved session are two moments, and the root acts on whichever answer the
   * provider currently holds. Leaving before it has caught up meant arriving at
   * a resolver that still read `anonymous` and being sent to sign-in, having
   * just set a password (design D11).
   */
  useEffect(() => {
    if (!accepted) return
    if (session.status !== 'ready' && session.status !== 'unavailable') return
    navigate('/', { replace: true })
  }, [accepted, session.status, navigate])

  useEffect(() => {
    if (!linkCode) return
    let active = true
    previewInvite(linkCode)
      .then((username) => {
        if (active) setState({ kind: 'form', code: linkCode, username })
      })
      .catch((cause: unknown) => {
        if (active) setState({ kind: 'dead', message: deadMessage(cause) })
      })
    return () => {
      active = false
    }
  }, [linkCode])

  async function onPasswordSubmit(event: FormEvent) {
    event.preventDefault()
    if (state.kind !== 'form') return

    const submittedUsername = canonicalUsername(typedUsername)
    if (submittedUsername !== state.username) {
      setError('Type the username shown above, or ask your manager to correct it.')
      return
    }
    if (password !== confirmation) {
      setError('Those two passwords are not the same.')
      return
    }

    setBusy(true)
    setError(null)
    try {
      await redeemInvite(state.code, submittedUsername, password)
      await signIn(submittedUsername, password)
      // `busy` stays set on purpose: the password is set and the code is spent,
      // so there is nothing here to submit again while the session resolves.
      setAccepted(true)
      revalidate()
    } catch (cause) {
      if (cause instanceof ActivationError && cause.code === 'invalid_code') {
        setState({ kind: 'dead', message: cause.message })
      } else {
        setError(
          cause instanceof ActivationError
            ? cause.message
            : 'Could not set your password right now. Try again in a moment.',
        )
      }
      setBusy(false)
    }
  }

  return (
    // Centred like sign-in, which this screen links to and is linked from: two
    // entry cards in the same layout that agreed on everything except their
    // vertical position would jump as you moved between them (design D9).
    <div className="flex flex-1 items-center justify-center">
      <Card className="w-full max-w-md">
        <CardTitle>
          {state.kind === 'dead' ? (state.title ?? 'This link will not work') : 'Set your password'}
        </CardTitle>
        <CardBody>
          {state.kind === 'checking' && (
            <p data-testid="activate-checking" className="text-sm text-content-muted">
              Checking your link…
            </p>
          )}

          {state.kind === 'dead' && (
            <p
              data-testid="activate-error"
              role="alert"
              className="text-sm font-semibold text-danger"
            >
              {state.message}
            </p>
          )}

          {state.kind === 'form' && (
            <>
              <p className="mb-1 text-sm text-content-muted">Your username is</p>
              <p
                data-testid="activate-username"
                className="mb-4 break-all text-base font-semibold text-content"
              >
                {state.username}
              </p>
              <p className="mb-4 text-sm text-content-muted">
                Type it below without an @ sign, then choose your password.
              </p>
              <form onSubmit={onPasswordSubmit} className="space-y-4" noValidate>
                <div className="space-y-1">
                  <label htmlFor="activate-username-input" className="block text-sm font-semibold">
                    Username
                  </label>
                  <Input
                    id="activate-username-input"
                    name="username"
                    type="text"
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    required
                    value={typedUsername}
                    onChange={(event) => setTypedUsername(event.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="activate-password" className="block text-sm font-semibold">
                    New password
                  </label>
                  <Input
                    id="activate-password"
                    name="new-password"
                    type="password"
                    autoComplete="new-password"
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                  <p className="text-xs text-content-muted">
                    At least {MIN_PASSWORD_LENGTH} characters.
                  </p>
                </div>
                <div className="space-y-1">
                  <label htmlFor="activate-confirm" className="block text-sm font-semibold">
                    Re-type password
                  </label>
                  <Input
                    id="activate-confirm"
                    name="new-password-confirmation"
                    type="password"
                    autoComplete="new-password"
                    required
                    value={confirmation}
                    onChange={(event) => setConfirmation(event.target.value)}
                  />
                </div>

                {error && (
                  <p
                    data-testid="activate-error"
                    role="alert"
                    className="text-sm font-semibold text-danger"
                  >
                    {error}
                  </p>
                )}

                <button type="submit" disabled={busy} className={buttonVariants({ size: 'phone' })}>
                  {busy ? 'Setting…' : 'Set password and sign in'}
                </button>
              </form>
              <p className="mt-4 text-sm text-content-muted">
                Not the username you expected? Ask the admin who sent this link to correct it. The
                same link will keep working.
              </p>
            </>
          )}

          <p className="mt-6 text-sm text-content-muted">
            Already have a password?{' '}
            <Link to="/sign-in" className="font-semibold text-accent-text underline">
              Sign in
            </Link>
          </p>
        </CardBody>
      </Card>
    </div>
  )
}
