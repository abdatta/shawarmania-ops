import type { LucideIcon } from 'lucide-react'
import {
  BarChart3,
  Bell,
  Banknote,
  CalendarCheck,
  ClipboardList,
  Home,
  KeyRound,
  LayoutDashboard,
  Package,
  ReceiptText,
  Store,
  TabletSmartphone,
  TrendingUp,
  UserRound,
  Users,
  UtensilsCrossed,
  Wallet,
} from 'lucide-react'

import type { Role, SessionMode } from '@/session/session'

/**
 * The gate registry — every user-facing surface, each in exactly one state,
 * declared in this one file so the state of the product is readable at a
 * glance (docs/DEMO_MODE.md).
 *
 *   hidden  absent: no navigation entry, no reachable route, in any mode
 *   demo    renders only inside demo mode, served by mock adapters
 *   live    renders in both modes, served by real data in real mode
 *
 * Promoting a surface is a one-line edit here, made by the change that earns
 * it — never a runtime toggle (design D3). The roadmap is done when nothing
 * is left in `demo`.
 */

export type GateState = 'hidden' | 'demo' | 'live'

interface SurfaceDefInput {
  /** Which role's shell mounts this surface. */
  role: Role
  /** Path relative to the role's prefix; '' is the role's index surface. */
  path: string
  /** Navigation metadata. Surfaces without it never appear in navigation. */
  nav?: { label: string; icon: LucideIcon; order: number }
  state: GateState
}

const defs = {
  // ── Super Admin — all outlets, on a phone ────────────────────────────────
  'owner-dashboard': {
    role: 'super_admin',
    path: '',
    nav: { label: 'Overview', icon: LayoutDashboard, order: 1 },
    state: 'live',
  },
  /**
   * Where each outlet is. Live because the geofence reference point can only
   * honestly be captured from the device standing at the counter, and only the
   * Super Admin may write it (attendance, design D4).
   */
  'owner-outlets': {
    role: 'super_admin',
    path: 'outlets',
    nav: { label: 'Outlets', icon: Store, order: 2 },
    state: 'live',
  },
  'owner-people': {
    role: 'super_admin',
    path: 'people',
    nav: { label: 'People', icon: Users, order: 3 },
    state: 'live',
  },
  'owner-comparison': {
    role: 'super_admin',
    path: 'comparison',
    nav: { label: 'Compare', icon: BarChart3, order: 4 },
    state: 'hidden',
  },
  'owner-alerts': {
    role: 'super_admin',
    path: 'alerts',
    nav: { label: 'Alerts', icon: Bell, order: 5 },
    state: 'hidden',
  },
  /** Drop into one outlet's Franchise Admin view, read-only. */
  'owner-outlet-view': {
    role: 'super_admin',
    path: 'outlet',
    state: 'hidden',
  },

  // ── Franchise Admin — one outlet, on a phone ─────────────────────────────
  'admin-dashboard': {
    role: 'franchise_admin',
    path: '',
    nav: { label: 'Today', icon: LayoutDashboard, order: 1 },
    state: 'live',
  },
  'admin-menu': {
    role: 'franchise_admin',
    path: 'menu',
    nav: { label: 'Menu', icon: UtensilsCrossed, order: 2 },
    state: 'hidden',
  },
  'admin-inventory': {
    role: 'franchise_admin',
    path: 'inventory',
    nav: { label: 'Stock', icon: Package, order: 3 },
    state: 'hidden',
  },
  'admin-expenses': {
    role: 'franchise_admin',
    path: 'expenses',
    nav: { label: 'Expenses', icon: Wallet, order: 4 },
    state: 'hidden',
  },
  'admin-daily-cash': {
    role: 'franchise_admin',
    path: 'cash',
    nav: { label: 'Cash', icon: Banknote, order: 5 },
    state: 'hidden',
  },
  'admin-attendance': {
    role: 'franchise_admin',
    path: 'attendance',
    nav: { label: 'Attendance', icon: CalendarCheck, order: 6 },
    state: 'live',
  },
  'admin-employees': {
    role: 'franchise_admin',
    path: 'employees',
    nav: { label: 'Staff', icon: Users, order: 7 },
    state: 'live',
  },
  'admin-pnl': {
    role: 'franchise_admin',
    path: 'pnl',
    nav: { label: 'P&L', icon: TrendingUp, order: 8 },
    state: 'hidden',
  },
  'admin-alerts': {
    role: 'franchise_admin',
    path: 'alerts',
    nav: { label: 'Alerts', icon: Bell, order: 9 },
    state: 'hidden',
  },
  'admin-devices': {
    role: 'franchise_admin',
    path: 'devices',
    nav: { label: 'Devices', icon: TabletSmartphone, order: 10 },
    state: 'hidden',
  },
  /**
   * App access for this outlet — create an account, issue a code, deactivate.
   * Distinct from `admin-employees`, which is the HR roster (employment
   * status, role, joining date) and belongs with the operations surfaces.
   * Having a login and being on the payroll are different facts about a
   * person, and one can be true without the other.
   */
  'admin-people': {
    role: 'franchise_admin',
    path: 'people',
    nav: { label: 'Access', icon: KeyRound, order: 11 },
    state: 'live',
  },

  // ── Biller — the counter tablet ──────────────────────────────────────────
  'counter-home': {
    role: 'biller',
    path: '',
    nav: { label: 'Counter', icon: Home, order: 1 },
    state: 'live',
  },
  'counter-shift-unlock': {
    role: 'biller',
    path: 'shift',
    nav: { label: 'Shift', icon: KeyRound, order: 2 },
    state: 'hidden',
  },
  'counter-billing': {
    role: 'biller',
    path: 'billing',
    nav: { label: 'Billing', icon: ReceiptText, order: 3 },
    state: 'hidden',
  },
  'counter-my-shift': {
    role: 'biller',
    path: 'my-shift',
    nav: { label: 'My shift', icon: ClipboardList, order: 4 },
    state: 'hidden',
  },
  'counter-attendance-kiosk': {
    role: 'biller',
    path: 'kiosk',
    nav: { label: 'Check-in', icon: CalendarCheck, order: 5 },
    state: 'hidden',
  },

  // ── Employee — a phone, and almost nothing else ──────────────────────────
  'staff-home': {
    role: 'employee',
    path: '',
    nav: { label: 'Home', icon: Home, order: 1 },
    state: 'live',
  },
  'staff-attendance': {
    role: 'employee',
    path: 'my-attendance',
    nav: { label: 'My attendance', icon: CalendarCheck, order: 2 },
    state: 'live',
  },
  'staff-profile': {
    role: 'employee',
    path: 'profile',
    nav: { label: 'Profile', icon: UserRound, order: 3 },
    state: 'hidden',
  },
} as const satisfies Record<string, SurfaceDefInput>

export type SurfaceId = keyof typeof defs

export interface Surface extends SurfaceDefInput {
  id: SurfaceId
}

export const surfaces: readonly Surface[] = (
  Object.entries(defs) as [SurfaceId, SurfaceDefInput][]
).map(([id, def]) => ({ id, ...def }))

export function getSurface(id: SurfaceId): Surface {
  const surface = surfaces.find((candidate) => candidate.id === id)
  if (!surface) throw new Error(`Unknown surface: ${id}`)
  return surface
}

/**
 * Whether a surface renders at all in the given mode. `hidden` renders
 * nowhere; `demo` renders only in demo mode; `live` renders everywhere.
 */
export function isRenderable(state: GateState, mode: SessionMode): boolean {
  if (state === 'live') return true
  if (state === 'demo') return mode === 'demo'
  return false
}

/**
 * The navigation for one role's shell in one mode, in declared order.
 * Surfaces without nav metadata (sub-surfaces reached from elsewhere) are
 * excluded regardless of state.
 */
export function visibleSurfaces(role: Role, mode: SessionMode): Surface[] {
  return surfaces
    .filter((surface) => surface.role === role && surface.nav && isRenderable(surface.state, mode))
    .sort((a, b) => (a.nav?.order ?? 0) - (b.nav?.order ?? 0))
}
