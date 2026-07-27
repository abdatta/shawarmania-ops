import { useEffect, useState } from 'react'
import { Link, Outlet } from 'react-router'

import { buttonVariants } from '@/components/ui/button-variants'
import { Card, CardBody, CardTitle } from '@/components/ui/card'
import { hasPersistedRealSession } from '@/data-access/real-session'

/**
 * The demo-entry guard (design D5): a real signed-in user never enters demo
 * mode silently. With a persisted session present, every /demo/* URL renders
 * this interstitial instead of a demo surface until the user makes an
 * explicit choice — and that choice is held in sessionStorage, so it dies
 * with the tab rather than silently sticking to the account.
 *
 * This gate mounts OUTSIDE the demo scope tripwire on purpose: checking for
 * a real session is the one legitimate Supabase read on the way into a demo.
 */
export const DEMO_CONTINUE_KEY = 'shawarmania.demo.continue'

type GateState = 'checking' | 'clear' | 'gated'

function readAcknowledgement(): boolean {
  try {
    return sessionStorage.getItem(DEMO_CONTINUE_KEY) === '1'
  } catch {
    return false
  }
}

function writeAcknowledgement(): void {
  try {
    sessionStorage.setItem(DEMO_CONTINUE_KEY, '1')
  } catch {
    // Storage unavailable: the choice simply will not persist within the tab.
  }
}

export function DemoGate() {
  // Reading the acknowledgement in the initializer keeps the already-chosen
  // path render-clean: no flash of the interstitial, no setState-in-effect.
  const [state, setState] = useState<GateState>(() =>
    readAcknowledgement() ? 'clear' : 'checking',
  )

  useEffect(() => {
    if (readAcknowledgement()) return
    let cancelled = false
    void hasPersistedRealSession().then((hasSession) => {
      if (!cancelled) setState(hasSession ? 'gated' : 'clear')
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (state === 'clear') return <Outlet />
  if (state === 'checking') return null

  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas p-4 text-content">
      <Card data-testid="demo-interstitial" className="max-w-md">
        <CardTitle>You are signed in — this is the demo</CardTitle>
        <CardBody className="space-y-4">
          <p>
            Everything past this point shows <strong>fabricated data</strong>: invented staff,
            invented figures, nothing from your outlets. Nothing you do in the demo touches real
            records.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={buttonVariants({ size: 'phone' })}
              onClick={() => {
                writeAcknowledgement()
                setState('clear')
              }}
            >
              Continue to demo
            </button>
            <Link to="/" className={buttonVariants({ variant: 'secondary', size: 'phone' })}>
              Back to the app
            </Link>
          </div>
        </CardBody>
      </Card>
    </div>
  )
}
