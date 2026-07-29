import { alertAttentionRank, canTransition, type AlertStatus } from '@/domain'

import {
  AlertActionError,
  type AlertDetail,
  type AlertResponseRecord,
  type AlertsAdapter,
  type AlertSummary,
  type AppRole,
  type NewAlert,
} from '../adapters'
import type { Tables } from '../database.types'
import { accountFixtures } from './fixtures/accounts'
import { outletFixtures } from './fixtures/outlets'
import type { DemoStore } from './store'

/**
 * The mock alerts adapter.
 *
 * Two of the real policies are mirrored here, each beside the sentence it comes
 * from, because #13 will have to enforce them in Postgres and a demo that
 * behaved differently would have to be un-taught:
 *
 *  - **the Super Admin reads across outlets and nobody else does** — a manager
 *    naming another outlet gets an empty list rather than an error, because a
 *    policy that excludes rows is what RLS does;
 *  - **an alert moves one step at a time**, through the transitions
 *    `src/domain/alerts.ts` permits, and `closed` is terminal.
 *
 * A blank subject or message is refused by name, the way every other form in
 * this app refuses one (`blank-is-not-a-value`).
 */

function nameOf(profileId: string): string {
  return accountFixtures.find((account) => account.id === profileId)?.full_name ?? 'Unknown'
}

function outletNameOf(outletId: string): string {
  return outletFixtures.find((outlet) => outlet.id === outletId)?.name ?? 'Unknown outlet'
}

function requireText(value: string, field: string, label: string): string {
  const trimmed = value.trim()
  if (trimmed === '') {
    throw new AlertActionError(`blank_${field}`, `Type ${label}. It cannot be left blank.`)
  }
  return trimmed
}

export function createMockAlertsAdapter(
  store: DemoStore,
  role: AppRole,
  session: { userId: string; outletId: string | null },
): AlertsAdapter {
  /** Every outlet for the owner; one for anybody else. Null means "none". */
  function readableOutlets(): string[] | null {
    if (role === 'super_admin') return [...store.tradingOutletIds]
    return session.outletId ? [session.outletId] : null
  }

  function visible(alert: Tables<'alerts'>): boolean {
    const readable = readableOutlets()
    return readable !== null && readable.includes(alert.outlet_id)
  }

  function toSummary(alert: Tables<'alerts'>): AlertSummary {
    return {
      id: alert.id,
      outletId: alert.outlet_id,
      outletName: outletNameOf(alert.outlet_id),
      category: alert.category,
      priority: alert.priority,
      status: alert.status,
      subject: alert.subject,
      message: alert.message,
      raisedBy: alert.raised_by,
      raisedByName: nameOf(alert.raised_by),
      createdAt: alert.created_at,
      responseCount: store.alertResponses.filter((response) => response.alert_id === alert.id)
        .length,
    }
  }

  function responsesFor(alertId: string): AlertResponseRecord[] {
    return store.alertResponses
      .filter((response) => response.alert_id === alertId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((response) => ({
        id: response.id,
        message: response.message,
        responderName: nameOf(response.responder_profile_id),
        createdAt: response.created_at,
      }))
  }

  function toDetail(alert: Tables<'alerts'>): AlertDetail {
    return { ...toSummary(alert), responses: responsesFor(alert.id) }
  }

  /** The row, if the caller may see it. Anything else is "no such alert". */
  function findVisible(id: string): Tables<'alerts'> | null {
    const alert = store.alerts.find((candidate) => candidate.id === id)
    return alert && visible(alert) ? alert : null
  }

  return {
    async listAlerts(options) {
      const readable = readableOutlets()
      if (readable === null) return []

      const scope = options?.outletId
        ? // Naming an outlet narrows; it never widens. A manager asking for
          // somebody else's outlet intersects to nothing and gets nothing.
          readable.filter((outletId) => outletId === options.outletId)
        : readable

      return store.alerts
        .filter((alert) => scope.includes(alert.outlet_id))
        .sort(
          (a, b) =>
            alertAttentionRank({ status: a.status, priority: a.priority }) -
              alertAttentionRank({ status: b.status, priority: b.priority }) ||
            b.created_at.localeCompare(a.created_at),
        )
        .map(toSummary)
    },

    async getAlert(id) {
      const alert = findVisible(id)
      return alert ? toDetail(alert) : null
    },

    async raiseAlert(alert: NewAlert) {
      const readable = readableOutlets()
      if (readable === null || !readable.includes(alert.outletId)) {
        throw new AlertActionError(
          'wrong_outlet',
          'An alert can only be raised for your own outlet.',
        )
      }

      const row: Tables<'alerts'> = {
        id: `de000000-0000-4000-b000-${String(store.alerts.length + 1).padStart(12, '0')}`,
        outlet_id: alert.outletId,
        raised_by: session.userId,
        category: alert.category,
        priority: alert.priority,
        // Always open. Raising something already acknowledged would be
        // acknowledging it on somebody else's behalf.
        status: 'open',
        subject: requireText(alert.subject, 'subject', 'a subject'),
        message: requireText(alert.message, 'message', 'a message'),
        created_at: new Date().toISOString(),
      }
      store.alerts.push(row)
      return toSummary(row)
    },

    async respond(alertId, message) {
      const alert = findVisible(alertId)
      if (!alert) throw new AlertActionError('not_found', 'That alert is not available.')

      store.alertResponses.push({
        id: `df000000-0000-4000-b000-${String(store.alertResponses.length + 1).padStart(12, '0')}`,
        alert_id: alertId,
        responder_profile_id: session.userId,
        message: requireText(message, 'message', 'a reply'),
        created_at: new Date().toISOString(),
      })

      // Deliberately no status change: reading something is not the same as
      // acting on it, and folding the two together would remove the reader's
      // ability to say which they did (design D8).
      return toDetail(alert)
    },

    async setStatus(alertId, status) {
      const alert = findVisible(alertId)
      if (!alert) throw new AlertActionError('not_found', 'That alert is not available.')

      if (!canTransition(alert.status as AlertStatus, status as AlertStatus)) {
        throw new AlertActionError(
          'illegal_transition',
          alert.status === 'closed'
            ? 'This alert is closed. A closed alert is finished with — raise a new one instead.'
            : `An alert cannot go straight from ${alert.status} to ${status}.`,
        )
      }

      alert.status = status
      return toSummary(alert)
    },
  }
}
