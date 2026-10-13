import type { BrowserContext } from '@playwright/test'

import {
  CHANGE_GATES,
  CHANGE_GATE_KEYS,
  type ChangeGateDeclaration,
} from '../../src/change-gates/gates'
import { DEMO_GATES_KEY, SAVED_ANSWERS_KEY } from '../../src/change-gates/snapshot'

/**
 * Which way the browser suites run every change gate
 * (a-release-can-be-switched-off, design D10).
 *
 * `CHANGE_GATES=off` (the default) is production's state and the way back;
 * `CHANGE_GATES=on` is every release. `verify.yml` runs the off suites in its
 * existing jobs and the on suites in two more. Tags decide what runs where:
 *
 * - `@cg-on:<key>` runs only with gates on: its assertion holds only then.
 * - `@cg-off:<key>` runs only with gates off. **Adding that tag is the only
 *   change an existing test may receive** when a gate changes what it asserts.
 * - `@cg-round-trip:<key>` runs with gates on, turns its own gate alone off
 *   mid-test, and finishes the work on the old path.
 * - Untagged tests run both ways.
 */

export type GateState = 'off' | 'on'

export function gateState(value = process.env['CHANGE_GATES']): GateState {
  if (value === undefined || value === '' || value === 'off') return 'off'
  if (value === 'on') return 'on'
  throw new Error(`CHANGE_GATES must be "on" or "off", not "${value}"`)
}

export const GATE_STATE = gateState()

/** The tests a run leaves out: the other state's. */
export function skippedTags(state: GateState): RegExp {
  return state === 'on' ? /@cg-off:/ : /@cg-(on|round-trip):/
}

/** Every declared gate, one way. */
export function everyGate(on: boolean): Record<string, boolean> {
  return Object.fromEntries(CHANGE_GATE_KEYS.map((key) => [key, on]))
}

/** Declared keys with every gate before the gates that depend on it. */
export function parentsFirst(): string[] {
  const ordered: string[] = []
  const visit = (key: string) => {
    if (ordered.includes(key)) return
    const declared = CHANGE_GATES[key as keyof typeof CHANGE_GATES] as ChangeGateDeclaration
    for (const parent of declared.dependsOn ?? []) visit(parent)
    ordered.push(key)
  }
  for (const key of CHANGE_GATE_KEYS) visit(key)
  return ordered
}

/**
 * Seed a context's storage before its first page runs, only where nothing is
 * saved yet — so a turn a test makes, and a reload after it, are kept.
 */
async function seed(
  context: BrowserContext,
  area: 'localStorage' | 'sessionStorage',
  key: string,
  answers: Record<string, boolean>,
) {
  await context.addInitScript(
    ({ area, key, value }) => {
      try {
        const storage = window[area]
        if (storage.getItem(key) === null) storage.setItem(key, value)
      } catch {
        // Storage refused: the page boots as it would anyway.
      }
    },
    { area, key, value: JSON.stringify(answers) },
  )
}

/**
 * The demo starts every gate on (D15), so the off run turns each declared gate
 * off in the demo's own answers.
 */
export async function seedDemoGates(context: BrowserContext, state: GateState = GATE_STATE) {
  if (state === 'off') await seed(context, 'sessionStorage', DEMO_GATES_KEY, everyGate(false))
}

/**
 * A real device boots from the answers it last saved. Without them it would boot
 * off, read the database's answer, and reload into it at its first free moment
 * — a reload in the middle of a test. Seeding the run's answers boots it the way
 * a tablet that has already heard the turn boots.
 */
export async function seedDeviceGates(context: BrowserContext, state: GateState = GATE_STATE) {
  await seed(context, 'localStorage', SAVED_ANSWERS_KEY, everyGate(state === 'on'))
}
