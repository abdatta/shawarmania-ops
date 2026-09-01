import type { InsightsAdapter } from '../adapters'

/**
 * The real insights adapter — **deliberately not connected yet**.
 *
 * `DataAdapters` is total, so the real tree has to supply one today.
 *
 * It answered three questions until #51 and now answers one. The period
 * summary and the two-outlet comparison went with the screens that asked
 * them: the Ledger already says what a day took and what it cost from
 * recorded rows, and an estimate on top of that is a second number to
 * reconcile rather than an answer.
 *
 * **The owner console is `live`**, so `outletDay` here is genuinely called by
 * a signed-in owner today — and `null` is its honest answer, not a stub
 * refusing. The console lists the outlet and states that its figures are not
 * available yet, rather than rendering a zero that would read as "you took
 * nothing today" (design D3).
 */
export function createSupabaseInsightsAdapter(): InsightsAdapter {
  return {
    async outletDay() {
      // Not "no sales" — "no answer". The difference matters on a screen whose
      // whole job is telling an owner how their outlets are doing.
      return null
    },
  }
}
