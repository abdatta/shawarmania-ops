import {
  AlertActionError,
  type AlertsAdapter,
  type InsightsAdapter,
} from '../adapters'

/**
 * The real alerts and insights adapters — **deliberately not connected yet**.
 *
 * `DataAdapters` is total, so the real tree has to supply both today.
 * `owner-console-live` (#13) replaces this file with real queries once there
 * are real bills, expenses and movements for them to read.
 *
 * The alerts surfaces are `demo`-gated and never mount against this. **The
 * owner console is not**: `owner-dashboard` is `live`, so `outletDay` here is
 * genuinely called by a signed-in owner today — and `null` is its honest
 * answer, not a stub refusing. The console lists the outlet and states that its
 * figures are not available yet, rather than rendering a zero that would read
 * as "you took nothing today" (design D3).
 *
 * Writing the aggregate queries now would ship code no gate in this change can
 * exercise, which is how a `*-live` change discovers its adapter was wrong.
 */

const NOT_LIVE = 'This is not connected to real data yet. It is being demonstrated first.'

export function createSupabaseInsightsAdapter(): InsightsAdapter {
  return {
    async outletDay() {
      // Not "no sales" — "no answer". The difference matters on a screen whose
      // whole job is telling an owner how their outlets are doing.
      return null
    },
    async periodSummary() {
      return null
    },
    async comparison() {
      return []
    },
  }
}

export function createSupabaseAlertsAdapter(): AlertsAdapter {
  const notLive = () => Promise.reject(new AlertActionError('not_live', NOT_LIVE))

  return {
    async listAlerts() {
      return []
    },
    async getAlert() {
      return null
    },
    raiseAlert: notLive,
    respond: notLive,
    setStatus: notLive,
  }
}
