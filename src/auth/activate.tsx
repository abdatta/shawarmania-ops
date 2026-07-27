import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'

import { Button } from '@/components/ui/button'
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

/**
 * First run, and the whole of password reset: exchange the one-time code an
 * admin handed over for a password of your own.
 *
 * A separate screen rather than a clever sign-in field that guesses whether
 * you typed a password or a code. Guessing would be wrong occasionally and
 * confusing always, and this is the screen someone uses on their first day.
 *
 * The code arrives in the URL, so ordinarily nothing is typed here but a
 * password. Four states carry that (design D8):
 *
 *   checking   — the code is resolved to the address it belongs to
 *   confirming — "you will sign in as x@y.z", yes or no, never a passive Continue
 *   password   — one field
 *   dead       — the link is not usable, said BEFORE anything has been typed
 *
 * Someone who was given only the code, with no link, gets a fifth: a single
 * field asking for it, which then runs the same check. The address is never
 * asked for in any of them.
 *
 * On success it signs in immediately with the password just set — one code
 * path for how a session comes into existence (design D5 of #4), and the
 * person is simply in.
 */

type State =
  | { kind: 'need-code' }
  | { kind: 'checking' }
  | { kind: 'confirm'; code: string; email: string }
  | { kind: 'password'; code: string; email: string }
  | { kind: 'not-me' }
  | { kind: 'dead'; message: string }

/** Why the link will not open, in words a person can act on. */
function deadMessage(cause: unknown): string {
  return cause instanceof ActivationError
    ? cause.message
    : 'Could not check that link right now. Try again in a moment.'
}

/**
 * The heading is part of the answer. Two of these states are refusals, and a
 * card still titled "Set your password" over a refusal promises something the
 * screen is not going to do.
 */
function heading(state: State): string {
  if (state.kind === 'not-me') return 'Check with your manager'
  if (state.kind === 'dead') return 'This link will not work'
  return 'Set your password'
}

export function Activate() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const linkCode = params.get('code')

  const [state, setState] = useState<State>(linkCode ? { kind: 'checking' } : { kind: 'need-code' })
  const [typedCode, setTypedCode] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The link's own code, resolved once on arrival. A dead link therefore says
  // so before the person has typed a character, which is most of the point.
  useEffect(() => {
    if (!linkCode) return
    let active = true
    previewInvite(linkCode)
      .then((email) => {
        if (active) setState({ kind: 'confirm', code: linkCode, email })
      })
      .catch((cause: unknown) => {
        if (active) setState({ kind: 'dead', message: deadMessage(cause) })
      })
    return () => {
      active = false
    }
  }, [linkCode])

  async function onCodeSubmit(event: FormEvent) {
    event.preventDefault()
    setState({ kind: 'checking' })
    setError(null)
    try {
      setState({ kind: 'confirm', code: typedCode, email: await previewInvite(typedCode) })
    } catch (cause) {
      setState({ kind: 'dead', message: deadMessage(cause) })
    }
  }

  async function onPasswordSubmit(event: FormEvent) {
    event.preventDefault()
    if (state.kind !== 'password') return
    setBusy(true)
    setError(null)
    try {
      await redeemInvite(state.code, password)
      await signIn(state.email, password)
      navigate('/', { replace: true })
    } catch (cause) {
      if (cause instanceof ActivationError && cause.code === 'invalid_code') {
        // The code died between the check and the redemption — expired, or
        // re-issued by an admin in the meantime. There is nothing left to set a
        // password against, so the screen has to say so rather than let them
        // retype into a dead code.
        setState({ kind: 'dead', message: cause.message })
      } else {
        setError(
          cause instanceof ActivationError
            ? cause.message
            : 'Could not set your password right now. Try again in a moment.',
        )
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <Card>
        <CardTitle>{heading(state)}</CardTitle>
        <CardBody>
          {state.kind === 'need-code' && (
            <>
              <p className="mb-4 text-sm text-content-muted">
                Enter the one-time code your manager gave you. It works once, and expires a week
                after it was issued.
              </p>
              <form onSubmit={onCodeSubmit} className="space-y-4" noValidate>
                <div className="space-y-1">
                  <label htmlFor="activate-code" className="block text-sm font-semibold">
                    One-time code
                  </label>
                  <Input
                    id="activate-code"
                    inputMode="text"
                    autoComplete="one-time-code"
                    autoCapitalize="characters"
                    spellCheck={false}
                    placeholder="XXXXX-XXXXX"
                    required
                    value={typedCode}
                    onChange={(event) => setTypedCode(event.target.value)}
                    className="font-mono tracking-widest"
                  />
                </div>
                <button type="submit" className={buttonVariants({ size: 'phone' })}>
                  Continue
                </button>
              </form>
            </>
          )}

          {state.kind === 'checking' && (
            <p data-testid="activate-checking" className="text-sm text-content-muted">
              Checking your link…
            </p>
          )}

          {state.kind === 'confirm' && (
            <>
              <p className="mb-2 text-sm text-content-muted">You will sign in as</p>
              <p
                data-testid="activate-address"
                className="mb-4 break-all text-base font-semibold text-content"
              >
                {state.email}
              </p>
              {/*
                Two decisions, equally weighted, and no passive Continue: a
                passive one gets clicked unread, and catching a mistyped address
                before an account becomes unusable is the entire reason this
                screen exists.
              */}
              <div className="flex flex-col gap-2">
                <Button
                  size="phone"
                  onClick={() =>
                    setState({ kind: 'password', code: state.code, email: state.email })
                  }
                >
                  Yes, that&rsquo;s me
                </Button>
                <Button
                  variant="secondary"
                  size="phone"
                  onClick={() => setState({ kind: 'not-me' })}
                >
                  That&rsquo;s not my email
                </Button>
              </div>
            </>
          )}

          {state.kind === 'not-me' && (
            <p data-testid="activate-not-me" className="text-sm text-content">
              Ask your manager to check the email address on your account and send you a new link.
              They can correct it from People and Access — the address they used is the one you will
              sign in with.
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

          {state.kind === 'password' && (
            <>
              <p className="mb-4 break-all text-sm text-content-muted">
                Choose a password for <strong className="text-content">{state.email}</strong>.
              </p>
              <form onSubmit={onPasswordSubmit} className="space-y-4" noValidate>
                <div className="space-y-1">
                  <label htmlFor="activate-password" className="block text-sm font-semibold">
                    New password
                  </label>
                  <Input
                    id="activate-password"
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
