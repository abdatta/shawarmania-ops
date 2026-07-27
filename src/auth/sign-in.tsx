import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'

import { buttonVariants } from '@/components/ui/button-variants'
import { Card, CardBody, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { signIn, SignInError } from '@/data-access/auth'

import type { SessionEndReason } from './use-real-session'

/**
 * Email and password. One field pair, nothing else (docs/SCREENS.md).
 *
 * Two deliberate silences. A wrong address and a wrong password produce the
 * same sentence, because telling them apart would confirm which addresses have
 * accounts. And there is no "forgot password" link, because v1 has no
 * self-service reset — the honest instruction is to ask an admin for a new
 * code, which the activation link already leads to.
 */

interface SignInLocationState {
  reason?: SessionEndReason
  from?: string
}

const ENDED_MESSAGES: Record<SessionEndReason, string> = {
  deactivated: 'Your account has been deactivated. Contact your manager.',
  'role-changed': 'Your role has changed. Please sign in again.',
}

export function SignIn() {
  const navigate = useNavigate()
  const location = useLocation()
  const state = (location.state ?? {}) as SignInLocationState

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Shown once, and only until the person starts typing: it explains why they
  // are looking at this screen, and then it stops being the news.
  const ended = state.reason ? ENDED_MESSAGES[state.reason] : null

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await signIn(email, password)
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
              <label htmlFor="signin-email" className="block text-sm font-semibold">
                Email
              </label>
              <Input
                id="signin-email"
                type="email"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                aria-describedby="signin-email-hint"
              />
              {/*
                Sign-in legitimately needs the address, so the least it can do
                is say which one. "The email you gave your manager" is a
                question somebody can actually answer about themselves.
              */}
              <p id="signin-email-hint" className="text-xs text-content-muted">
                The email you gave your manager.
              </p>
            </div>

            <div className="space-y-1">
              <label htmlFor="signin-password" className="block text-sm font-semibold">
                Password
              </label>
              <Input
                id="signin-password"
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
        </CardBody>
      </Card>
    </div>
  )
}
