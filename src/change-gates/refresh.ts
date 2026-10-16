import type { ChangeGatesAdapter } from '@/data-access/adapters'
import { recordUpdateReady } from '@/pwa/update-store'

import { CHANGE_GATE_KEYS } from './gates'
import {
  bootSnapshot,
  snapshotFrom,
  writeSavedAnswers,
  type GateSnapshot,
  type SavedAnswers,
} from './snapshot'

/** The slowest a device learns a turn when nothing nudges it (D6). */
export const GATE_READ_INTERVAL_MS = 60_000

/**
 * Answers a device was handed rather than read: a tablet's health report
 * brings them back with `fewer-requests` on (the-app-asks-the-server-less, D8).
 */
const offered = new Set<(answers: SavedAnswers) => void>()

/** Hands every running refresh a fresh set of answers, as if it had read them. */
export function offerGateAnswers(answers: SavedAnswers): void {
  for (const listener of [...offered]) listener(answers)
}

interface Environment {
  /** The page's frozen snapshot, as it booted. */
  booted: GateSnapshot
  /**
   * Whether it reads every minute itself. True, as it always has, unless the
   * minute's answers arrive on the tablet's health report instead (D8).
   */
  minuteRead: boolean
  save: (answers: SavedAnswers) => void
  /** The update path: reload at the first free moment (`src/pwa/apply-update.ts`). */
  apply: () => void
  setInterval: (callback: () => void, ms: number) => unknown
  clearInterval: (handle: unknown) => void
  setTimeout: (callback: () => void, ms: number) => unknown
  clearTimeout: (handle: unknown) => void
  document: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'> | null
  window: Pick<Window, 'addEventListener' | 'removeEventListener'> | null
}

function localStorageOrNull(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/**
 * Keeps a device's gate answers current and hands a changed one to the update
 * path (a-release-can-be-switched-off, D6). Returns the disposer.
 *
 * It reads on a live change, on return to the foreground, on regaining the
 * connection, every sixty seconds while visible, and once just after it starts —
 * one read at a time, keeping one trailing read when another trigger arrives
 * meanwhile (#74's queue rule). A fresh answer is saved for the next load; if it
 * differs from what this page booted with, the update signal is raised once, and
 * the page reloads into it at its first free moment.
 *
 * **Every failure keeps what the device has.** A read that fails, a channel that
 * never connects, storage that refuses a write: none of them changes what any
 * page runs. The worst a broken refresh can do is leave a turn unnoticed.
 */
export function startChangeGateRefresh(
  adapter: Pick<ChangeGatesAdapter, 'read' | 'subscribe'>,
  overrides: Partial<Environment> = {},
): () => void {
  const env: Environment = {
    booted: overrides.booted ?? bootSnapshot(),
    minuteRead: overrides.minuteRead ?? true,
    save: overrides.save ?? ((answers) => writeSavedAnswers(localStorageOrNull(), answers)),
    apply: overrides.apply ?? recordUpdateReady,
    setInterval: overrides.setInterval ?? ((callback, ms) => window.setInterval(callback, ms)),
    clearInterval: overrides.clearInterval ?? ((handle) => window.clearInterval(handle as number)),
    setTimeout: overrides.setTimeout ?? ((callback, ms) => window.setTimeout(callback, ms)),
    clearTimeout: overrides.clearTimeout ?? ((handle) => window.clearTimeout(handle as number)),
    document: overrides.document === undefined ? document : overrides.document,
    window: overrides.window === undefined ? window : overrides.window,
  }

  let running = true
  let reading = false
  let again = false
  let raised = false

  const differs = (fresh: GateSnapshot) =>
    CHANGE_GATE_KEYS.some((key) => fresh[key] !== env.booted[key])

  const absorb = (answers: SavedAnswers) => {
    env.save(answers)
    if (!raised && differs(snapshotFrom(answers))) {
      raised = true
      env.apply()
    }
  }

  const read = () => {
    if (!running) return
    if (reading) {
      again = true
      return
    }
    reading = true
    void adapter
      .read()
      .then((answers) => {
        if (!running) return
        absorb(answers)
      })
      .catch(() => {
        // Keep what the device has; the next trigger tries again.
      })
      .finally(() => {
        reading = false
        if (again && running) {
          again = false
          read()
        }
      })
  }

  let unsubscribe = () => {}
  try {
    unsubscribe = adapter.subscribe(read)
  } catch {
    // A channel that cannot open leaves the minute read to do the work.
  }
  const onVisible = () => {
    if (env.document?.visibilityState === 'visible') read()
  }
  env.document?.addEventListener('visibilitychange', onVisible)
  env.window?.addEventListener('online', read)
  const interval = env.minuteRead
    ? env.setInterval(() => {
        if (!env.document || env.document.visibilityState === 'visible') read()
      }, GATE_READ_INTERVAL_MS)
    : null
  const first = env.setTimeout(read, 0)
  const onOffered = (answers: SavedAnswers) => {
    if (running) absorb(answers)
  }
  offered.add(onOffered)

  return () => {
    running = false
    unsubscribe()
    env.document?.removeEventListener('visibilitychange', onVisible)
    env.window?.removeEventListener('online', read)
    if (interval !== null) env.clearInterval(interval)
    env.clearTimeout(first)
    offered.delete(onOffered)
  }
}
