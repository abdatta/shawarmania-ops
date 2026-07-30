import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'

import { buttonVariants } from '@/components/ui/button-variants'
import { Card, CardBody, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  ActivationError,
  finishOwnerRecovery,
  MIN_PASSWORD_LENGTH,
  requestOwnerRecovery,
  startOwnerRecovery,
} from '@/data-access/auth'
import { canonicalUsername } from '../../shared/username'

type RecoveryState =
  | { kind: 'request' }
  | { kind: 'accepted'; message: string }
  | { kind: 'checking' }
  | { kind: 'reset'; username: string }
  | { kind: 'dead'; message: string }

export function OwnerRecovery() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const tokenHash = params.get('token_hash')
  const recoveryType = params.get('type')
  const [state, setState] = useState<RecoveryState>(
    tokenHash && recoveryType === 'recovery' ? { kind: 'checking' } : { kind: 'request' },
  )
  const [accountEmail, setAccountEmail] = useState('')
  const [typedUsername, setTypedUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!tokenHash || recoveryType !== 'recovery') return
    let active = true
    startOwnerRecovery(tokenHash)
      .then((username) => {
        if (active) setState({ kind: 'reset', username })
      })
      .catch((cause: unknown) => {
        if (!active) return
        setState({
          kind: 'dead',
          message:
            cause instanceof ActivationError
              ? cause.message
              : 'That recovery link is no longer usable. Request another one.',
        })
      })
    return () => {
      active = false
    }
  }, [recoveryType, tokenHash])

  async function onRequest(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      setState({ kind: 'accepted', message: await requestOwnerRecovery(accountEmail) })
    } catch {
      setState({
        kind: 'accepted',
        message:
          'If that email is associated with an active Super Admin, a recovery link is on its way.',
      })
    } finally {
      setBusy(false)
    }
  }

  async function onReset(event: FormEvent) {
    event.preventDefault()
    if (state.kind !== 'reset') return
    const username = canonicalUsername(typedUsername)
    if (username !== state.username) {
      setError('Type the username shown above.')
      return
    }
    if (password !== confirmation) {
      setError('Those two passwords are not the same.')
      return
    }

    setBusy(true)
    setError(null)
    try {
      await finishOwnerRecovery(username, password)
      navigate('/', { replace: true })
    } catch (cause) {
      setError(
        cause instanceof ActivationError
          ? cause.message
          : 'Could not reset the password right now. Request another recovery link.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <Card>
        <CardTitle>
          {state.kind === 'reset' ? 'Reset your password' : 'Super Admin recovery'}
        </CardTitle>
        <CardBody>
          {state.kind === 'request' && (
            <>
              <p className="mb-4 text-sm text-content-muted">
                Email recovery is only for an active Super Admin. Staff should ask their Franchise
                Admin or Super Admin for a new one-time link.
              </p>
              <form onSubmit={onRequest} className="space-y-4" noValidate>
                <div className="space-y-1">
                  <label htmlFor="recovery-email" className="block text-sm font-semibold">
                    Email
                  </label>
                  <Input
                    id="recovery-email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    inputMode="email"
                    autoCapitalize="none"
                    spellCheck={false}
                    required
                    value={accountEmail}
                    onChange={(event) => setAccountEmail(event.target.value)}
                  />
                </div>
                <button type="submit" disabled={busy} className={buttonVariants({ size: 'phone' })}>
                  {busy ? 'Requesting…' : 'Send recovery link'}
                </button>
              </form>
            </>
          )}

          {state.kind === 'accepted' && (
            <p data-testid="recovery-accepted" className="text-sm text-content">
              {state.message}
            </p>
          )}

          {state.kind === 'checking' && (
            <p data-testid="recovery-checking" className="text-sm text-content-muted">
              Checking your recovery link…
            </p>
          )}

          {state.kind === 'dead' && (
            <p
              data-testid="recovery-error"
              role="alert"
              className="text-sm font-semibold text-danger"
            >
              {state.message}
            </p>
          )}

          {state.kind === 'reset' && (
            <>
              <p className="mb-1 text-sm text-content-muted">Your username is</p>
              <p
                data-testid="recovery-username"
                className="mb-4 break-all text-base font-semibold text-content"
              >
                {state.username}
              </p>
              <form onSubmit={onReset} className="space-y-4" noValidate>
                <div className="space-y-1">
                  <label htmlFor="recovery-username-input" className="block text-sm font-semibold">
                    Username
                  </label>
                  <Input
                    id="recovery-username-input"
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
                  <label htmlFor="recovery-password" className="block text-sm font-semibold">
                    New password
                  </label>
                  <Input
                    id="recovery-password"
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
                  <label htmlFor="recovery-confirm" className="block text-sm font-semibold">
                    Re-type password
                  </label>
                  <Input
                    id="recovery-confirm"
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
                    data-testid="recovery-error"
                    role="alert"
                    className="text-sm font-semibold text-danger"
                  >
                    {error}
                  </p>
                )}
                <button type="submit" disabled={busy} className={buttonVariants({ size: 'phone' })}>
                  {busy ? 'Resetting…' : 'Reset password and continue'}
                </button>
              </form>
            </>
          )}

          <p className="mt-6 text-sm text-content-muted">
            <Link to="/sign-in" className="font-semibold text-accent-text underline">
              Back to sign in
            </Link>
          </p>
        </CardBody>
      </Card>
    </div>
  )
}
