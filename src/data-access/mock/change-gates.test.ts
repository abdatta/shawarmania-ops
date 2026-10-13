import { describe, expect, it } from 'vitest'

import { DataActionError } from '../adapters'
import { CHANGE_GATE_KEYS } from '@/change-gates/gates'

import {
  createDemoChangeGates,
  createMockChangeGatesAdapter,
  DEMO_GATES_KEY,
  DEMO_TURNS_KEY,
  forgetDemoGateTurns,
} from './change-gates'

/**
 * The demo's change gates (a-release-can-be-switched-off, D15): every one on to
 * begin with, turned locally, a gate turned on only while the gates it depends
 * on are on and turned off with them, remembered across a demo reload in this tab,
 * and forgotten by a reset.
 */

function memoryStorage() {
  const items = new Map<string, string>()
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
    items,
  }
}

const own = (gates: ReturnType<typeof createDemoChangeGates>, key: string) =>
  gates.summaries().find((gate) => gate.key === key)?.enabled

describe('the demo’s change gates', () => {
  it('start with every gate on, the declared ones in the snapshot', () => {
    const gates = createDemoChangeGates({ storage: memoryStorage() })
    for (const key of CHANGE_GATE_KEYS) expect(gates.snapshot()[key]).toBe(true)
    expect(gates.summaries().every((gate) => gate.enabled)).toBe(true)
  })

  it('show one gate dependent on another', () => {
    const gates = createDemoChangeGates({ storage: memoryStorage() })
    expect(gates.summaries().find((gate) => gate.key === 'kitchen-ready')?.dependsOn).toEqual([
      'dish-ticks',
    ])
  })

  it('record a turn in the snapshot, the history and this tab’s storage', () => {
    const storage = memoryStorage()
    const gates = createDemoChangeGates({ storage })
    let heard = 0
    gates.subscribe(() => (heard += 1))

    gates.turn('probe', false, 'Comparing the two')

    expect(gates.snapshot().probe).toBe(false)
    expect(gates.history('probe')[0]).toMatchObject({
      enabled: false,
      reason: 'Comparing the two',
      source: 'app',
    })
    expect(heard).toBe(1)
    // A demo reload rebuilds every other piece of demo state; the turn survives
    // it, and so does its line in the history.
    const reloaded = createDemoChangeGates({ storage })
    expect(reloaded.snapshot().probe).toBe(false)
    expect(reloaded.history('probe')[0]).toMatchObject({ enabled: false })
  })

  it('turn off the gates depending on a gate when it turns off, each as its own turn', () => {
    const gates = createDemoChangeGates({ storage: memoryStorage() })
    gates.turn('dish-ticks', false, 'Counter freezing')
    expect(own(gates, 'dish-ticks')).toBe(false)
    expect(own(gates, 'kitchen-ready')).toBe(false)
    expect(gates.history('kitchen-ready')[0]).toMatchObject({
      enabled: false,
      reason: 'Turned off with Dish ticks',
    })
  })

  it('refuse to turn a gate on while a gate it depends on is off', () => {
    const gates = createDemoChangeGates({ storage: memoryStorage() })
    gates.turn('dish-ticks', false, null)
    expect(() => gates.turn('kitchen-ready', true, null)).toThrow(
      'Turn on Dish ticks first: Kitchen Ready is dependent on it.',
    )
    gates.turn('dish-ticks', true, null)
    // Turning the dependency back on does not bring the dependent with it: that
    // is a turn of its own.
    expect(own(gates, 'kitchen-ready')).toBe(false)
    gates.turn('kitchen-ready', true, null)
    expect(own(gates, 'kitchen-ready')).toBe(true)
  })

  it('forget every turn on reset, back to everything on', () => {
    const storage = memoryStorage()
    createDemoChangeGates({ storage }).turn('tablet-health', false, null)
    forgetDemoGateTurns(storage)
    expect(storage.items.has(DEMO_GATES_KEY)).toBe(false)
    expect(storage.items.has(DEMO_TURNS_KEY)).toBe(false)
    expect(createDemoChangeGates({ storage }).snapshot()['tablet-health']).toBe(true)
  })

  it('show one tablet in each state the gate page can draw', () => {
    const tablets = createDemoChangeGates({ storage: memoryStorage() }).tablets()
    expect(tablets.some((tablet) => tablet.failed > 0)).toBe(true)
    expect(tablets.some((tablet) => !tablet.bootedGates.includes('probe'))).toBe(true)
    expect(new Set(tablets.map((tablet) => tablet.outletId)).size).toBeGreaterThan(1)
  })
})

describe('the mock change-gate adapter', () => {
  it('lets the owner read and turn, and refuses every other role, as the database does', async () => {
    const gates = createDemoChangeGates({ storage: memoryStorage() })
    const owner = createMockChangeGatesAdapter(gates, 'super_admin')
    await owner.turn('probe', false, null)
    expect((await owner.overview()).gates.find((gate) => gate.key === 'probe')?.enabled).toBe(false)

    for (const role of ['franchise_admin', 'biller', 'employee'] as const) {
      const adapter = createMockChangeGatesAdapter(gates, role)
      await expect(adapter.turn('probe', true, null)).rejects.toBeInstanceOf(DataActionError)
      await expect(adapter.overview()).rejects.toBeInstanceOf(DataActionError)
      // Every device reads its answers whatever its role.
      expect(await adapter.read()).toMatchObject({ probe: false })
    }
  })

  it('refuses a gate that does not exist', async () => {
    const owner = createMockChangeGatesAdapter(
      createDemoChangeGates({ storage: memoryStorage() }),
      'super_admin',
    )
    await expect(owner.turn('no-such-gate', true, null)).rejects.toBeInstanceOf(DataActionError)
  })
})
