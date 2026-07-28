import { ReceiptText } from 'lucide-react'
import { Navigate } from 'react-router'

import { EmptyState } from '@/components/layout/empty-state'
import { getSurface, isRenderable } from '@/gates/registry'
import { useSession } from '@/session/context'

/**
 * The Biller's home, which is the counter itself.
 *
 * A tablet on a shelf in a shop should open on the thing it is for, so this
 * hands straight over to the billing surface as soon as that surface is
 * renderable for the session. That is a **gate** question, not a mode question:
 * the registry already decides who may see billing, and this asks it the same
 * way `GatedSurface` does. When `billing-live` (#10) promotes billing to `live`,
 * a real biller starts landing here too, with no further edit — which is the end
 * state anyway.
 *
 * The placeholder below is what remains for anyone the gate says no to.
 */
export function CounterHome() {
  const session = useSession()

  if (isRenderable(getSurface('counter-billing').state, session.mode)) {
    return <Navigate to="billing" replace />
  }

  return (
    <div className="flex h-full items-center justify-center">
      <EmptyState
        icon={ReceiptText}
        title="The billing counter lands here next: whole menu on one screen, two taps from order to settle."
      />
    </div>
  )
}
