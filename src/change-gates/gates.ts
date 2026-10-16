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
   * Tablets count their requests and report their health each minute. The
   * counting wraps every request the app makes, so it is gated like any other
   * new behaviour (design D13, D16).
   */
  'tablet-health': {
    kind: 'change',
    code: 'TH',
    change: 'a-release-can-be-switched-off',
    retireBy: '2026-11-30',
    roundTrip:
      'none: a health report is overwritten every minute and no other path reads what it writes',
  },
  /**
   * #74 relaunched (each-dish-is-ticked-off, design R1): the two-column counter,
   * labels, dish notes and each dish ticked off on its own, with the kitchen
   * seeing only the food it still owes. Off is the counter and kitchen as they
   * were before #74.
   */
  'dish-ticks': {
    kind: 'change',
    code: 'DT',
    change: 'each-dish-is-ticked-off',
    retireBy: '2026-12-15',
    roundTrip: 'tested',
  },
  /**
   * The kitchen's Done, and on the counter the dish's orange fill and two rings
   * of the handbell (design R1, R6). Runs only while `dish-ticks` is on: its
   * whole effect on the counter is on a dish row only the ticks draw.
   */
  'kitchen-ready': {
    kind: 'change',
    code: 'KR',
    change: 'each-dish-is-ticked-off',
    dependsOn: ['dish-ticks'],
    retireBy: '2026-12-15',
    roundTrip: 'tested',
  },
  /**
   * The counter draws an order, an edit or a payment from the tablet's own
   * record the moment it is saved, instead of waiting for the server's re-read
   * (the-counter-shows-what-it-saved, design D1–D6). Built for the counter #74
   * runs, so it runs only while both of #74's gates are on (D7).
   */
  'instant-saves': {
    kind: 'change',
    code: 'IS',
    change: 'the-counter-shows-what-it-saved',
    dependsOn: ['dish-ticks', 'kitchen-ready'],
    retireBy: '2027-01-15',
    roundTrip:
      'none: the on path persists nothing; it draws the tablet’s own queue and cache sooner, and every save is the same command with the gate on or off',
  },
  /**
   * The app skips re-reads it does not need (the-app-asks-the-server-less,
   * design D1–D8): the kitchen's categories, the counter's menu on every sale,
   * the expense list's per-category counts, badges on every return to the
   * foreground, a tablet's separate minute gate read. Off, every screen
   * re-reads exactly as it did before.
   */
  'fewer-requests': {
    kind: 'change',
    code: 'FR',
    change: 'the-app-asks-the-server-less',
    retireBy: '2027-01-31',
    roundTrip:
      'none: the on path changes when the app reads, never what it writes; a v2 health report writes the row a v1 report writes',
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
  // retire-outside-tap-closes: a tap outside a pop-up always closes it.
  'outside-tap-closes',
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
