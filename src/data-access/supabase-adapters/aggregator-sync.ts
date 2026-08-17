import type { AggregatorSyncAdapter } from '../adapters'

/**
 * The real Zomato sync adapter, deliberately unbuilt.
 *
 * The surface is gated to `demo` (`owner-zomato-sync` in `src/gates/registry.ts`),
 * so nothing in the real tree can reach any of these. The gate is the guarantee;
 * this file is the proof that the guarantee is being relied on rather than
 * assumed, which is why every method throws instead of returning something
 * plausible and empty.
 *
 * An empty health reading would be the more comfortable stub and the wrong one:
 * "the sync has never run" and "the sync is not wired up" are the same screen,
 * and a surface promoted by accident would report a healthy silence about a job
 * that does not exist. Throwing makes the mistake loud at the first read.
 *
 * The change that promotes the gate replaces this file wholesale. It reads
 * `aggregator_sync_runs`, `manual_ledger_days` and `aggregator_cycle_deductions`
 * for the events, and calls the Edge Functions for the four actions.
 */

function unbuilt(): never {
  throw new Error(
    'The Zomato sync is not wired to real data yet. This surface is gated to demo mode.',
  )
}

export function createSupabaseAggregatorSyncAdapter(): AggregatorSyncAdapter {
  return {
    getHealth: unbuilt,
    listEvents: unbuilt,
    // Read by the shell's badge rather than by the page, so this is the one a
    // premature promotion would reach first, from every screen at once. It
    // throws for the same reason as the rest: a badge that reported nil would
    // say the work is done, which is the one wrong thing a badge can say.
    // `visibleSurfaces` drops a demo-gated surface in real mode, so the entry
    // does not render and the hook is never called until the gate moves.
    countNeedsOwner: unbuilt,
    requestRun: unbuilt,
    requestReconnect: unbuilt,
    answerOneTimePassword: unbuilt,
    recheckWeek: unbuilt,
    acceptDifference: unbuilt,
    markNotDuplicate: unbuilt,
  }
}
