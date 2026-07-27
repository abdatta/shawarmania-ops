import { Link, Navigate } from 'react-router'

import { useRealSession } from '@/auth/use-real-session'
import { buttonVariants } from '@/components/ui/button-variants'
import { Card, CardBody, CardTitle } from '@/components/ui/card'
import { ROLE_SEGMENTS } from '@/session/session'

/**
 * The root. A signed-in visitor is simply taken to their own shell — landing
 * on a marketing card when you are already staff is a step, not a welcome —
 * and everyone else gets the two ways in: sign in, or walk the demo.
 *
 * This is outside the demo branch, so reading the real session here is safe:
 * the demo-scope tripwire only guards code rendering under /demo.
 */
export function Landing() {
  const { state } = useRealSession()

  if (state.status === 'ready') {
    return <Navigate to={`/${ROLE_SEGMENTS[state.session.role]}`} replace />
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Card>
        <CardTitle>Shawarmania Ops</CardTitle>
        <CardBody className="space-y-4">
          <p>
            Counter billing, attendance, stock, expenses and daily cash for every Shawarmania outlet
            — with each outlet's data strictly isolated, and the owner's view across all of them.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link to="/sign-in" className={buttonVariants({ size: 'phone' })}>
              Sign in
            </Link>
            <Link to="/demo" className={buttonVariants({ variant: 'secondary', size: 'phone' })}>
              View the demo
            </Link>
          </div>
          <p className="text-sm">
            Staff accounts are created by an admin. If you were given a one-time code,{' '}
            <Link to="/activate" className="font-semibold text-accent-text underline">
              set your password
            </Link>
            .
          </p>
        </CardBody>
      </Card>
    </div>
  )
}
