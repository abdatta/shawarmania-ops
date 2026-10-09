import type { KitchenAlertKind } from '@/data-access/adapters'

/**
 * The kitchen's one speaker (#70, design D9).
 *
 *  - Every alert is owed three rings of its kind's tune.
 *  - **One sound at a time.** The next ring is of the most urgent kind still
 *    owed one — cancel, then new, then edit — and one ring counts for every
 *    alert of that kind owed one, so three orders landing together ring three
 *    times in total, not nine.
 *  - Settling an alert (ACK, or the order leaving the board) removes it; when
 *    nothing is owed a ring any more, the sound in progress is cut at once.
 *  - Raising an alert that is already owed rings resets it to three, which is
 *    what a card whose contents changed while alerting gets.
 *  - Each alert's rings are readable, and announced as they change, so its
 *    card can count them down and shake its ACK while it is still ringing.
 *
 * The queue is pure scheduling over an injected player and clock, so its rules
 * are tested without audio.
 */

export interface TunePlayer {
  /** Start one ring of this tune; returns how long it lasts, in ms. */
  play(kind: KitchenAlertKind): number
  /** Cut whatever is sounding. */
  stop(): void
}

/** Where one alert stands: rings still owed, and whether one is sounding now. */
export interface RingState {
  left: number
  sounding: boolean
}

export const SILENT: RingState = { left: 0, sounding: false }

export interface Ringer {
  raise(key: string, kind: KitchenAlertKind): void
  /**
   * Raise several at once, as one board read finds them: three orders landing
   * together share their rings from the first one rather than the first of
   * them starting alone.
   */
  raiseAll(alerts: ReadonlyArray<{ key: string; kind: KitchenAlertKind }>): void
  settle(key: string): void
  /** Settle everything not in this set of keys: what left the board stops ringing. */
  keepOnly(keys: ReadonlySet<string>): void
  /** Every alert still owed a ring or sounding one; the rest are silent. */
  snapshot(): Record<string, RingState>
  /** Called after every change to what `snapshot` would return. */
  subscribe(listener: () => void): () => void
  dispose(): void
}

export const RINGS_PER_ALERT = 3
const PRIORITY: readonly KitchenAlertKind[] = ['cancel', 'new', 'edit']

export function createRinger(
  player: TunePlayer,
  options: {
    gapMs?: number
    rings?: number
    setTimer?: (run: () => void, ms: number) => unknown
    clearTimer?: (handle: unknown) => void
  } = {},
): Ringer {
  const gapMs = options.gapMs ?? 700
  const rings = options.rings ?? RINGS_PER_ALERT
  const setTimer = options.setTimer ?? ((run, ms) => setTimeout(run, ms))
  const clearTimer =
    options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>))

  const owed = new Map<string, { kind: KitchenAlertKind; rings: number }>()
  const sounding = new Set<string>()
  const listeners = new Set<() => void>()
  let playing = false
  let timer: unknown = null
  let disposed = false

  function notify(): void {
    for (const listener of listeners) listener()
  }

  function anythingOwed(): boolean {
    for (const alert of owed.values()) if (alert.rings > 0) return true
    return false
  }

  function next(): void {
    if (disposed || playing) return
    const kind = PRIORITY.find((candidate) =>
      [...owed.values()].some((alert) => alert.kind === candidate && alert.rings > 0),
    )
    if (!kind) return
    for (const [key, alert] of owed) {
      if (alert.kind === kind && alert.rings > 0) {
        alert.rings -= 1
        sounding.add(key)
      }
    }
    playing = true
    const length = player.play(kind)
    notify()
    timer = setTimer(() => {
      playing = false
      timer = null
      sounding.clear()
      notify()
      next()
    }, length + gapMs)
  }

  function silenceIfIdle(): void {
    if (anythingOwed() || !playing) return
    player.stop()
    if (timer !== null) clearTimer(timer)
    timer = null
    playing = false
    sounding.clear()
  }

  return {
    raise(key, kind) {
      owed.set(key, { kind, rings })
      notify()
      next()
    },
    raiseAll(alerts) {
      for (const alert of alerts) owed.set(alert.key, { kind: alert.kind, rings })
      notify()
      next()
    },
    settle(key) {
      owed.delete(key)
      sounding.delete(key)
      silenceIfIdle()
      notify()
    },
    keepOnly(keys) {
      for (const key of [...owed.keys()]) {
        if (!keys.has(key)) {
          owed.delete(key)
          sounding.delete(key)
        }
      }
      silenceIfIdle()
      notify()
    },
    snapshot() {
      const states: Record<string, RingState> = {}
      for (const [key, alert] of owed) {
        if (alert.rings > 0 || sounding.has(key)) {
          states[key] = { left: alert.rings, sounding: sounding.has(key) }
        }
      }
      return states
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    dispose() {
      disposed = true
      listeners.clear()
      sounding.clear()
      owed.clear()
      player.stop()
      if (timer !== null) clearTimer(timer)
    },
  }
}
