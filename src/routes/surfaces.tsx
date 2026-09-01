import { Navigate, type RouteObject } from 'react-router'

import { AccountsSurface } from '@/features/accounts/accounts-surface'
import { MyAttendance } from '@/features/attendance/my-attendance'
import { OutletAttendance } from '@/features/attendance/outlet-attendance'
import { BillingCounter } from '@/features/billing/billing-counter'
import { ManagerBillingHistory } from '@/features/billing/manager-billing-history'
import { MyShiftSurface } from '@/features/billing/my-shift-surface'
import { OpenOrdersSurface } from '@/features/billing/open-orders-surface'
import { ShiftUnlock } from '@/features/billing/shift-unlock'
import { CashDrawerSurface } from '@/features/cash/cash-drawer-surface'
import { LedgerStatementSurface } from '@/features/cash/ledger-statement-surface'
import { DevicesSurface } from '@/features/counter/devices-surface'
import { ExpenseCategoriesSurface } from '@/features/expense-categories/expense-categories-surface'
import { OutletExpensesSurface } from '@/features/expenses/outlet-expenses-surface'
import { OutletDayView } from '@/features/insights/outlet-day-view'
import { MenuSurface } from '@/features/menu/menu-surface'
import { OutletsSurface } from '@/features/outlets/outlets-surface'
import { RoleHome } from '@/features/overview/role-home'
import { DeliverySyncSurface } from '@/features/aggregator-sync/delivery-sync-surface'

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
    path: 'open-orders',
    element: (
      <GatedSurface path="open-orders">
        <div className="mx-auto h-full max-w-3xl p-4">
          <OpenOrdersSurface />
        </div>
      </GatedSurface>
    ),
  },
  {
    path: 'my-shift',
    element: (
      <GatedSurface path="my-shift">
        <MyShiftSurface />
      </GatedSurface>
    ),
  },
  {
    path: 'billing-history',
    element: (
      <GatedSurface path="billing-history">
        <ManagerBillingHistory />
      </GatedSurface>
    ),
  },
  {
    // A manager's surface. It was one path reaching two authorities until the
    // Counter's menu column made the Biller's read-only copy redundant; the gate
    // registry records why `counter-menu` went. A Biller landing here now meets
    // the ordinary absent-surface answer, and their write meets the policy.
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
    // The drawer as a continuous balance (#11). One path, two roles: what
    // differs between a Super Admin and an assigned Franchise Admin is decided
    // by `app_may_reach_drawer()` in the database, not by this screen.
    path: 'drawer',
    element: (
      <GatedSurface path="drawer">
        <CashDrawerSurface />
      </GatedSurface>
    ),
  },
  {
    // The derived Ledger owns `ledger`; Expenses and the Delivery channels are
    // its neighbouring operational views, nested beneath it in the sidebar.
    path: 'ledger',
    element: (
      <GatedSurface path="ledger">
        <LedgerStatementSurface />
      </GatedSurface>
    ),
  },
  {
    // One canonical expense list for every role that can record outlet spend.
    path: 'ledger/expenses',
    element: (
      <GatedSurface path="ledger/expenses">
        <OutletExpensesSurface />
      </GatedSurface>
    ),
  },
  {
    path: 'ledger/categories',
    element: (
      <GatedSurface path="ledger/categories">
        <ExpenseCategoriesSurface />
      </GatedSurface>
    ),
  },
  {
    // One Delivery entry for every restaurant channel (#48). The nav entry
    // points here, with no channel named; the surface resolves one and rewrites
    // the address to say which.
    path: 'ledger/delivery',
    element: (
      <GatedSurface path="ledger/delivery">
        <DeliverySyncSurface />
      </GatedSurface>
    ),
  },
  {
    // The channel is in the route, so a badge, a link or a returning reader
    // lands on the channel the work is actually on. Gated against the parent
    // pattern: the gate is a question about the surface, not about which of its
    // addresses is being opened.
    path: 'ledger/delivery/:channel',
    element: (
      <GatedSurface path="ledger/delivery">
        <DeliverySyncSurface />
      </GatedSurface>
    ),
  },
  /*
   * The two addresses the merged entry replaced.
   *
   * `owner-zomato-sync` and `owner-swiggy-sync` are `hidden`, and a hidden gate
   * renders NotFound — so these redirects sit OUTSIDE `GatedSurface`, which is
   * the only way they can resolve at all. There was no redirect precedent in
   * this file; it is preferred to answering a URL the owner may well have on
   * their phone with a 404, and each lands on the channel it names rather than
   * on whatever the arrival rule would have picked.
   */
  { path: 'ledger/zomato', element: <Navigate to="../ledger/delivery/zomato" replace /> },
  { path: 'ledger/swiggy', element: <Navigate to="../ledger/delivery/swiggy" replace /> },
  {
    // One path, two roles: `admin-devices` carries navigation and
    // `owner-devices` deliberately does not. Both reach this component, and the
    // difference between them is what the privileged functions accept — the
    // owner administers a tablet at any outlet, a manager only at theirs.
    path: 'devices',
    element: (
      <GatedSurface path="devices">
        <DevicesSurface />
      </GatedSurface>
    ),
  },
  {
    // The outlet switcher's destination. The parameter is part of the surface's
    // declared path, so the gate is looked up against the pattern rather than
    // against whichever outlet id happens to be in the URL.
    path: 'outlet/:outletId',
    element: (
      <GatedSurface path="outlet/:outletId">
        <OutletDayView />
      </GatedSurface>
    ),
  },
  // Everything else is genuinely absent — inside the shell chrome, not as a
  // blank page.
  { path: '*', Component: NotFound },
]
