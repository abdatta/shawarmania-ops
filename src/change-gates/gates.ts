/**
 * Every change gate the code knows, and every one it has retired
 * (a-release-can-be-switched-off, design D4).
 *
 * **A change gate applies or removes one change while the app runs** — the
 * owner's name for it (2026-10-12): "a toggle to apply/remove a change
 * dynamically". It is not a surface gate: `src/gates/registry.ts` decides
 * whether a screen exists, and is changed by a deploy; a change gate decides
 * which behaviour an existing screen runs, and is changed by the owner.
 *
 * **Declared twice, on purpose.** The migration that introduces a gate inserts
 * its row into `change_gates`, so it exists in production before any bundle
 * reads it, with the owner-facing words the Change gates page shows. This file
 * declares the same key, so a toggle point names a gate the compiler knows, and
 * carries what only the repository needs. `npm run lint:change-gates` fails when
 * the two disagree.
 *
 * **One answer for the whole business** (owner, 2026-10-12). **Unknown is off,
 * and off is the behaviour as it was before.**
 */

export type ChangeGateKind =
  /** Temporary. Removed by a retirement change once the change has run on. */
  | 'change'
  /** A permanent kill switch. Rare, and its declaration says why it must stay. */
  | 'ops'

export interface ChangeGateDeclaration {
  kind: ChangeGateKind
  /**
   * Two characters, capitals or digits, at least one a letter: 36² codes,
   * unique among the gates not yet retired, which is the set any one build can
   * name (owner, 2026-10-13). A retired gate's code may be given out again; its
   * key never is. A page's build code lists the codes of the gates it loaded
   * with on — `c1f19c32·DT-KR` — so "which changes is that tablet running?" is
   * one line read off its screen.
   */
  code: string
  /** The OpenSpec change folder that introduced it. Every gate has one. */
  change: string
  /**
   * The gates this one is dependent on (owner, 2026-10-13: "a CG can be
   * dependent on multiple other CGs"). It can be turned on only while every one
   * of them is on; turning any of them off turns it off too; and a page runs it
   * only while every gate it depends on, directly or through another, is on.
   */
  dependsOn?: readonly string[]
  /**
   * The date (YYYY-MM-DD) by which its retirement change is due. Lint warns from
   * this date and fails fourteen days after it; moving it is a reviewed edit with
   * a reason. Every `change` gate has one, except a self-test gate, which is
   * never retired.
   */
  retireBy?: string
  /**
   * How turning it off was proved to strand nothing. `'tested'` when a browser
   * test tagged `@cg-round-trip:<key>` exists; otherwise a sentence starting
   * `none:` saying why there is nothing to strand.
   */
  roundTrip: 'tested' | `none: ${string}`
  /**
   * The gate system's own test switch, kept for good (owner, 2026-10-16). It has
   * no toggle point and depends on nothing, so it doubles nothing a suite must
   * run: it counts toward no limit, has no `retireBy`, and `/next-change` never
   * lists it as due. Declared only here: its row stays a `change` gate.
   */
  selfTest?: true
  /** For an `ops` or a self-test gate: why it is permanent. */
  reason?: string
}

export const CHANGE_GATES = {
  /**
   * Proves the path end to end with no product risk: its only effect is its own
   * code appearing in the build stamp (design D16). The switch the gate system's
   * own tests turn — the demo and authenticated suites, and the staging smoke
   * run after every publish — so it stays.
   */
  probe: {
    kind: 'change',
    code: 'PB',
    change: 'a-release-can-be-switched-off',
    selfTest: true,
    reason:
      'the gate system’s own tests and the staging smoke run turn it to prove a turn reaches every tablet, and no product gate can be turned for that',
    roundTrip: 'none: the probe changes nothing but its code in the build stamp',
  },
  /**
   * #79 follow-up: a fixed cost's part month costs the figure agreed for it,
   * stopping asks for the final payment, a mid-month start asks what that month
   * comes to, and a stopped cost stays in its place for the month it stopped in
   * (part-months-cost-what-was-agreed, design D1–D5). Off, a part month costs
   * its share by days and stopped costs sit under Stopped at the foot.
   */
  'agreed-part-months': {
    kind: 'change',
    code: 'AM',
    change: 'part-months-cost-what-was-agreed',
    retireBy: '2027-02-28',
    roundTrip:
      'none: nothing is queued, and what it saves is a settlement, a stop date and a payment, which the off path already reads',
  },
  /**
   * A set-up tablet opens only its own home and the pages beneath it, whatever
   * address it is given, and `signIn` and `redeemInvite` refuse while the
   * browser holds a tablet's session (a-tablet-keeps-its-login, design D1–D2).
   * A person signing in on the counter laptop used to replace the tablet's
   * session in the one storage slot, and signing out left it unregistered. Off,
   * `/sign-in` and `/activate` show their forms on a tablet as before.
   * Retirement removes the per-screen tablet redirects in `RealRoot`,
   * `RootResolver`, `CounterRoot`, `KitchenRoot` and `CounterSetup`, which the
   * boundary makes redundant.
   */
  'a-tablet-keeps-its-login': {
    kind: 'change',
    code: 'TK',
    change: 'a-tablet-keeps-its-login',
    // Eight weeks after it was first turned on in production, 2026-11-01.
    retireBy: '2026-12-27',
    roundTrip:
      'none: it changes which page a tablet is shown and refuses a sign-in before it is sent; nothing is written or queued either way',
  },
  /**
   * #83: an outlet may offer Delivery, whose orders the kitchen makes and the
   * counter hands to a rider without a bill; labels are kept after an order
   * leaves the rail; and Stats, Billing History, Items and Sales gain a Counter ·
   * Delivery switch (delivery-orders-are-made-not-billed, design D1–D9). Off,
   * every order is billed or cancelled, labels go when an order leaves the
   * rail, and no page shows delivery orders. A delivery order saved while on
   * reads as a plain open order with the gate off, so it is turned off with no
   * delivery order on the rail.
   */
  'delivery-orders': {
    kind: 'change',
    code: 'DO',
    change: 'delivery-orders-are-made-not-billed',
    retireBy: '2027-02-28',
    roundTrip: 'tested',
  },
  /**
   * #82: Deactivate records the day and moves the person to a Deactivated
   * section; Remove is offered only there, ends their outlets on that day
   * and frees their username and phone; attendance stops listing them after it
   * (a-deactivated-person-leaves-in-two-steps, design D1–D4, D8). Off, Team and
   * Attendance read as before and Mark as left is in Edit.
   */
  'deactivate-then-leave': {
    kind: 'change',
    code: 'DL',
    change: 'a-deactivated-person-leaves-in-two-steps',
    retireBy: '2027-03-31',
    roundTrip:
      'none: nothing is queued, and a person left while it was on is an inactive account with ended assignments, no phone and no username, which the off path already reads as somebody who has left',
  },
  /**
   * #82: nobody grants or removes owner access, or deactivates an owner, from
   * Team, and the account function refuses it (design D5). Off, the owner
   * grants and removes owner access from Team as before.
   */
  'owner-access-in-the-database': {
    kind: 'change',
    code: 'OD',
    change: 'a-deactivated-person-leaves-in-two-steps',
    retireBy: '2027-03-31',
    roundTrip:
      'none: it changes what Team offers and what the account function accepts, and writes nothing',
  },
} as const satisfies Record<string, ChangeGateDeclaration>

export type ChangeGateKey = keyof typeof CHANGE_GATES

/** In declaration order. */
export const CHANGE_GATE_KEYS = Object.keys(CHANGE_GATES) as ChangeGateKey[]

/**
 * Tombstones. A key here is never declared again — a name that once gated one
 * change must never wake up meaning another (Knight Capital, design research).
 * The database enforces the same with rows that are never deleted. Codes are
 * not tombstoned: they are unique among live gates only.
 */
export const RETIRED_CHANGE_GATES: readonly string[] = [
  // retire-auto-approve-at-the-shop, with the two gates that depended on it: a
  // check-in inside the fence approves itself under the outlet's rules, the
  // staff screens are the refreshed ones, and an expense's category is picked
  // from the owners' list. Children first, as the auth suite turns their rows
  // on in reverse, parents first.
  'expense-category-list',
  'refreshed-staff-screens',
  'auto-approve-at-the-shop',
  // retire-pro-rata-pnl: Overview and the Ledger's current month show Pro-rata
  // P&L beside P&L, and a fixed-cost payment carries the Fixed chip.
  'pro-rata-pnl',
  // retire-tablet-health: tablets count their requests and report their health
  // each minute.
  'tablet-health',
  // retire-role-includes: every check of what a staff member may do asks which
  // staff role includes which.
  'role-includes',
  // retire-fewer-requests: the app skips the re-reads nothing asked for, and a
  // tablet's minute gate answers ride on its health report.
  'fewer-requests',
  // retire-one-revenue: Overview, the Ledger and Analytics count revenue one
  // way, and `pro-rata-pnl` no longer depends on it.
  'one-revenue',
  // retire-outside-tap-closes: a tap outside a pop-up always closes it.
  'outside-tap-closes',
  // retire-dish-ticks, with the two gates that depended on it: the counter is
  // the menu and a two-column rail, each dish is ticked off on its own, the
  // kitchen marks food Done, and the counter draws its own saves at once.
  'instant-saves',
  'kitchen-ready',
  'dish-ticks',
]

export function isChangeGateKey(key: string): key is ChangeGateKey {
  return Object.prototype.hasOwnProperty.call(CHANGE_GATES, key)
}

/** The declared gates a declaration depends on directly. */
export function dependenciesOf(key: ChangeGateKey): ChangeGateKey[] {
  const declared = CHANGE_GATES[key] as ChangeGateDeclaration
  return (declared.dependsOn ?? []).filter(isChangeGateKey)
}

/** A code is two characters, capitals or digits, at least one of them a letter. */
export const GATE_CODE = /^(?=.*[A-Z])[A-Z0-9]{2}$/
