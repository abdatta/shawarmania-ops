import type { RouteObject } from 'react-router'

import { AccountsSurface } from '@/features/accounts/accounts-surface'
import { MyAttendance } from '@/features/attendance/my-attendance'
import { OutletAttendance } from '@/features/attendance/outlet-attendance'
import { BillingCounter } from '@/features/billing/billing-counter'
import { ShiftUnlock } from '@/features/billing/shift-unlock'
import { DailyCashSurface } from '@/features/cash/daily-cash-surface'
import { EmployeeRoster } from '@/features/employees/employee-roster'
import { ExpensesSurface } from '@/features/expenses/expenses-surface'
import { InventorySurface } from '@/features/inventory/inventory-surface'
import { MovementLedger } from '@/features/inventory/movement-ledger'
import { MenuSurface } from '@/features/menu/menu-surface'
import { OutletsSurface } from '@/features/outlets/outlets-surface'
import { RoleHome } from '@/features/overview/role-home'

import { GatedSurface } from './gated-surface'
import { NotFound } from './not-found'

/**
 * The children shared by the real and demo role branches.
 *
 * Identical by construction, because they genuinely are the same surfaces:
 * what differs between the two modes is the gate registry's state for each,
 * which `GatedSurface` consults per session. A surface promoted from `demo` to
 * `live` therefore needs no route change at all — which is exactly the
 * property every `*-live` change on the roadmap depends on.
 */
export const roleSurfaceRoutes: RouteObject[] = [
  {
    index: true,
    element: (
      <GatedSurface path="">
        <RoleHome />
      </GatedSurface>
    ),
  },
  {
    path: 'people',
    element: (
      <GatedSurface path="people">
        <AccountsSurface />
      </GatedSurface>
    ),
  },
  {
    path: 'outlets',
    element: (
      <GatedSurface path="outlets">
        <OutletsSurface />
      </GatedSurface>
    ),
  },
  {
    path: 'attendance',
    element: (
      <GatedSurface path="attendance">
        <OutletAttendance />
      </GatedSurface>
    ),
  },
  {
    path: 'employees',
    element: (
      <GatedSurface path="employees">
        <EmployeeRoster />
      </GatedSurface>
    ),
  },
  {
    path: 'billing',
    element: (
      <GatedSurface path="billing">
        <BillingCounter />
      </GatedSurface>
    ),
  },
  {
    path: 'shift',
    element: (
      <GatedSurface path="shift">
        <ShiftUnlock />
      </GatedSurface>
    ),
  },
  {
    // One path, two roles, two authorities. `GatedSurface` resolves it against
    // the session's own role, so `admin-menu` and `counter-menu` are separate
    // gate entries reaching the same component — which is what makes the
    // permission difference visible rather than asserted.
    path: 'menu',
    element: (
      <GatedSurface path="menu">
        <MenuSurface />
      </GatedSurface>
    ),
  },
  {
    path: 'my-attendance',
    element: (
      <GatedSurface path="my-attendance">
        <MyAttendance />
      </GatedSurface>
    ),
  },
  {
    path: 'inventory',
    element: (
      <GatedSurface path="inventory">
        <InventorySurface />
      </GatedSurface>
    ),
  },
  {
    // The ledger has its own address so "why does it say 4 kg?" can be settled
    // by sending a link — which is how that question actually gets asked.
    path: 'inventory/:itemId',
    element: (
      <GatedSurface path="inventory">
        <MovementLedger />
      </GatedSurface>
    ),
  },
  {
    path: 'expenses',
    element: (
      <GatedSurface path="expenses">
        <ExpensesSurface />
      </GatedSurface>
    ),
  },
  {
    path: 'cash',
    element: (
      <GatedSurface path="cash">
        <DailyCashSurface />
      </GatedSurface>
    ),
  },
  // Everything else is genuinely absent — inside the shell chrome, not as a
  // blank page.
  { path: '*', Component: NotFound },
]
