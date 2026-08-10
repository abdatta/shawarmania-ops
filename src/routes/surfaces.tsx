import type { RouteObject } from 'react-router'

import { AccountsSurface } from '@/features/accounts/accounts-surface'
import { AlertsSurface } from '@/features/alerts/alerts-surface'
import { MyAttendance } from '@/features/attendance/my-attendance'
import { OutletAttendance } from '@/features/attendance/outlet-attendance'
import { BillingCounter } from '@/features/billing/billing-counter'
import { ManagerBillingHistory } from '@/features/billing/manager-billing-history'
import { MyShiftSurface } from '@/features/billing/my-shift-surface'
import { OpenOrdersSurface } from '@/features/billing/open-orders-surface'
import { ShiftUnlock } from '@/features/billing/shift-unlock'
import { DailyCashSurface } from '@/features/cash/daily-cash-surface'
import { DevicesSurface } from '@/features/counter/devices-surface'
import { ExpenseCategoriesSurface } from '@/features/expense-categories/expense-categories-surface'
import { ExpensesSurface } from '@/features/expenses/expenses-surface'
import { StaffExpensesSurface } from '@/features/expenses/staff-expenses-surface'
import { ComparisonSurface } from '@/features/insights/comparison-surface'
import { OutletDayView } from '@/features/insights/outlet-day-view'
import { PnlSurface } from '@/features/insights/pnl-surface'
import { ReportsSurface } from '@/features/insights/reports-surface'
import { InventorySurface } from '@/features/inventory/inventory-surface'
import { ManualLedgerSurface } from '@/features/manual-ledger/manual-ledger-surface'
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
        <OpenOrdersSurface />
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
  {
    // The manual ledger (#36) — temporary. This entry goes with the capability,
    // and it is one line precisely because the gate is what decides who reaches
    // it: only `owner-manual-ledger` declares this path, so no other role's shell
    // resolves it and a direct URL renders nothing.
    path: 'ledger',
    element: (
      <GatedSurface path="ledger">
        <ManualLedgerSurface />
      </GatedSurface>
    ),
  },
  {
    // The manual ledger's expense list, alone, for the people who spend the
    // money (the-ledger-opens-to-the-outlet). Under `ledger/` rather than at
    // `expenses`, which `admin-expenses` already owns and which is #11's live
    // expense record — a different thing that outlives this one.
    path: 'ledger/expenses',
    element: (
      <GatedSurface path="ledger/expenses">
        <StaffExpensesSurface />
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
    // One path, two roles again: `admin-alerts` raises and `owner-alerts` is
    // the cross-outlet inbox, and the same component serves both because the
    // difference between them is the adapter's, not the screen's.
    path: 'alerts',
    element: (
      <GatedSurface path="alerts">
        <AlertsSurface />
      </GatedSurface>
    ),
  },
  {
    path: 'pnl',
    element: (
      <GatedSurface path="pnl">
        <PnlSurface />
      </GatedSurface>
    ),
  },
  {
    path: 'reports',
    element: (
      <GatedSurface path="reports">
        <ReportsSurface />
      </GatedSurface>
    ),
  },
  {
    path: 'comparison',
    element: (
      <GatedSurface path="comparison">
        <ComparisonSurface />
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
