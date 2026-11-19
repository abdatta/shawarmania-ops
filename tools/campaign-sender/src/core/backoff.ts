/**
 * How long the sender waits before reconnecting after an ordinary drop.
 *
 * Doubling from two seconds to a five-minute ceiling, with up to a quarter of
 * jitter so a sender that wakes with the laptop does not knock on the second.
 * A laptop asleep for the night simply finds the ceiling when it wakes.
 */

const FIRST_MS = 2_000
const CEILING_MS = 5 * 60_000

/** `attempt` counts from 0. `random` is injected so the tests are exact. */
export function reconnectDelayMs(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(CEILING_MS, FIRST_MS * 2 ** Math.max(0, Math.min(attempt, 20)))
  return Math.round(base + base * 0.25 * random())
}
