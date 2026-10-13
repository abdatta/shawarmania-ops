import {
  CHANGE_GATES,
  CHANGE_GATE_KEYS,
  dependenciesOf,
  isChangeGateKey,
  type ChangeGateKey,
} from './gates'

/**
 * Which way each change gate is for this page (a-release-can-be-switched-off, D5).
 *
 * **One answer per page load.** The snapshot a page boots with is the one it
 * keeps until it reloads. A toggle point never asks the network; a turned gate
 * reaches a page by the update path's reload at a free moment (D6), so no screen
 * ever changes behaviour in the middle of somebody's work.
 *
 * **Unknown is off**, and so is a gate that depends on a gate that is off,
 * directly or through another (owner, 2026-10-13). Off is the behaviour as it
 * was before, the one answer that is always safe.
 */
export type GateSnapshot = Readonly<Record<ChangeGateKey, boolean>>

/** Answers this device has saved, keyed by gate. Booleans only. */
export type SavedAnswers = Partial<Record<string, boolean>>

export const SAVED_ANSWERS_KEY = 'shawarmania.change-gates'

function every(value: boolean): GateSnapshot {
  return Object.freeze(
    Object.fromEntries(CHANGE_GATE_KEYS.map((key) => [key, value])) as Record<
      ChangeGateKey,
      boolean
    >,
  )
}

export const ALL_OFF: GateSnapshot = every(false)
export const ALL_ON: GateSnapshot = every(true)

/**
 * A snapshot from saved answers laid over a starting point: every declared key
 * present, every value a boolean, anything undeclared ignored, and every gate
 * off that depends — directly or through another — on a gate that is off.
 */
export function snapshotFrom(saved: SavedAnswers, base: GateSnapshot = ALL_OFF): GateSnapshot {
  const own = { ...base }
  for (const [key, value] of Object.entries(saved)) {
    if (isChangeGateKey(key) && typeof value === 'boolean') own[key] = value
  }
  const effective = { ...own }
  for (const key of CHANGE_GATE_KEYS) {
    if (!allDependenciesOn(key, own)) effective[key] = false
  }
  return Object.freeze(effective)
}

/** Every gate this one depends on, at any depth, is on. Bounded, so a loop lint refuses could never hang a page. */
function allDependenciesOn(key: ChangeGateKey, own: Record<ChangeGateKey, boolean>): boolean {
  const seen = new Set<ChangeGateKey>()
  const pending = [...dependenciesOf(key)]
  while (pending.length > 0) {
    const next = pending.pop()!
    if (seen.has(next)) continue
    seen.add(next)
    if (!own[next]) return false
    pending.push(...dependenciesOf(next))
  }
  return true
}

/** The codes of every gate on, in declaration order. */
export function activeCodes(snapshot: GateSnapshot): string[] {
  return CHANGE_GATE_KEYS.filter((key) => snapshot[key]).map((key) => CHANGE_GATES[key].code)
}

/**
 * The build and the gates it runs, as one code to read out or paste:
 * `c1f19c32·DT-KR` (owner, 2026-10-13). Just the build when no gate is on.
 */
export function buildCode(sha: string, codes: readonly string[]): string {
  return codes.length === 0 ? sha : `${sha}·${codes.join('-')}`
}

/**
 * What a storage area holds under `storageKey`, or nothing.
 *
 * Never throws: storage can be absent (private windows, a test), full, or hold
 * something a previous build wrote in another shape, and none of those may stop
 * a counter from opening. A value that is not an object of booleans reads as
 * nothing at all rather than half of something.
 */
export function readSavedAnswers(
  storage: Pick<Storage, 'getItem'> | null | undefined,
  storageKey: string = SAVED_ANSWERS_KEY,
): SavedAnswers {
  try {
    const raw = storage?.getItem(storageKey)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    const answers: SavedAnswers = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'boolean') answers[key] = value
    }
    return answers
  } catch {
    return {}
  }
}

/** Saves answers. A failure leaves the device on what it had, which is safe. */
export function writeSavedAnswers(
  storage: Pick<Storage, 'setItem'> | null | undefined,
  answers: SavedAnswers,
  storageKey: string = SAVED_ANSWERS_KEY,
): void {
  try {
    storage?.setItem(storageKey, JSON.stringify(answers))
  } catch {
    // Full or unavailable storage: the page keeps the answers it booted with.
  }
}

function localStorageOrNull(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

let boot: GateSnapshot | null = null

/**
 * The snapshot this page loaded with: the answers this device last saved, read
 * once and frozen for the life of the page.
 */
export function bootSnapshot(): GateSnapshot {
  if (boot === null) boot = snapshotFrom(readSavedAnswers(localStorageOrNull()))
  return boot
}

/** Tests only: forget the frozen snapshot, as a reload would. */
export function resetBootSnapshotForTests(): void {
  boot = null
}
