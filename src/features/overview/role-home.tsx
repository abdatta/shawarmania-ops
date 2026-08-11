import { CounterHandshakeCards } from '@/features/counter/counter-handshake-cards'
import { useSession } from '@/session/context'

import { AdminHome } from './admin-home'
import { CounterHome } from './counter-home'
import { OwnerHome } from './owner-home'
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
      {session.role === 'super_admin' && <OwnerHome />}
      {session.role === 'franchise_admin' && <AdminHome />}
      {session.role === 'biller' && session.mode === 'demo' && <CounterHome />}
      {(session.role === 'employee' || (session.role === 'biller' && session.mode === 'real')) && (
        <StaffHome />
      )}
    </>
  )
}
