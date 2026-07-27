import { AdminHome } from '@/features/overview/admin-home'
import { CounterHome } from '@/features/overview/counter-home'
import { OwnerHome } from '@/features/overview/owner-home'
import { StaffHome } from '@/features/overview/staff-home'
import { useSession } from '@/session/context'

/** The index surface of each demo role shell — the role's home overview. */
export function DemoHome() {
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
