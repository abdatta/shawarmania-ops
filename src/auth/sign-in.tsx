import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'

import { buttonVariants } from '@/components/ui/button-variants'
import { Card, CardBody, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { signIn, SignInError } from '@/data-access/auth'
import { validateUsername, usernameErrorMessage } from '../../shared/username'

import type { SessionEndReason } from './use-real-session'

/**
 * Username-or-email and password. One field pair, nothing else
 * (docs/SCREENS.md).
 *
 * Two deliberate silences. An unknown identifier and a wrong password produce
 * the same sentence, because telling them apart would confirm which accounts
 * exist. Staff still ask an admin for a new code; only a Super Admin may use
 * the private email recovery path.
 */

interface SignInLocationState {
  reason?: SessionEndReason
  from?: string
}

// Deactivation is the only thing that ends a session now. A changed
// assignment used to end one too, because role and outlet were baked into the
// token; since multi-outlet-people nothing about authority is, so an
// assignment change is simply picked up (design D11).
const ENDED_MESSAGES: Record<SessionEndReason, string> = {
  deactivated: 'Your account has been deactivated. Contact your manager.',
}

export function SignIn() {
  const navigate = useNavigate()
  const location = useLocation()
  const state = (location.state ?? {}) as SignInLocationState

  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Shown once, and only until the person starts typing: it explains why they
  // are looking at this screen, and then it stops being the news.
  const ended = state.reason ? ENDED_MESSAGES[state.reason] : null

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier.trim())
      ? identifier.trim().toLowerCase()
      : null
    const validation = email ? null : validateUsername(identifier)
    if (validation?.error) {
      setError(usernameErrorMessage(validation.error))
      return
    }
    const submittedIdentifier = email ?? validation!.username
    setBusy(true)
    setError(null)
    try {
      await signIn(submittedIdentifier, password)
      // Land where they were headed. The role tree resolves the session and
      // redirects to their own shell if the path was not theirs to open.
      navigate(state.from && state.from !== '/sign-in' ? state.from : '/', { replace: true })
    } catch (cause) {
      setError(
        cause instanceof SignInError
          ? cause.message
          : 'Could not sign in right now. Try again in a moment.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <Card>
        <CardTitle>Sign in</CardTitle>
        <CardBody>
          {ended && !error && (
            <p
              data-testid="session-ended"
              className="mb-4 rounded-lg border border-border bg-surface-raised p-3 text-sm"
            >
              {ended}
            </p>
          )}

          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <div className="space-y-1">
              <label htmlFor="signin-username" className="block text-sm font-semibold">
                Username or email
              </label>
              <Input
                id="signin-username"
                name="username"
                type="text"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                required
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                aria-describedby="signin-username-hint"
              />
              <p id="signin-username-hint" className="text-xs text-content-muted">
                Use the username your manager gave you, without an @ sign. Email also works when one
                is associated with your account.
              </p>
            </div>

            <div className="space-y-1">
              <label htmlFor="signin-password" className="block text-sm font-semibold">
                Password
              </label>
              <Input
                id="signin-password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>

            {error && (
              <p
                data-testid="signin-error"
                role="alert"
                className="text-sm font-semibold text-danger"
              >
                {error}
              </p>
            )}

            <button type="submit" disabled={busy} className={buttonVariants({ size: 'phone' })}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <p className="mt-6 text-sm text-content-muted">
            First time here, or been given a new code?{' '}
            <Link to="/activate" className="font-semibold text-accent-text underline">
              Set your password
            </Link>
          </p>
          <p className="mt-3 text-sm text-content-muted">
            Forgot your password? Staff should ask a Franchise Admin or Super Admin for a new
            one-time link. Super Admins can{' '}
            <Link to="/recover" className="font-semibold text-accent-text underline">
              recover by email
            </Link>
            .
          </p>
        </CardBody>
      </Card>
    </div>
  )
}
