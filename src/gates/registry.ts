import type { LucideIcon } from 'lucide-react'
import {
  BarChart3,
  Bell,
  Banknote,
  CalendarCheck,
  Home,
  KeyRound,
  LayoutDashboard,
  NotepadText,
  Package,
  Store,
  TabletSmartphone,
  TrendingUp,
  UserRound,
  Users,
  UtensilsCrossed,
  Wallet,
  ReceiptText,
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

/**
 * The surfaces that can tell the app somebody is waiting on them.
 *
 * Named here rather than in the shell, because badging a further surface should
 * be a registry edit like promoting one is (notification-badges, design D2).
 * `src/features/attention/sources.ts` supplies exactly one implementation per
 * id, so an id added here without one fails to compile.
 */
export type AttentionSourceId = 'attendance-waiting' | 'counter-request-waiting'

interface SurfaceDefInput {
  /** Which role's shell mounts this surface. */
  role: Role
  /** Path relative to the role's prefix; '' is the role's index surface. */
  path: string
  /**
   * Navigation metadata. Surfaces without it never appear in navigation.
   *
   * `attention` names where a count of work waiting for the reader comes from.
   * The shell renders whatever number that source reports and knows nothing
   * about what is being counted.
   */
  nav?: { label: string; icon: LucideIcon; order: number; attention?: AttentionSourceId }
  state: GateState
}

const defs = {
  // ── Super Admin — all outlets, on a phone ────────────────────────────────
  /**
   * Badged by `counter-request-waiting`: a tablet has asked for this person and
   * the request dies in two minutes. Every home carries it, because any of the
   * three roles may be the one standing at a counter — an Employee holding a
   * Biller assignment, a manager covering an evening, the owner.
   */
  'owner-dashboard': {
    role: 'super_admin',
    path: '',
    nav: {
      label: 'Overview',
      icon: LayoutDashboard,
      order: 1,
      attention: 'counter-request-waiting',
    },
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
  /**
   * Every person, across all outlets. Staff exist only as accounts
   * (staff-as-accounts), so this one surface is the account list *and* the
   * staff list — there is no separate roster page and no linking step.
   */
  'owner-people': {
    role: 'super_admin',
    path: 'people',
    nav: { label: 'People', icon: Users, order: 4 },
    state: 'live',
  },
  'owner-comparison': {
    role: 'super_admin',
    path: 'comparison',
    nav: { label: 'Compare', icon: BarChart3, order: 5 },
    state: 'demo',
  },
  'owner-alerts': {
    role: 'super_admin',
    path: 'alerts',
    nav: { label: 'Alerts', icon: Bell, order: 6 },
    state: 'demo',
  },
  'owner-billing-history': {
    role: 'super_admin',
    path: 'billing-history',
    nav: { label: 'Billing', icon: ReceiptText, order: 7 },
    state: 'demo',
  },
  /**
   * Profit and loss, and period reports — **deliberately without navigation
   * entries**. Six tabs is already as much as a bottom bar holds on a phone,
   * and both of these answer a question somebody asks while looking at today's
   * figures: they are reached from the console, which is where that question
   * gets asked (design D14).
   */
  'owner-pnl': {
    role: 'super_admin',
    path: 'pnl',
    state: 'demo',
  },
  'owner-reports': {
    role: 'super_admin',
    path: 'reports',
    state: 'demo',
  },
  /**
   * The manual ledger (#36) — **`live`, and designed to be deleted**.
   *
   * A stopgap with a known end date: billing (#10), expenses (#11) and daily cash
   * (#12) are not live while August 2026 is trading, and the month cannot be
   * reconstructed from memory in September. `live` rather than `demo` because a
   * surface whose entire purpose is to capture real figures is useless gated to a
   * demo, and the notebook it replaces would otherwise be a spreadsheet.
   *
   * It carries navigation because the owner opens it nightly; that is the whole
   * job. It goes when #12 carries its rows into the live cash and expense
   * records — never before, because the rows are the value here and the surface
   * is not.
   */
  'owner-manual-ledger': {
    role: 'super_admin',
    path: 'ledger',
    // Ahead of People: this is opened every night, and People is opened when
    // somebody joins or leaves. Nav order follows how often a tab is reached for,
    // and the nightly job should not sit behind the occasional one.
    nav: { label: 'Ledger', icon: NotepadText, order: 3 },
    state: 'live',
  },
  'owner-expense-categories': {
    role: 'super_admin',
    path: 'ledger/categories',
    state: 'live',
  },
  /**
   * The owner's counterpart to `admin-devices`, across every outlet.
   *
   * Two entries rather than one, for the reason the ledger has two: a surface
   * belongs to exactly one role's shell here. It declares no navigation of its
   * own because it needs none — the owner reaches every manager surface, so
   * `admin-devices`'s entry is already in their bar under `/owner/devices`, and a
   * second "Tablets" would be deduplicated by label anyway. What this entry does
   * is make that path resolve inside the owner's shell.
   */
  'owner-devices': {
    role: 'super_admin',
    path: 'devices',
    state: 'live',
  },
  /** Drop into one outlet's Franchise Admin view, read-only. */
  'owner-outlet-view': {
    role: 'super_admin',
    path: 'outlet/:outletId',
    state: 'demo',
  },

  // ── Franchise Admin — one outlet, on a phone ─────────────────────────────
  'admin-dashboard': {
    role: 'franchise_admin',
    path: '',
    nav: {
      label: 'Today',
      icon: LayoutDashboard,
      order: 1,
      attention: 'counter-request-waiting',
    },
    state: 'live',
  },
  'admin-menu': {
    role: 'franchise_admin',
    path: 'menu',
    nav: { label: 'Menu', icon: UtensilsCrossed, order: 3 },
    state: 'demo',
  },
  'admin-inventory': {
    role: 'franchise_admin',
    path: 'inventory',
    nav: { label: 'Stock', icon: Package, order: 4 },
    state: 'demo',
  },
  'admin-expenses': {
    role: 'franchise_admin',
    path: 'expenses',
    nav: { label: 'Expenses', icon: Wallet, order: 5 },
    state: 'demo',
  },
  'admin-daily-cash': {
    role: 'franchise_admin',
    path: 'cash',
    nav: { label: 'Cash', icon: Banknote, order: 6 },
    state: 'demo',
  },
  /**
   * The surface the badge mechanism was built for: an arrival nobody approves
   * is invisible until somebody queries their pay, and the person who could
   * settle it is rarely already looking at this screen. Since #9 the three homes
   * are badged too, for something far more perishable.
   */
  'admin-attendance': {
    role: 'franchise_admin',
    path: 'attendance',
    nav: {
      label: 'Attendance',
      icon: CalendarCheck,
      order: 7,
      attention: 'attendance-waiting',
    },
    state: 'live',
  },
  'admin-billing-history': {
    role: 'franchise_admin',
    path: 'billing-history',
    nav: { label: 'Billing', icon: ReceiptText, order: 2 },
    state: 'demo',
  },
  /**
   * The manager's counterpart to `owner-manual-ledger`, scoped by assignment.
   *
   * The capability was owner-only because production had two Super Admins and
   * no live Franchise Admin at either outlet, so the owners *were* the managers
   * — the entry recorded that accident rather than a decision. A manager who
   * counts the drawer nightly but cannot read whether the month covered its
   * costs is running half a shop (the-ledger-opens-to-the-outlet).
   *
   * Directly after Attendance, and ahead of People, for the reason the owner's
   * entry gives: nav order follows how often a tab is reached for, and this is
   * opened every night while People is opened when somebody joins or leaves.
   */
  'admin-manual-ledger': {
    role: 'franchise_admin',
    path: 'ledger',
    nav: { label: 'Ledger', icon: NotepadText, order: 8 },
    state: 'live',
  },
  'admin-pnl': {
    role: 'franchise_admin',
    path: 'pnl',
    nav: { label: 'P&L', icon: TrendingUp, order: 10 },
    state: 'demo',
  },
  'admin-alerts': {
    role: 'franchise_admin',
    path: 'alerts',
    nav: { label: 'Alerts', icon: Bell, order: 11 },
    state: 'demo',
  },
  /**
   * The tablets standing at this outlet's counter (#9).
   *
   * `live` from this change, because a tablet cannot be set up any other way:
   * the setup code is generated here and nowhere else, and a `demo` gate would
   * mean production hardware with no door to it.
   *
   * Called **Tablets** rather than Devices. A phone is a device too, and every
   * person reading this screen is holding one.
   */
  'admin-devices': {
    role: 'franchise_admin',
    path: 'devices',
    nav: { label: 'Tablets', icon: TabletSmartphone, order: 12 },
    state: 'live',
  },
  /**
   * This outlet's people — accounts and staff list in one surface, because
   * staff exist only as accounts (staff-as-accounts). Creating a person here
   * is one act: login, staff-list membership, issued code.
   */
  'admin-people': {
    role: 'franchise_admin',
    path: 'people',
    nav: { label: 'People', icon: Users, order: 9 },
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
    nav: { label: 'Shift', icon: KeyRound, order: 3 },
    state: 'demo',
  },
  /**
   * Open orders, and **deliberately without a navigation entry** — see
   * `counter-my-shift` for the reason the pair lost theirs.
   */
  'counter-open-orders': {
    role: 'biller',
    path: 'open-orders',
    state: 'demo',
  },
  /**
   * The counter itself, and **deliberately without a navigation entry**: it is
   * where `counter-home` sends a biller the moment this surface is renderable
   * for them, so a tab beside Counter would be a second door into one room.
   * Still a surface, because the gate is what decides whether that door opens.
   */
  'counter-billing': {
    role: 'biller',
    path: 'billing',
    state: 'demo',
  },
  /*
    There was a `counter-menu` here — the manager's menu surface without the
    editing, so a biller could answer "is that still on?" without walking to the
    kitchen. **Retired**, because the Counter's own menu column now answers that
    question and never leaves the screen: every item, its price, its veg marker
    and an Off marker on anything the kitchen has run out of. The only thing the
    read-only page still showed that the counter does not is an item's
    description, which is recorded in `docs/LIMITATIONS.md`.
  */
  /**
   * This shift's bills, and **deliberately without a navigation entry**, as of
   * the counter's three-column workspace.
   *
   * Both this and `counter-open-orders` are permanently on screen in the
   * Counter's activity rail, which no longer folds away on a narrow viewport —
   * the workspace scrolls sideways instead. A tab leading to a second copy of a
   * column the biller is already looking at is the second door into one room that
   * `counter-billing` above declines for the same reason. The surfaces and their
   * routes stay, because the gate is still what decides whether the content
   * renders at all, and the standalone layouts are what a link into either one
   * still resolves to.
   */
  'counter-my-shift': {
    role: 'biller',
    path: 'my-shift',
    state: 'demo',
  },
  /**
   * What this outlet spent — **the manual ledger's expense list, and nothing
   * else on it** (the-ledger-opens-to-the-outlet).
   *
   * `live` for the same reason the ledger itself is: it captures real figures
   * against a real trading month, and the alternative is the figure reaching the
   * app by memory at closing time through one of two owners.
   *
   * It carries navigation because recording a spend is a thing somebody does
   * mid-shift, not something they go looking for. Behind Menu, because the menu
   * is consulted many times an evening and this a few times a week.
   *
   * The day record is deliberately NOT reachable from here or anywhere in this
   * shell: outlet staff hold no policy branch on it at all. The path sits under
   * `ledger/` for two reasons — `admin-expenses` already owns `expenses` and is
   * a different thing (#11's live expense record), and everything this stopgap
   * owns should disappear in one sweep when #12 retires it.
   */
  'counter-expenses': {
    role: 'biller',
    path: 'ledger/expenses',
    nav: { label: 'Expenses', icon: Wallet, order: 6 },
    state: 'live',
  },
  // The attendance kiosk is gone, not hidden: the owner rejected it (one
  // shared device, usually busy billing), and a manager's manual entry on the
  // attendance day is the escape hatch instead (staff-as-accounts).

  // ── Employee — a phone, and almost nothing else ──────────────────────────
  'staff-home': {
    role: 'employee',
    path: '',
    nav: { label: 'Home', icon: Home, order: 1, attention: 'counter-request-waiting' },
    state: 'live',
  },
  'staff-attendance': {
    role: 'employee',
    path: 'my-attendance',
    nav: { label: 'My attendance', icon: CalendarCheck, order: 2 },
    state: 'live',
  },
  /**
   * The same surface as `counter-expenses`, reached from the Employee shell.
   *
   * Two entries rather than one, because a surface belongs to exactly one role's
   * shell here — the same reason `owner-devices` and `admin-devices` are separate
   * entries reaching one component. The owner asked for "all staff", and an
   * Employee who goes to the market for vegetables is precisely the person the
   * change exists for.
   */
  'staff-expenses': {
    role: 'employee',
    path: 'ledger/expenses',
    nav: { label: 'Expenses', icon: Wallet, order: 3 },
    state: 'live',
  },
  'staff-profile': {
    role: 'employee',
    path: 'profile',
    nav: { label: 'Profile', icon: UserRound, order: 4 },
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
 * The navigation for a session in one mode.
 *
 * Takes the roles whose surfaces the person may **reach**, most senior first,
 * and returns the **union** of those surfaces — because since
 * multi-outlet-people one person may manage an outlet and work at another, and
 * the proposal ruled out anything they would have to switch. Entries keep their
 * own role, so a link can be built against that role's path segment.
 *
 * Deduplicated by navigation label: `admin-people` and `owner-people` are the
 * same door with the same word on it, and two tabs reading "People" is a
 * question nobody should have to answer. The more senior role's entry wins,
 * because it is the one whose surface reaches further.
 *
 * `held` is the narrower list of roles the person actually holds, and it governs
 * exactly one thing: **a home belongs to a role you hold**. An index surface
 * (`path: ''`) of a role that is merely reachable is left out, because a home is
 * the address a shell opens on and two of them cannot share one
 * (owner-reaches-every-outlet, design D1a). So the owner keeps one Overview
 * rather than gaining a second dashboard tab pointing at the same place. It
 * defaults to `roles`, which is the answer for every session that reaches
 * exactly what it holds.
 *
 * Surfaces without nav metadata (sub-surfaces reached from elsewhere) are
 * excluded regardless of state.
 */
export function visibleSurfaces(
  roles: readonly Role[],
  mode: SessionMode,
  held: readonly Role[] = roles,
): Surface[] {
  const seen = new Set<string>()
  const out: Surface[] = []

  for (const role of roles) {
    const forRole = surfaces
      .filter(
        (surface) => surface.role === role && surface.nav && isRenderable(surface.state, mode),
      )
      .sort((a, b) => (a.nav?.order ?? 0) - (b.nav?.order ?? 0))

    for (const surface of forRole) {
      // A home for a role they do not hold is a second front door on somebody
      // else's address.
      if (surface.path === '' && !held.includes(surface.role)) continue
      const label = surface.nav?.label ?? surface.id
      if (seen.has(label)) continue
      seen.add(label)
      out.push(surface)
    }
  }

  return out
}
