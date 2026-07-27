import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'

import { buttonVariants } from '@/components/ui/button-variants'
import { Card, CardBody, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ActivationError, MIN_PASSWORD_LENGTH, redeemInvite, signIn } from '@/data-access/auth'

/**
 * First run, and the whole of password reset: exchange the one-time code an
 * admin handed over for a password of your own.
 *
 * A separate screen rather than a clever sign-in field that guesses whether
 * you typed a password or a code. Guessing would be wrong occasionally and
 * confusing always, and this is the screen someone uses on their first day.
 *
 * On success it signs in immediately with the password just set — one code
 * path for how a session comes into existence (design D5), and the person is
 * simply in.
 */
export function Activate() {
  const navigate = useNavigate()

  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await redeemInvite(email, code, password)
      await signIn(email, password)
      navigate('/', { replace: true })
    } catch (cause) {
      setError(
        cause instanceof ActivationError
          ? cause.message
          : 'Could not set your password right now. Try again in a moment.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <Card>
        <CardTitle>Set your password</CardTitle>
        <CardBody>
          <p className="mb-4 text-sm text-content-muted">
            Use the one-time code your manager gave you. It works once, and expires a week after it
            was issued.
          </p>

          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <div className="space-y-1">
              <label htmlFor="activate-email" className="block text-sm font-semibold">
                Email
              </label>
              <Input
                id="activate-email"
                type="email"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>

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
                value={code}
                onChange={(event) => setCode(event.target.value)}
                className="font-mono tracking-widest"
              />
            </div>

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
