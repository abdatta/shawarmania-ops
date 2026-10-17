/**
 * The counter's one sound: a handbell when the kitchen marks food Ready
 * (each-dish-is-ticked-off, design R6).
 *
 * **The sound is the owner's choice, by ear** (2026-10-12): *Handbell, option
 * 3* from the audition, "a quick alternating bell sound". Its numbers are the
 * audition's own code, recovered from the session that made it: struck sine
 * partials at 1, 2.76 and 5.4 × 1175 Hz, strikes 0.22 s apart with every other
 * one at 0.8 × the pitch, a 3 ms attack, each partial dying away over
 * 1.4 s / √ratio, through a 0.65 gain into a hard limiter.
 *
 * **Shorter on the owner's second listen** (2026-10-14). The audition rang its
 * six-strike figure twice and the counter heard it ring too long, so a figure
 * is four strikes — two high-low rings — faded out by 1.5 s, and a burst is
 * that figure played twice, 3 s in all. The sound only has to bring the
 * biller's eyes to the screen; the swinging bell and the orange row then show
 * which order it was, so the bell swings three times as long as the sound
 * (`SWING_S`). Synthesised, like the
 * kitchen's tunes, so there is no file to ship.
 *
 * Browsers hold sound until the page is touched. The counter is touched all
 * day, and every tap resumes the context; a Ready that arrives before the
 * first tap after a reload fills its dish without a sound.
 */

interface Variant {
  pitch: number
  strikes: readonly number[]
  decay: number
  modes: readonly (readonly [ratio: number, level: number])[]
}

/** Handbell, option 3, shortened: four alternating strikes. */
export const HANDBELL: Variant = {
  pitch: 1175,
  strikes: [0, 0.22, 0.44, 0.66],
  decay: 1.4,
  modes: [
    [1, 0.5],
    [2.76, 0.2],
    [5.4, 0.06],
  ],
}

/** One figure fades out by here; the second starts as it does. */
export const FIGURE_S = 1.5

/** A burst is the figure, twice. */
export const BURST_S = FIGURE_S * 2

/** How long an order's bell swings after its burst starts: three bursts' worth. */
export const SWING_S = BURST_S * 3

const MASTER = { gain: 0.65, limitDb: -10, ratio: 20, attackS: 0.001, releaseS: 0.12 }

/**
 * Schedule one burst — the four-strike figure, twice — on `ctx` at `at`, into
 * `destination`, and return its length in ms. Every node goes into `held`, so the caller can cut
 * it. Takes any context, so a test can render it offline and measure it.
 */
export function scheduleHandbell(
  ctx: BaseAudioContext,
  destination: AudioNode,
  at: number,
  held: AudioNode[],
): number {
  const master = ctx.createGain()
  master.gain.value = MASTER.gain
  const limiter = ctx.createDynamicsCompressor()
  limiter.threshold.value = MASTER.limitDb
  limiter.knee.value = 0
  limiter.ratio.value = MASTER.ratio
  limiter.attack.value = MASTER.attackS
  limiter.release.value = MASTER.releaseS
  master.connect(limiter).connect(destination)
  held.push(master, limiter)

  for (const figure of [at, at + FIGURE_S]) {
    for (const [index, strike] of HANDBELL.strikes.entries()) {
      for (const [ratio, level] of HANDBELL.modes) {
        const oscillator = ctx.createOscillator()
        const gain = ctx.createGain()
        // Every other strike sits lower: the alternation the owner heard.
        oscillator.frequency.value = HANDBELL.pitch * ratio * (index % 2 ? 0.8 : 1)
        const start = figure + strike
        const end = Math.min(figure + FIGURE_S - 0.02, start + HANDBELL.decay / Math.sqrt(ratio))
        if (end <= start + 0.004) continue
        gain.gain.setValueAtTime(0, start)
        gain.gain.linearRampToValueAtTime(level, start + 0.003)
        gain.gain.exponentialRampToValueAtTime(0.0001, end)
        oscillator.connect(gain).connect(master)
        oscillator.start(start)
        oscillator.stop(end)
        held.push(oscillator, gain)
      }
    }
  }
  return BURST_S * 1000
}

let context: AudioContext | null = null

function audio(): AudioContext | null {
  if (context) return context
  const Constructor =
    typeof window === 'undefined'
      ? undefined
      : (window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
  if (!Constructor) return null
  try {
    context = new Constructor()
  } catch {
    context = null
  }
  return context
}

/** Resume the counter's audio; call from a tap. */
export function unlockHandbell(): void {
  void audio()
    ?.resume()
    .catch(() => undefined)
}

export interface HandbellPlayer {
  /** Start one burst; returns how long it lasts, in ms. Silent while audio is held. */
  play(): number
  stop(): void
}

export function createHandbellPlayer(): HandbellPlayer {
  let held: AudioNode[] = []
  function stop(): void {
    for (const node of held) {
      if (node instanceof OscillatorNode) {
        try {
          node.stop()
        } catch {
          // Already finished.
        }
      }
      node.disconnect()
    }
    held = []
  }
  return {
    play() {
      const ctx = audio()
      if (!ctx || ctx.state !== 'running') return BURST_S * 1000
      stop()
      return scheduleHandbell(ctx, ctx.destination, ctx.currentTime, held)
    },
    stop,
  }
}

/** One dish as a read shows it: what the kitchen has marked Ready, and what the counter has ticked. */
export interface ReadyDishRead {
  ready: number
  prepared: number
}

/**
 * When the handbell rings, and which orders' bells swing.
 *
 * - **A first read rings nothing.** What the page finds already Ready when it
 *   loads — a gate turn reloads every tablet — fills its dishes silently.
 * - A Ready **arrives** only when the kitchen's Ready quantity for a dish rises
 *   above what this page last read, and is more than the counter has ticked.
 *   So food the counter ticked before the kitchen pressed Done rings nothing,
 *   and neither does an Undo, a tick, or an **untick**: the biller made that
 *   change and needs no telling. Arrivals in one read share one burst.
 * - A Ready arriving during a burst swings its bell at once and gets **one**
 *   more burst after the playing one, never more than one queued.
 * - An order's bell swings for `SWING_S` from the burst it rang in — longer
 *   than the sound, so the biller who looks up finds which order it was.
 * - **Handing it over settles it.** An order with no Ready food left untaken
 *   stops swinging at once; when no order the sound is for is still owed, the
 *   sound stops too, and a queued burst for it is dropped.
 *
 * Pure scheduling over an injected player and timer, so its rules are tested
 * without audio.
 */
export interface ReadyRinger {
  /** A read of every order on the rail: order id → line id → its Ready and ticked food. */
  absorb(read: Readonly<Record<string, Readonly<Record<string, ReadyDishRead>>>>): void
  /** Orders whose bell is swinging now. */
  swinging(): ReadonlySet<string>
  subscribe(listener: () => void): () => void
  dispose(): void
}

export function createReadyRinger(
  player: HandbellPlayer,
  options: {
    setTimer?: (run: () => void, ms: number) => unknown
    clearTimer?: (handle: unknown) => void
    swingMs?: number
  } = {},
): ReadyRinger {
  const setTimer = options.setTimer ?? ((run, ms) => setTimeout(run, ms))
  const clearTimer =
    options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>))
  const swingMs = options.swingMs ?? SWING_S * 1000
  let last: Record<string, Record<string, number>> | null = null
  /** Orders the sound playing now is for. */
  let sounding = new Set<string>()
  let queued = new Set<string>()
  let soundTimer: unknown = null
  const swings = new Map<string, unknown>()
  let disposed = false
  const listeners = new Set<() => void>()

  function notify(): void {
    for (const listener of [...listeners]) listener()
  }

  function swing(order: string): void {
    const running = swings.get(order)
    if (running !== undefined) clearTimer(running)
    swings.set(
      order,
      setTimer(() => {
        swings.delete(order)
        if (!disposed) notify()
      }, swingMs),
    )
  }

  function settle(order: string): boolean {
    const running = swings.get(order)
    if (running === undefined) return false
    clearTimer(running)
    swings.delete(order)
    return true
  }

  function ring(orders: Set<string>): void {
    sounding = orders
    for (const order of orders) swing(order)
    notify()
    const ms = player.play()
    soundTimer = setTimer(() => {
      soundTimer = null
      sounding = new Set()
      if (disposed || queued.size === 0) return
      const next = queued
      queued = new Set()
      ring(next)
    }, ms)
  }

  function hush(): void {
    if (soundTimer !== null) clearTimer(soundTimer)
    soundTimer = null
    sounding = new Set()
    player.stop()
  }

  return {
    absorb(read) {
      const previous = last
      last = Object.fromEntries(
        Object.entries(read).map(([order, lines]) => [
          order,
          Object.fromEntries(Object.entries(lines).map(([line, dish]) => [line, dish.ready])),
        ]),
      )
      // The first read is what was already there: nothing rings.
      if (previous === null || disposed) return

      const owed = new Set<string>()
      const arrived = new Set<string>()
      for (const [order, lines] of Object.entries(read)) {
        for (const [line, dish] of Object.entries(lines)) {
          if (dish.ready <= dish.prepared) continue
          owed.add(order)
          if (dish.ready > (previous[order]?.[line] ?? 0)) arrived.add(order)
        }
      }

      // Handed over (or gone from the rail): its bell stops, and its sound.
      let changed = false
      for (const order of [...swings.keys()])
        if (!owed.has(order)) changed = settle(order) || changed
      for (const order of [...queued]) if (!owed.has(order)) queued.delete(order)
      if (soundTimer !== null && ![...sounding].some((order) => owed.has(order))) {
        hush()
        if (queued.size > 0) {
          const next = queued
          queued = new Set()
          ring(next)
          changed = false
        }
      }

      if (arrived.size > 0) {
        if (soundTimer === null) {
          ring(arrived)
          return
        }
        // Its bell swings now; its sound waits for the one playing.
        for (const order of arrived) {
          swing(order)
          if (!sounding.has(order)) queued.add(order)
        }
        changed = true
      }
      if (changed) notify()
    },
    swinging: () => new Set(swings.keys()),
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    dispose() {
      disposed = true
      hush()
      for (const running of swings.values()) clearTimer(running)
      swings.clear()
      queued = new Set()
      listeners.clear()
    },
  }
}
