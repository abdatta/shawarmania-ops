import { Navigate } from 'react-router'

import { getSurface, isRenderable } from '@/gates/registry'
import { useSession } from '@/session/context'

/**
 * The Biller's home, which is the counter itself.
 *
 * A tablet on a shelf in a shop should open on the thing it is for, so this
 * hands straight over to the billing surface as soon as that surface is
 * renderable for the session. That is a **gate** question, not a mode question:
 * the registry already decides who may see billing, and this asks it the same
 * way `GatedSurface` does.
 *
 * **`billing-live` (#10) promoted billing to `live`, so the gate now always
 * says yes and this always hands over.** There was a placeholder here for
 * whoever the gate refused, describing the counter that was coming; the counter
 * came, and a screen nobody can reach promising a screen that exists is worth
 * less than the lines it takes. The check stays because it is what makes the
 * hand-over honest rather than assumed.
 */
export function CounterHome() {
  const session = useSession()

  if (isRenderable(getSurface('counter-billing').state, session.mode)) {
    return <Navigate to="billing" replace />
  }

  // Unreachable while billing is `live`, and deliberately not a screen: a
  // tablet that cannot open its counter has nothing else to offer.
  return null
}
