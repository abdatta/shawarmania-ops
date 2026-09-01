import type { LucideIcon } from 'lucide-react'
import {
  Banknote,
  Bike,
  CalendarCheck,
  IndianRupee,
  Home,
  KeyRound,
  LayoutDashboard,
  NotepadText,
  Settings2,
  Store,
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
export type AttentionSourceId =
  | 'attendance-waiting'
  | 'counter-request-waiting'
  // What the Delivery entry badges: the sum across every restaurant channel it
  // can reach. The two below are the same counts undivided, and they stay —
  // they are what the channel switch decomposes the sum onto, so no waiting
  // work sits invisibly behind an unselected channel (attention-badges).
  | 'delivery-needs-you'
  | 'zomato-needs-you'
  // Independent of `zomato-needs-you` by construction: Swiggy's waiting work
  // lives in Swiggy's rows, read through Swiggy's adapter instance, so one
  // channel's resolution can neither create nor clear the other's badge.
  | 'swiggy-needs-you'

/**
 * The navigation groups — **headings with surfaces under them, and no surface
 * of their own** (#51).
 *
 * Sixteen flat entries is a bottom bar the owner has to scroll sideways, with
 * roughly half of it off the right edge and nothing saying it is there. A tab
 * you must remember exists and scroll to find is not navigation.
 *
 * **A group is metadata on a surface, not an address.** `/owner/finances` does
 * not exist and should not: neither Finances nor Setup is a place anybody can
 * stand. Re-pathing was rejected because it would re-home eight live routes the
 * owner has on their phone to buy an address nobody would open. Every surface
 * keeps the path it has, so every link already in circulation still resolves —
 * only where an entry is *drawn* changes.
 */
export type NavGroupId = 'finances' | 'setup'

export interface NavGroup {
  id: NavGroupId
  label: string
  icon: LucideIcon
  /**
   * Sorted against the ungrouped top-level entries on **one scale**, so a group
   * takes its place among them rather than being pushed to one end.
   */
  order: number
}

/**
 * `IndianRupee` for Finances and `Settings2` for Setup (owner decision, 2026-09-01).
 *
 * Neither may take a child's icon: `Wallet` is Expenses's and `Banknote` is the
 * Drawer's, so either would read as one of the entries inside it rather than as
 * the drawer holding them.
 *
 * **Finances rather than Sales**, because it holds Expenses, which is money
 * out. **Setup** is the things you change when something changes, rather than
 * the things you read every evening.
 *
 * A group's order is the same for every role, unlike a surface's. If a manager
 * ever needs Setup ahead of Attendance while the owner does not, this is what
 * has to give.
 */
export const NAV_GROUPS: Record<NavGroupId, NavGroup> = {
  finances: { id: 'finances', label: 'Finances', icon: IndianRupee, order: 3 },
  setup: { id: 'setup', label: 'Setup', icon: Settings2, order: 5 },
}

/**
 * The shells that draw navigation groups at all.
 *
 * The Super Admin's and the Franchise Admin's do; the Employee's and the
 * Biller's do not, and that is a decision about those shells rather than an
 * omission. **The Employee shell carries three entries** — Home, My attendance,
 * Expenses — so folding one of them behind a heading would cost a tap to reach
 * a group that could never hold more than one child. **The counter tablet has
 * no navigation at all**: no tabs, no account menu, no sign-out, because
 * personal navigation on shared hardware offers whoever is standing at it
 * somebody else's screens.
 *
 * `registry.test.ts` holds both halves of this to account: a role that is not
 * here declares no group on any entry, and among the roles that are, two
 * entries sharing a label agree on their group. Together those are what stop a
 * senior role's placement silently overriding a junior role's different one —
 * `visibleSurfaces` dedupes by label and the senior wins, so without them the
 * two readers would hold different maps of one application.
 */
export const GROUPED_SHELL_ROLES: readonly Role[] = ['super_admin', 'franchise_admin']

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
   *
   * `group` names the heading this entry is drawn under. It changes nothing
   * about the surface's address — see `NavGroupId`.
   *
   * **`order` is unique per sibling set, not per role** (#51). It sorts an
   * entry against the entries it is drawn beside: the other top-level entries
   * and the groups when it is ungrouped, the rest of its group when it is
   * grouped. So Billing and Outlets are both `1` in different drawers, and a
   * repeat across two groups is not the collision a repeat inside one is.
   */
  nav?: {
    label: string
    icon: LucideIcon
    order: number
    group?: NavGroupId
    attention?: AttentionSourceId
  }
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
    nav: { label: 'Outlets', icon: Store, order: 1, group: 'setup' },
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
    nav: { label: 'People', icon: Users, order: 2, group: 'setup' },
    state: 'live',
  },
  /**
   * What the outlet took, **directly above what should be in its drawer**.
   *
   * This sat at order 12 — behind People, Compare and Alerts — and none of those
   * is reached as often as the day's money. The adjacency is the point rather
   * than the number: takings and drawer are read in one sitting, one against the
   * other, and a tab between them is a tab the reader scrolls past twice.
   */
  'owner-billing-history': {
    role: 'super_admin',
    path: 'billing-history',
    nav: { label: 'Billing', icon: ReceiptText, order: 1, group: 'finances' },
    state: 'live',
  },
  /**
   * There was a manual ledger here (#36) — `live`, and designed to be deleted.
   * `retire-the-manual-ledger` (#12) carried its rows into the drawer and the
   * one expense record and deleted it, entry and all. Not `hidden`: hiding is
   * for a surface whose route still resolves, and this one's does not.
   */
  /**
   * The drawer as a continuous balance (#11).
   *
   * **It opens on a balance, not a date picker**, because that is the question
   * the collector has when they walk in: what should be in the drawer right now.
   *
   * `live` from this change rather than `demo`, and the reason is unusual enough
   * to state: there is no previous behaviour to protect. `daily_cash_records` has
   * never held a production row, so the surface being replaced never ran against
   * real data, and a `demo` gate would mean two trading counters with no way to
   * record a count at all.
   *
   * Ahead of the Ledger it feeds, because a count is taken nightly and a
   * statement is read afterwards.
   */
  'owner-cash-drawer': {
    role: 'super_admin',
    path: 'drawer',
    nav: { label: 'Drawer', icon: Banknote, order: 2, group: 'finances' },
    state: 'live',
  },
  /**
   * The Ledger, derived on read with **no editable figure on it** (#11).
   *
   * This entry took the navigation label the manual ledger had, while that form
   * kept working at its own route as the fallback — decision 17: **the fallback
   * is a tab, not a runtime toggle**, so the owner could open one business date
   * in each and compare them, which was the two-day acceptance test they asked
   * for with no engineering behind it. `retire-the-manual-ledger` (#12) ended
   * the overlap once that comparison had been made on real trading days, and
   * this is now the only reading of a trading day — every date the business has
   * traded, including the ones that predate the tablets.
   */
  'owner-ledger-statement': {
    role: 'super_admin',
    // `ledger`, because this IS the Ledger now. The sidebar nests a `ledger/*`
    // entry under the `ledger` entry, so whichever surface holds this path
    // becomes the parent of Expenses, Delivery and the notebook. Leaving it
    // on the notebook rendered three live surfaces as children of the one being
    // retired.
    path: 'ledger',
    nav: { label: 'Ledger', icon: NotepadText, order: 4, group: 'finances' },
    state: 'live',
  },
  /**
   * What this outlet spent — the same surface the people who spend the money
   * use, reached from the owner's shell.
   *
   * **It exists because #11 took the door away and had to give it back.** Both
   * the owner and the manager recorded expenses through the manual Ledger
   * surface; that surface left the navigation when the derived statement took
   * its place, and the derived statement deliberately has no editable figure.
   * Expenses became unreachable in the real app for exactly the two roles that
   * read the Ledger nightly.
   *
   * Directly **before** the Ledger, which reverses where it first sat. The
   * original reasoning was that the Ledger is where somebody notices an expense
   * is missing, so the door should be the next tab along. In use it reads the
   * other way round: the nightly walk is count the drawer, record what was
   * spent, then read the statement those two produce — so Expenses belongs
   * between the Drawer and the Ledger, and the Ledger stays the thing you end
   * on. The path is `ledger/expenses` — the same route the
   * Biller and the Employee already reach, the same component, the same rows,
   * and no change to how an expense is recorded. #12 re-homes all of it when it
   * promotes the notebook's expense table to be the real one.
   */
  'owner-expenses': {
    role: 'super_admin',
    path: 'ledger/expenses',
    nav: { label: 'Expenses', icon: Wallet, order: 3, group: 'finances' },
    state: 'live',
  },
  'owner-expense-categories': {
    role: 'super_admin',
    path: 'ledger/categories',
    state: 'live',
  },
  /**
   * What the restaurant delivery channels' sync did, and what needs the owner
   * about it (#42, #47, #48).
   *
   * **One entry for both channels.** Zomato and Swiggy have been one component
   * since #47 — the whole difference between them is a title, an icon, a few
   * sentences and whether Hyperpure rides along — and two navigation rows for
   * one screen cost the owner two of their twelve tabs. The channel is chosen on
   * the surface and carried in the route, so a badge, a link or a returning
   * reader lands on the channel the work is actually on.
   *
   * It carries navigation because a surface that only reports failures still has
   * to be findable before one happens. It sits after the Ledger it explains.
   *
   * The badge is the sum across both channels, and the switch on the surface
   * decomposes it — see `delivery-needs-you` above.
   */
  'owner-delivery-sync': {
    role: 'super_admin',
    // The surface's address; the channel is a parameter beneath it, resolved
    // against this pattern. A gate is a question about the surface, not about
    // which of its addresses is open — and navigation needs an entry point it
    // can build a link to, which a path carrying `:channel` is not.
    path: 'ledger/delivery',
    nav: {
      label: 'Delivery',
      icon: Bike,
      order: 3,
      group: 'setup',
      attention: 'delivery-needs-you',
    },
    // Live [owner, 2026-08-18 for Zomato; #47 for Swiggy]. The ledger already
    // fills itself from both; this is the page that says when each last ran,
    // what moved, and what wants a decision — including the Reconnect the owner
    // needs when a session lapses, which is the one repair they cannot make
    // anywhere else.
    state: 'live',
  },
  /**
   * The two per-channel entries `owner-delivery-sync` replaced (#48).
   *
   * Not deleted, deliberately — the convention `admin-daily-cash` states. What
   * two gates bought was promoting or demoting one channel without the other,
   * and that is worth nothing today: both are live and both are reached through
   * the one entry above. **If it is ever needed the cheaper lever is not the
   * registry** — a channel is data in
   * `src/features/aggregator-sync/channel-config.ts`, so it can be withheld by
   * not building its config, with no route, gate or badge involved (design D9).
   *
   * `hidden` means the old paths stop resolving on their own, so `surfaces.tsx`
   * redirects `ledger/zomato` and `ledger/swiggy` into the merged route rather
   * than answering a URL the owner may have on their phone with a 404.
   */
  'owner-zomato-sync': {
    role: 'super_admin',
    path: 'ledger/zomato',
    state: 'hidden',
  },
  'owner-swiggy-sync': {
    role: 'super_admin',
    path: 'ledger/swiggy',
    state: 'hidden',
  },
  /**
   * The owner's counterpart to `admin-devices`, across every outlet.
   *
   * Two entries rather than one, for the reason the ledger has two: a surface
   * belongs to exactly one role's shell here. **Neither declares navigation**
   * since #51 — tablets are administered from the outlet they stand in, and
   * every outlet card carries the button. What this entry does is make the path
   * resolve inside the owner's shell.
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
  /**
   * **Labelled `Overview`, the same word the owner's home carries**, because
   * since #51 it is the same screen: `outlets-overview.tsx`, scoped by the
   * database to the outlets this reader's assignments name.
   *
   * It said `Today` and rendered a placeholder of its own. Once both homes
   * became one component that name was two things at once — a second word for
   * one screen, and, for anybody holding **both** roles, a second tab showing
   * exactly what the first one showed. Sharing the label lets `visibleSurfaces`
   * do what it already does: dedupe by label, keep the senior role's entry, and
   * leave that person one home instead of two identical ones.
   *
   * It is still a separate surface at its own address. `/admin` has to land
   * somewhere, and a manager who holds no owner role reaches this entry and
   * nothing else.
   */
  'admin-dashboard': {
    role: 'franchise_admin',
    path: '',
    nav: {
      label: 'Overview',
      icon: LayoutDashboard,
      order: 2,
      attention: 'counter-request-waiting',
    },
    state: 'live',
  },
  /**
   * The outlets this manager runs, **read-only** (#51).
   *
   * They had none until that change, and the gap became a hole when Tablets
   * stopped being a top-level entry: `admin-devices` is the only place a
   * counter setup code is minted, so without a door to the outlet the tablet
   * stands in, a manager whose tablet dies has no route to the one screen that
   * can replace it. That is the one repair they cannot make anywhere else.
   *
   * Same label and same group as `owner-outlets`, so label dedup can only ever
   * produce one Outlets entry and it is always drawn in the same drawer. The
   * surface is shared too; what differs is which controls it offers — and that
   * is courtesy rather than the boundary. Create, edit, close, reopen, delete
   * and capture stay the Super Admin's, refused by `outlets_insert`,
   * `outlets_update` and `outlets_delete` in Postgres, and proved by the
   * isolation suite with a hand-crafted request.
   */
  'admin-outlets': {
    role: 'franchise_admin',
    path: 'outlets',
    nav: { label: 'Outlets', icon: Store, order: 1, group: 'setup' },
    state: 'live',
  },
  'admin-menu': {
    role: 'franchise_admin',
    path: 'menu',
    nav: { label: 'Menu', icon: UtensilsCrossed, order: 4, group: 'setup' },
    state: 'live',
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
      order: 4,
      attention: 'attendance-waiting',
    },
    state: 'live',
  },
  'admin-billing-history': {
    role: 'franchise_admin',
    path: 'billing-history',
    nav: { label: 'Billing', icon: ReceiptText, order: 1, group: 'finances' },
    state: 'live',
  },
  /**
   * The manager's counterpart to the owner's Ledger, scoped by assignment.
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
  /**
   * The manager's counterpart to `owner-cash-drawer`, scoped by assignment.
   *
   * A surface belongs to exactly one role's shell here, so the drawer needs two
   * entries reaching one component — the same reason `owner-devices` and
   * `admin-devices` are separate. What differs between them is nothing the
   * screen can see: `app_may_reach_drawer()` grants a Super Admin every outlet
   * and a Franchise Admin the ones their live assignment names, and the database
   * is where that is decided.
   */
  'admin-cash-drawer': {
    role: 'franchise_admin',
    path: 'drawer',
    nav: { label: 'Drawer', icon: Banknote, order: 2, group: 'finances' },
    state: 'live',
  },
  'admin-ledger-statement': {
    role: 'franchise_admin',
    path: 'ledger',
    nav: { label: 'Ledger', icon: NotepadText, order: 4, group: 'finances' },
    state: 'live',
  },
  /**
   * The manager's counterpart to `owner-expenses`, and the same component again.
   *
   * The same canonical surface is used in demo and live mode.
   */
  'admin-ledger-expenses': {
    role: 'franchise_admin',
    path: 'ledger/expenses',
    nav: { label: 'Expenses', icon: Wallet, order: 3, group: 'finances' },
    state: 'live',
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
    // **No navigation entry, deliberately** (owner decision, 2026-09-01).
    //
    // A tablet is administered from the outlet it stands in. Every outlet card
    // now carries that counter's state and a Tablets button addressed to it, so
    // an entry here would be a second door into one room — the same thing
    // `counter-billing` and `counter-my-shift` decline, for the same reason.
    //
    // It also restores the argument for the manager's Outlets surface. That
    // surface exists *because* this one is only reachable through an outlet; an
    // entry beside it would have made the door redundant while the reasoning
    // still claimed it was the only one.
    //
    // The surface stays `live`: the gate is still what decides whether the path
    // resolves, and it must, because this is the only place a counter setup code
    // is minted. `devices/:outletId` is what the card links to, and the bare
    // `devices` path still answers for anybody holding that link.
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
    nav: { label: 'People', icon: Users, order: 2, group: 'setup' },
    state: 'live',
  },

  // ── Biller — the counter tablet ──────────────────────────────────────────
  /**
   * The tablet's index, and **deliberately without a navigation entry** since
   * the demo began mounting the enrolled tablet's own shell.
   *
   * A counter tablet has no navigation at all: no tabs, no account menu, no
   * sign-out. That is the shape of the production screen rather than an
   * omission — personal navigation on a shared counter would offer whoever is
   * standing at it somebody else's screens. The demo used to draw Counter and
   * Expenses tabs here because it rendered a role shell instead; now it renders
   * the same file `/counter` does, so there is no header left to draw them in
   * and nothing that would honour them.
   *
   * The surface stays `live`: the gate is still what decides whether the tablet's
   * index resolves at all.
   */
  'counter-home': {
    role: 'biller',
    path: '',
    state: 'live',
  },
  'counter-shift-unlock': {
    role: 'biller',
    path: 'shift',
    nav: { label: 'Shift', icon: KeyRound, order: 3 },
    state: 'hidden',
  },
  /**
   * Open orders, and **deliberately without a navigation entry** — see
   * `counter-my-shift` for the reason the pair lost theirs.
   */
  'counter-open-orders': {
    role: 'biller',
    path: 'open-orders',
    state: 'live',
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
    state: 'live',
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
    state: 'live',
  },
  /**
   * What this outlet spent — **the expense list, and nothing else on it**
   * (the-ledger-opens-to-the-outlet).
   *
   * `live` for the same reason the ledger itself is: it captures real figures
   * against a real trading month, and the alternative is the figure reaching the
   * app by memory at closing time through one of two owners.
   *
   * It carries navigation because recording a spend is a thing somebody does
   * mid-shift, not something they go looking for. Behind Menu, because the menu
   * is consulted many times an evening and this a few times a week.
   *
   * The day record was deliberately NOT reachable from here or anywhere in this
   * shell, and now it is reachable from nowhere at all: `retire-the-manual-ledger`
   * (#12) retired it. The path still sits under `ledger/` because
   * `admin-expenses` already owns `expenses` and is a different thing. #12
   * promoted this record's table to be the real `expenses`, by rename, because
   * it was the richer of the two — so this entry outlived the stopgap it was
   * written as part of.
   */
  /**
   * Navigation retired with `counter-home`'s, and for the same reason: the
   * tablet has no tabs to put it in.
   *
   * Expenses did not go anywhere. The enrolled shell renders the expense list as
   * a panel directly beneath the till, which is where it has always been in
   * production — the drawer is at the counter and the person spending is often
   * the person billing. A tab leading to a second copy of a panel already on
   * screen is the second door into one room that `counter-billing` declines.
   */
  'counter-expenses': {
    role: 'biller',
    path: 'ledger/expenses',
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
    nav: { label: 'My attendance', icon: CalendarCheck, order: 6 },
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
    nav: { label: 'Expenses', icon: Wallet, order: 7 },
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

/**
 * One top-level navigation node: either a surface, or a group with children.
 *
 * The shells draw this rather than the flat list, so the phone bar and the rail
 * cannot disagree about what is a group or what is inside one.
 */
export type NavNode =
  | { kind: 'surface'; order: number; surface: Surface }
  | { kind: 'group'; order: number; group: NavGroup; children: Surface[] }

/**
 * Fold the flat navigation into its two levels (#51).
 *
 * Takes what `visibleSurfaces` returned — already deduplicated by label and
 * already narrowed to this session and mode — so a group here can only ever
 * hold entries the reader may actually open. That is what makes a group's
 * badge safe: it cannot count work behind a door this reader has not got.
 *
 * **A group appears only when at least one of its children is visible.** An
 * empty heading is worse than no heading: it promises a room that is not
 * there.
 *
 * **Groups and ungrouped surfaces sort against each other on one scale**, so
 * Finances takes its place between Today and Attendance rather than being
 * pushed to one end. Inside a group, children sort among themselves.
 *
 * **Path-derived nesting is deliberately not applied inside a group.** Expenses
 * lives under the Ledger's path and is drawn as its sibling in Finances,
 * because two levels of structure over four entries is one more than the reader
 * needs. The shell still indents a nested entry that is *not* in a group, which
 * is what keeps the rail's existing behaviour for anything ungrouped.
 */
export function navTree(items: readonly Surface[]): NavNode[] {
  const nodes: NavNode[] = []
  const groups = new Map<NavGroupId, NavNode & { kind: 'group' }>()

  for (const surface of items) {
    const groupId = surface.nav?.group
    if (!groupId) {
      nodes.push({ kind: 'surface', order: surface.nav?.order ?? 0, surface })
      continue
    }

    let node = groups.get(groupId)
    if (!node) {
      const group = NAV_GROUPS[groupId]
      node = { kind: 'group', order: group.order, group, children: [] }
      groups.set(groupId, node)
      nodes.push(node)
    }
    node.children.push(surface)
  }

  for (const node of groups.values()) {
    node.children.sort((a, b) => (a.nav?.order ?? 0) - (b.nav?.order ?? 0))
  }

  return nodes.sort((a, b) => a.order - b.order)
}

/** Every surface a node leads to — one for a surface, all its children for a group. */
export function nodeSurfaces(node: NavNode): readonly Surface[] {
  return node.kind === 'surface' ? [node.surface] : node.children
}
