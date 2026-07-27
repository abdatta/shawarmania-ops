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
 */
export function RoleHome() {
  const session = useSession()
  switch (session.role) {
    case 'super_admin':
      return <OwnerHome />
    case 'franchise_admin':
      return <AdminHome />
    case 'biller':
      return <CounterHome />
    case 'employee':
      return <StaffHome />
  }
}
