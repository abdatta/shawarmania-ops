import { useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'

import { buttonVariants } from '@/components/ui/button-variants'
import { Card, CardBody, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { signIn, SignInError } from '@/data-access/auth'
import { validateUsername, usernameErrorMessage } from '../../shared/username'

import { useRealSessionContext } from './real-session-context'
import type { SessionEndReason } from './use-real-session'

/**
 * Username-or-email and password. One field pair, nothing else
 * (docs/SCREENS.md).
 *
 * Two deliberate silences. An unknown identifier and a wrong password produce
 * the same sentence, because telling them apart would confirm which accounts
 * exist. Every role asks an authorized admin for a new one-time code while
 * self-service recovery remains deferred.
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
  const { state: session, revalidate } = useRealSessionContext()

  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [accepted, setAccepted] = useState(false)

  // Shown once, and only until the person starts typing: it explains why they
  // are looking at this screen, and then it stops being the news.
  const ended = state.reason ? ENDED_MESSAGES[state.reason] : null

  /**
   * Leave only once the session says so.
   *
   * Accepted credentials and a resolved session are two different moments, and
   * navigating on the first one lands in a resolver that still believes the
   * second: the provider computed `anonymous` when this screen loaded, and it
   * learns otherwise from its own auth listener a tick later. Navigating to the
   * root in between meant the root read that stale `anonymous` and sent us
   * straight back here — signed in, looking at a password field
   * (the-root-resolves-instead-of-greeting, design D11).
   *
   * `unavailable` leaves too. The credentials were accepted, so this screen has
   * nothing further to offer, and the retry belongs on the screen whose whole
   * subject is a session that could not be confirmed.
   */
  useEffect(() => {
    if (!accepted) return
    if (session.status !== 'ready' && session.status !== 'unavailable') return
    navigate(state.from && state.from !== '/sign-in' ? state.from : '/', { replace: true })
  }, [accepted, session.status, navigate, state.from])

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
      // Accepted. Where they land is the session's decision, so ask for it and
      // let the effect above leave when there is an answer. `busy` deliberately
      // stays set: the credentials are gone and the screen is on its way out,
      // and re-enabling the button would invite a second submission of a
      // sign-in that already worked.
      setAccepted(true)
      revalidate()
    } catch (cause) {
      setError(
        cause instanceof SignInError
          ? cause.message
          : 'Could not sign in right now. Try again in a moment.',
      )
      setBusy(false)
    }
  }

  return (
    // Centred rather than top-aligned in the page: since
    // the-root-resolves-instead-of-greeting the root resolves straight here for
    // anybody signed out, so this is the app's front door rather than content
    // inside a longer page, and it is composed like the other standalone cards
    // (design D9).
    <div className="flex flex-1 items-center justify-center">
      <Card className="w-full max-w-md">
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

          {/*
            One sentence where there were two. The other was a link to
            `/activate`, which without a code could only offer a form asking
            somebody to type one — a value no admin is ever shown, since the
            issuing panel deliberately hands over a link and a QR and no raw code
            (the-root-resolves-instead-of-greeting, design D8). The people it used
            to serve, a first-timer and somebody who forgot, need the same thing
            and it is this.
          */}
          <p className="mt-6 text-sm text-content-muted">
            No password yet, or forgotten it? Ask a Franchise Admin or Super Admin for a one-time
            link.
          </p>
          <p className="mt-3 text-sm text-content-muted">
            Setting up a counter tablet?{' '}
            <Link to="/counter/setup" className="font-semibold text-primary underline">
              Set up this tablet
            </Link>
            .
          </p>
        </CardBody>
      </Card>
    </div>
  )
}
