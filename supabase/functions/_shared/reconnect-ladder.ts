/**
 * The reconnect ladder's decision, as a pure function.
 *
 * Given both channels' probe results, name the cheapest rung that repairs the
 * actual state — never a full sign-in when a cheaper rung exists, and never a
 * code request for a rung that cannot reach one. Kept pure so every rung's
 * decision is unit-testable without a Deno runtime or a live aggregator; the
 * edge functions are only wiring.
 */

export type Rung = 'still_signed_in' | 'capture_only' | 'full_login' | 'probe_failed'

export interface ProbeLike {
  alive: boolean | null
}

/**
 * Decide the rung from both channels' probes.
 *
 * - Both alive → nothing to repair: "still signed in", nothing dispatched. The
 *   owner's earlier decision: verify, say so, stop.
 * - Zomato warm, Hyperpure cold → capture-only: re-mint the child from the
 *   stored parent in the runner, no sign-in step, no code request opened.
 * - Zomato cold → the only rung that can ever cost a code: full login.
 * - An unknown ("could not tell" — probe_error / unexpected_status) is NOT
 *   treated as cold: refusing on a guess would spend a code on a network
 *   hiccup, so the whole reconnect answers `probe_failed` and the owner
 *   retries in a moment.
 */
export function decideRung(zomato: ProbeLike, hyperpure: ProbeLike): Rung {
  if (zomato.alive === null || hyperpure.alive === null) return 'probe_failed'
  if (!zomato.alive) return 'full_login'
  return hyperpure.alive ? 'still_signed_in' : 'capture_only'
}
