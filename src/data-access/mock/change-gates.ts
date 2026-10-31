import {
  DataActionError,
  type AppRole,
  type ChangeGateEvent,
  type ChangeGateSummary,
  type ChangeGatesAdapter,
  type DeviceHealthReading,
} from '../adapters'
import { CHANGE_GATES, CHANGE_GATE_KEYS, type ChangeGateDeclaration } from '@/change-gates/gates'
import {
  ALL_ON,
  DEMO_GATES_KEY,
  readSavedAnswers,
  snapshotFrom,
  writeSavedAnswers,
  type GateSnapshot,
  type SavedAnswers,
} from '@/change-gates/snapshot'

import {
  DEMO_COUNTER_DEVICE_ID,
  DEMO_COUNTER_DEVICE_TWO_ID,
  DEMO_KANCHRAPARA_DEVICE_ID,
} from './fixtures/billing'
import { OUTLET_KALYANI_ID, OUTLET_KANCHRAPARA_ID, outletFixtures } from './fixtures/outlets'
import { personaFixtures } from './fixtures/personas'
import { DEMO_KITCHEN_DEVICE_ID, DEMO_KITCHEN_LABEL } from './kitchen'

/**
 * The demo's change gates (a-release-can-be-switched-off, design D15).
 *
 * **Every gate starts on**, so the walkthrough shows the newest behaviour; the
 * Change gates page turns one off to compare. Its turns — answers and history —
 * are kept in this tab's session storage, because a demo reload rebuilds every
 * other piece of demo state and a gate turned off for a comparison should stay
 * off across that; a demo reset forgets them with everything else. Where they
 * are kept is declared beside the real device's key, in `@/change-gates/snapshot`,
 * because the browser suites' gates-off run seeds it too (D10).
 */
export { DEMO_GATES_KEY }

/** The turns made in this demo, kept beside the answers for the same reason. */
export const DEMO_TURNS_KEY = 'shawarmania.demo.change-gate-turns'

/** The declared gates' owner-facing words and roadmap numbers, as their migrations insert them. */
const WORDS: Record<
  (typeof CHANGE_GATE_KEYS)[number],
  Pick<ChangeGateSummary, 'title' | 'onMeans' | 'offMeans' | 'changeNumber'>
> = {
  probe: {
    title: 'Probe',
    onMeans: 'Every build code includes PB.',
    offMeans: 'PB is not in the build code.',
    changeNumber: 75,
  },
  'pro-rata-pnl': {
    title: 'Pro-rata P&L',
    onMeans:
      'Overview and the Ledger’s current month show Pro-rata P&L, which charges the unpaid share of this month’s fixed costs up to today, beside P&L.',
    offMeans:
      'Overview and the Ledger show one P&L that counts every cost on the date it was recorded.',
    changeNumber: 79,
  },
  'auto-approve-at-the-shop': {
    title: 'Auto-approve at the shop',
    onMeans:
      'A check-in measured inside the outlet’s fence is approved at once, and each outlet’s managers choose whether every check-in still needs them and whether check-ins away from the shop are refused.',
    offMeans: 'Every check-in waits for a manager.',
    changeNumber: 81,
  },
  'refreshed-staff-screens': {
    title: 'Refreshed staff screens',
    onMeans:
      'The staff phone’s Home, My attendance and Expenses, the counter’s and managers’ expense lists, and the manager’s By staff use the new layouts.',
    offMeans: 'Every screen reads as it does today.',
    changeNumber: 81,
  },
  'expense-category-list': {
    title: 'Expense category list',
    onMeans:
      'An expense’s category is picked from the owners’ list, and Other asks what it was for.',
    offMeans: 'An expense’s category is typed, with suggestions.',
    changeNumber: 81,
  },
}

/**
 * Every gate the demo lists, in the owner's words. In the real app the words
 * live in each gate's database row (D4), so an older build on the owner's phone
 * can still read a newer gate; the demo has no database, so they live here.
 */
const DEMO_GATES: (Omit<ChangeGateSummary, 'enabled' | 'changedAt' | 'changedByName'> & {
  declared: boolean
})[] = CHANGE_GATE_KEYS.map((key) => {
  const declared = CHANGE_GATES[key] as ChangeGateDeclaration
  return {
    key,
    code: declared.code,
    kind: declared.kind,
    ...WORDS[key],
    changeName: declared.change,
    dependsOn: [...(declared.dependsOn ?? [])],
    declared: true,
  }
})

const MINUTE = 60_000
const HOUR = 60 * MINUTE

function sessionStorageOrNull(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    return null
  }
}

function outletName(outletId: string): string {
  return outletFixtures.find((outlet) => outlet.id === outletId)?.name ?? 'Outlet'
}

function readTurns(storage: Pick<Storage, 'getItem'> | null): ChangeGateEvent[] {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(DEMO_TURNS_KEY) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (turn): turn is ChangeGateEvent =>
        typeof turn === 'object' &&
        turn !== null &&
        typeof (turn as ChangeGateEvent).key === 'string' &&
        typeof (turn as ChangeGateEvent).enabled === 'boolean' &&
        typeof (turn as ChangeGateEvent).at === 'string',
    )
  } catch {
    return []
  }
}

export interface DemoChangeGates {
  /** The declared gates this demo runs with, every one present. */
  snapshot(): GateSnapshot
  summaries(): ChangeGateSummary[]
  history(key: string): ChangeGateEvent[]
  tablets(): DeviceHealthReading[]
  turn(key: string, enabled: boolean, reason: string | null): void
  subscribe(listener: () => void): () => void
}

/**
 * One demo's gates, history and tablets. Session-scoped like the rest of
 * `DemoData`: a gate turned as the owner stays turned when the walkthrough flips
 * to the counter, which is the comparison the page exists for.
 */
export function createDemoChangeGates(
  options: {
    storage?: Pick<Storage, 'getItem' | 'setItem'> | null
    now?: () => number
  } = {},
): DemoChangeGates {
  const storage = options.storage === undefined ? sessionStorageOrNull() : options.storage
  const now = options.now ?? (() => Date.now())
  const owner = personaFixtures.super_admin.profile.full_name
  const startedAt = now()
  const ago = (ms: number) => new Date(startedAt - ms).toISOString()

  /** Every gate's own answer, the examples' included. */
  let saved: SavedAnswers = readSavedAnswers(storage, DEMO_GATES_KEY)
  const own = (key: string) => saved[key] ?? true
  const listeners = new Set<() => void>()
  const turns = readTurns(storage)

  /**
   * A history consistent with every gate starting on: each was declared off and
   * turned on, and the probe was pulled once — off and on again — the way the
   * release workflow asks of every gate (design D11, step 7).
   */
  const events: ChangeGateEvent[] = [
    ...turns,
    {
      key: 'probe',
      enabled: true,
      at: ago(26 * HOUR),
      byName: owner,
      reason: 'Pulled once: back on',
      source: 'app',
    },
    {
      key: 'probe',
      enabled: false,
      at: ago(26 * HOUR + 3 * MINUTE),
      byName: owner,
      reason: 'Pulled once',
      source: 'app',
    },
    {
      key: 'probe',
      enabled: true,
      at: ago(27 * HOUR),
      byName: owner,
      reason: 'Quiet hour, first try',
      source: 'app',
    },
  ]

  /**
   * One tablet in each state the page can show (design D18): running, waiting
   * for a free moment, failing, and silent. The kitchen loaded before the probe
   * was last turned on and has not reloaded since, so it is the one waiting.
   */
  const everyGate = DEMO_GATES.map((gate) => gate.key)
  const tablets: DeviceHealthReading[] = [
    {
      deviceId: DEMO_COUNTER_DEVICE_ID,
      label: 'Counter tablet',
      kind: 'counter',
      outletId: OUTLET_KALYANI_ID,
      outletName: outletName(OUTLET_KALYANI_ID),
      build: '9e91664',
      bootedGates: everyGate,
      requests: 38,
      failed: 0,
      slowestMs: 420,
      reportedAt: ago(20_000),
    },
    {
      deviceId: DEMO_KITCHEN_DEVICE_ID,
      label: DEMO_KITCHEN_LABEL,
      kind: 'kitchen',
      outletId: OUTLET_KALYANI_ID,
      outletName: outletName(OUTLET_KALYANI_ID),
      build: '9e91664',
      bootedGates: everyGate.filter((key) => key !== 'probe'),
      requests: 6,
      failed: 0,
      slowestMs: 310,
      reportedAt: ago(35_000),
    },
    {
      deviceId: DEMO_COUNTER_DEVICE_TWO_ID,
      label: 'Takeaway counter',
      kind: 'counter',
      outletId: OUTLET_KALYANI_ID,
      outletName: outletName(OUTLET_KALYANI_ID),
      build: '9e91664',
      bootedGates: everyGate,
      requests: 41,
      failed: 9,
      slowestMs: 8_020,
      reportedAt: ago(28_000),
    },
    {
      deviceId: DEMO_KANCHRAPARA_DEVICE_ID,
      label: 'Counter tablet',
      kind: 'counter',
      outletId: OUTLET_KANCHRAPARA_ID,
      outletName: outletName(OUTLET_KANCHRAPARA_ID),
      build: '6a9184a',
      bootedGates: [],
      requests: 12,
      failed: 0,
      slowestMs: 290,
      reportedAt: ago(2 * 24 * HOUR),
    },
  ]

  const byKey = new Map(DEMO_GATES.map((gate) => [gate.key, gate]))
  const dependentsOf = (key: string) => DEMO_GATES.filter((gate) => gate.dependsOn.includes(key))

  function record(key: string, enabled: boolean, reason: string | null) {
    const turn: ChangeGateEvent = {
      key,
      enabled,
      at: new Date(now()).toISOString(),
      byName: owner,
      reason,
      source: 'app',
    }
    saved = { ...saved, [key]: enabled }
    events.unshift(turn)
    turns.unshift(turn)
  }

  /** Off, and every gate depending on it that is on — each turn recorded as its own. */
  function turnOffDependents(key: string, title: string) {
    for (const dependent of dependentsOf(key)) {
      if (own(dependent.key)) {
        record(dependent.key, false, `Turned off with ${title}`)
        turnOffDependents(dependent.key, title)
      }
    }
  }

  return {
    snapshot() {
      return snapshotFrom(saved, ALL_ON)
    },

    summaries() {
      return DEMO_GATES.map((gate) => {
        const last = events.find((event) => event.key === gate.key)
        const { declared: _declared, ...summary } = gate
        return {
          ...summary,
          enabled: own(gate.key),
          changedAt: last?.at ?? null,
          changedByName: last?.byName ?? null,
        }
      })
    },

    history(key) {
      return events.filter((event) => event.key === key)
    },

    tablets() {
      return tablets.map((tablet) => ({ ...tablet, bootedGates: [...tablet.bootedGates] }))
    },

    turn(key, enabled, reason) {
      const gate = byKey.get(key)
      if (!gate) throw new DataActionError('unknown_gate', 'That change gate does not exist.')
      const off = gate.dependsOn.filter((dependency) => !own(dependency))
      if (enabled && off.length > 0) {
        const titles = off.map((dependency) => byKey.get(dependency)?.title ?? dependency)
        throw new DataActionError(
          'dependency_off',
          `Turn on ${titles.join(' and ')} first: ${gate.title} is dependent on ${
            titles.length === 1 ? 'it' : 'them'
          }.`,
        )
      }
      record(key, enabled, reason)
      if (!enabled) turnOffDependents(key, gate.title)
      writeSavedAnswers(storage, saved, DEMO_GATES_KEY)
      try {
        storage?.setItem(DEMO_TURNS_KEY, JSON.stringify(turns))
      } catch {
        // The answer is saved; a history that cannot be is only shorter.
      }
      for (const listener of listeners) listener()
    },

    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

/** Forgets the demo's turns, as a demo reset does. */
export function forgetDemoGateTurns(
  storage: Pick<Storage, 'removeItem'> | null = sessionStorageOrNull(),
): void {
  try {
    storage?.removeItem(DEMO_GATES_KEY)
    storage?.removeItem(DEMO_TURNS_KEY)
  } catch {
    // Nothing to forget, or nowhere to forget it from.
  }
}

/**
 * The adapter over one demo's gates. Refuses every role but the owner, as the
 * database does: a demo that let a manager turn a change would teach a product
 * this one is not.
 */
export function createMockChangeGatesAdapter(
  gates: DemoChangeGates,
  role: AppRole,
): ChangeGatesAdapter {
  const ownerOnly = () => {
    if (role !== 'super_admin') {
      throw new DataActionError('not_permitted', 'Only the owner turns a change gate.')
    }
  }
  return {
    async read() {
      return { ...gates.snapshot() }
    },
    subscribe(onChange) {
      return gates.subscribe(onChange)
    },
    async overview() {
      ownerOnly()
      return { gates: gates.summaries(), tablets: gates.tablets() }
    },
    async history(key) {
      ownerOnly()
      return gates.history(key)
    },
    async turn(key, enabled, reason) {
      ownerOnly()
      gates.turn(key, enabled, reason)
    },
    async reportHealthReadingGates() {
      // The demo's tablets are fixtures; a demo page reports nothing anywhere,
      // and answers as a read does.
      return { ...gates.snapshot() }
    },
  }
}
