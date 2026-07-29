import { Link, Navigate } from 'react-router'

import { useRealSession } from '@/auth/use-real-session'
import { buttonVariants } from '@/components/ui/button-variants'
import { Card, CardBody, CardTitle } from '@/components/ui/card'
import { ROLE_SEGMENTS } from '@/session/session'

/**
 * The root. A signed-in visitor is simply taken to their own shell — landing
 * on a marketing card when you are already staff is a step, not a welcome —
 * and everyone else gets the way in: sign in, or set a password from a code.
 *
 * **There is deliberately no route into the demo here.** The demo stopped
 * advertising itself when it became something the owner distributes: the link
 * lives in the Super Admin's account menu, with a copy action beside it, so the
 * one person who pitches franchisees can produce the URL without typing it from
 * memory (ui-owner-console-and-demo, design D9). The demo itself stays
 * unauthenticated — a shared link that demanded a login would not be a demo —
 * so what changed is who *finds* it, not who may open it.
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
