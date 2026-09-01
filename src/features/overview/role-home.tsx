import { CounterHandshakeCards } from '@/features/counter/counter-handshake-cards'
import { useSession } from '@/session/context'

import { CounterHome } from './counter-home'
import { OutletsOverview } from './outlets-overview'
import { StaffHome } from './staff-home'

/**
 * The index surface of every role shell, in both modes. The same four
 * components serve a real session and a demo one — which is the whole point of
 * the seam: they read the session and the adapters, and neither tells them
 * which they got.
 *
 * **The counter's approval cards sit above all four rather than inside each**
 * (#9). Any of these roles may be the person a tablet is asking for — an
 * Employee holding a Biller assignment, a manager covering an evening, the owner
 * — and a card put into each home separately is a card that gets forgotten in
 * one of them. It renders nothing when nothing is waiting, which is nearly
 * always, so the four homes below are unchanged the rest of the time.
 */
export function RoleHome() {
  const session = useSession()
  return (
    <>
      <CounterHandshakeCards />
      {/*
        **One screen for both** (#51). The owner and a manager ask the same
        question of the same page — how are my shops doing today — and the
        database is what makes the answers differ: it hands the owner every
        outlet and a manager only the ones their assignments name. The manager
        had a separate placeholder here, showing an address and a phone under a
        promise of figures that #13 was going to keep and did not.
      */}
      {(session.role === 'super_admin' || session.role === 'franchise_admin') && (
        <OutletsOverview />
      )}
      {session.role === 'biller' && session.mode === 'demo' && <CounterHome />}
      {(session.role === 'employee' || (session.role === 'biller' && session.mode === 'real')) && (
        <StaffHome />
      )}
    </>
  )
}
