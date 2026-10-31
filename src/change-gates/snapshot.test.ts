import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Which way each change gate is for a page (a-release-can-be-switched-off, D5):
 * one answer per page load, unknown is off, a gate runs only while every gate it
 * depends on runs, and the build code lists the codes of what is on.
 */

// Declarations with dependencies — a chain, and a gate with two — so the rule is
// tested against the real snapshot code rather than a copy of it.
vi.mock('./gates', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./gates')>()
  const gate = (code: string, dependsOn?: string[]) => ({
    kind: 'change',
    code,
    change: 'x',
    retireBy: '2099-01-01',
    roundTrip: 'tested',
    ...(dependsOn ? { dependsOn } : {}),
  })
  const CHANGE_GATES = {
    ...actual.CHANGE_GATES,
    parent: gate('P1'),
    other: gate('O1'),
    child: gate('C1', ['parent']),
    grandchild: gate('G1', ['child']),
    both: gate('B1', ['parent', 'other']),
  }
  const isChangeGateKey = (key: string) => Object.prototype.hasOwnProperty.call(CHANGE_GATES, key)
  return {
    ...actual,
    CHANGE_GATES,
    CHANGE_GATE_KEYS: Object.keys(CHANGE_GATES),
    isChangeGateKey,
    dependenciesOf: (key: keyof typeof CHANGE_GATES) =>
      ((CHANGE_GATES[key] as { dependsOn?: string[] }).dependsOn ?? []).filter(isChangeGateKey),
  }
})

const {
  ALL_OFF,
  ALL_ON,
  activeCodes,
  bootSnapshot,
  buildCode,
  readSavedAnswers,
  resetBootSnapshotForTests,
  SAVED_ANSWERS_KEY,
  snapshotFrom,
  writeSavedAnswers,
} = await import('./snapshot')

type Answers = Parameters<typeof snapshotFrom>[0]
const on = (answers: Record<string, boolean>) =>
  snapshotFrom(answers as Answers) as never as Record<string, boolean>

function memoryStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  }
}

afterEach(() => {
  window.localStorage.clear()
  resetBootSnapshotForTests()
})

describe('a gate snapshot', () => {
  it('reads every declared gate off when nothing has been saved', () => {
    expect(snapshotFrom({})).toEqual(ALL_OFF)
    expect(Object.values(ALL_OFF).every((value) => value === false)).toBe(true)
  })

  it('takes saved answers and ignores keys the build does not declare', () => {
    const snapshot = on({ probe: true, 'retired-long-ago': true })
    expect(snapshot.probe).toBe(true)
    expect(snapshot['pro-rata-pnl']).toBe(false)
    expect(snapshot).not.toHaveProperty('retired-long-ago')
  })

  it('runs a gate only while every gate it depends on, at any depth, is on', () => {
    expect(on({ parent: true, child: true, grandchild: true })).toMatchObject({
      parent: true,
      child: true,
      grandchild: true,
    })
    expect(on({ parent: false, child: true, grandchild: true })).toMatchObject({
      parent: false,
      child: false,
      grandchild: false,
    })
    expect(on({ parent: true, child: false, grandchild: true })).toMatchObject({
      parent: true,
      child: false,
      grandchild: false,
    })
  })

  it('runs a gate with two dependencies only while both are on', () => {
    expect(on({ parent: true, other: true, both: true }).both).toBe(true)
    expect(on({ parent: true, other: false, both: true }).both).toBe(false)
  })

  it('lays saved answers over a base, so the demo can start every gate on', () => {
    const snapshot = snapshotFrom({ 'pro-rata-pnl': false }, ALL_ON) as never as Record<
      string,
      boolean
    >
    expect(snapshot['pro-rata-pnl']).toBe(false)
    expect(snapshot.probe).toBe(true)
  })

  it('is frozen, so no toggle point can change its answer mid-page', () => {
    expect(Object.isFrozen(snapshotFrom({ probe: true }))).toBe(true)
  })

  it('lists the codes of every gate on, in declaration order', () => {
    expect(activeCodes(snapshotFrom({ probe: true, 'pro-rata-pnl': true }))).toEqual(['PB', 'PR'])
    expect(activeCodes(snapshotFrom({ parent: false, child: true } as Answers))).toEqual([])
    expect(activeCodes(ALL_OFF)).toEqual([])
  })

  it('writes the build and its gates as one code, with a middle dot', () => {
    expect(buildCode('c1f19c32', ['DT', 'KR'])).toBe('c1f19c32·DT-KR')
    expect(buildCode('c1f19c32', [])).toBe('c1f19c32')
  })
})

describe('saved answers', () => {
  it('reads nothing from missing, broken or foreign storage, and never throws', () => {
    expect(readSavedAnswers(null)).toEqual({})
    expect(readSavedAnswers(memoryStorage({ [SAVED_ANSWERS_KEY]: 'not json' }))).toEqual({})
    expect(readSavedAnswers(memoryStorage({ [SAVED_ANSWERS_KEY]: '[true]' }))).toEqual({})
    expect(readSavedAnswers(memoryStorage({ [SAVED_ANSWERS_KEY]: 'null' }))).toEqual({})
    const throwing = {
      getItem: () => {
        throw new Error('storage is disabled')
      },
    }
    expect(readSavedAnswers(throwing)).toEqual({})
  })

  it('keeps only booleans, so half of something reads as nothing for that key', () => {
    const storage = memoryStorage({
      [SAVED_ANSWERS_KEY]: JSON.stringify({ probe: true, 'pro-rata-pnl': 'yes' }),
    })
    expect(readSavedAnswers(storage)).toEqual({ probe: true })
  })

  it('round-trips through storage, and a failing write is swallowed', () => {
    const storage = memoryStorage()
    writeSavedAnswers(storage, { probe: true })
    expect(readSavedAnswers(storage)).toEqual({ probe: true })
    const full = {
      setItem: () => {
        throw new Error('quota exceeded')
      },
    }
    expect(() => writeSavedAnswers(full, { probe: true })).not.toThrow()
  })
})

describe('the boot snapshot', () => {
  it('reads this device’s saved answers once, and keeps them for the life of the page', () => {
    window.localStorage.setItem(SAVED_ANSWERS_KEY, JSON.stringify({ probe: true }))
    const first = bootSnapshot()
    expect(first.probe).toBe(true)

    // A fresher answer saved later reaches the page only through a reload.
    window.localStorage.setItem(SAVED_ANSWERS_KEY, JSON.stringify({ probe: false }))
    expect(bootSnapshot()).toBe(first)

    resetBootSnapshotForTests()
    expect(bootSnapshot().probe).toBe(false)
  })

  it('runs everything off on a device that has never been told anything', () => {
    expect(bootSnapshot()).toEqual(ALL_OFF)
  })
})
