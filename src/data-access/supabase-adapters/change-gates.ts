import type { SupabaseClient } from '@supabase/supabase-js'

import {
  DataActionError,
  type ChangeGateEvent,
  type ChangeGateSummary,
  type ChangeGatesAdapter,
  type DeviceHealthReading,
} from '../adapters'
import type { Database } from '../database.types'

type Client = SupabaseClient<Database>

/**
 * `report_device_health_v2`'s answer, `{ key: enabled }`, kept only where both
 * sides are what a read would give: a string key and a boolean.
 */
export function gateAnswers(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new DataActionError('report_failed', 'Could not report tablet health.')
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, boolean] => typeof entry[1] === 'boolean',
    ),
  )
}

/**
 * The live change-gate adapter (a-release-can-be-switched-off, tasks 3.1).
 *
 * Every device reads the live gates' own answers; the page it runs on works out
 * which of them are in force from the code's own declarations (D5). The owner's
 * page reads the gates, their dependencies, every tablet's health and each gate's
 * history; turning a gate is one RPC, `set_change_gate`, which re-derives the
 * caller's authority from their own token and does the cascade itself (D3, D21).
 *
 * The database's refusals are sentences written for the owner, so they are shown
 * as they come rather than translated into new words here.
 */
export function createSupabaseChangeGatesAdapter(client: Client): ChangeGatesAdapter {
  let channel: ReturnType<Client['channel']> | null = null
  const listeners = new Set<() => void>()

  return {
    async read() {
      const { data, error } = await client
        .from('change_gates')
        .select('key, enabled')
        .is('retired_at', null)
      if (error) throw new DataActionError('read_failed', 'Could not read the change gates.')
      return Object.fromEntries(data.map((gate) => [gate.key, gate.enabled]))
    },

    /**
     * A nudge to re-read, never the data: Realtime may be down, and the store
     * reads once a minute whatever happens here (D6). One channel however many
     * listeners, and the last one to leave takes it with it.
     *
     * It also nudges each time the channel joins. A turn made between a page's
     * first read and its channel joining reaches no listener, and was left to
     * the minute read: measured on the local stack, 62 s against 4 s for a turn
     * once joined. Supabase reports a rejoin after a dropped connection the same
     * way, so a turn made while a tablet was briefly off the channel is read too.
     */
    subscribe(onChange) {
      if (!channel) {
        const nudge = () => {
          for (const listener of [...listeners]) listener()
        }
        channel = client
          .channel('change-gates')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'change_gates' }, nudge)
        channel.subscribe((status) => {
          if (status === 'SUBSCRIBED') nudge()
        })
      }
      listeners.add(onChange)
      return () => {
        listeners.delete(onChange)
        if (listeners.size === 0 && channel) {
          void client.removeChannel(channel)
          channel = null
        }
      }
    },

    async overview() {
      const [gates, dependencies, health] = await Promise.all([
        client
          .from('change_gates')
          .select(
            'key, code, kind, title, on_means, off_means, change_name, change_number, enabled, changed_at, changer:profiles!change_gates_changed_by_fkey(full_name)',
          )
          .is('retired_at', null)
          .order('created_at'),
        client.from('change_gate_dependencies').select('gate_key, depends_on'),
        client
          .from('device_health')
          .select(
            'device_id, outlet_id, build, booted_gates, requests, failed, slowest_ms, reported_at, device:counter_devices(label, kind), outlet:outlets(name)',
          ),
      ])
      if (gates.error) {
        throw gates.error.code === '42501'
          ? new DataActionError('not_permitted', 'Only the owner turns a change gate.')
          : new DataActionError('read_failed', 'Could not load change gates.')
      }
      if (dependencies.error || health.error) {
        throw new DataActionError('read_failed', 'Could not load change gates.')
      }

      const summaries: ChangeGateSummary[] = gates.data.map((gate) => ({
        key: gate.key,
        code: gate.code,
        kind: gate.kind === 'ops' ? 'ops' : 'change',
        title: gate.title,
        onMeans: gate.on_means,
        offMeans: gate.off_means,
        changeName: gate.change_name,
        changeNumber: gate.change_number,
        dependsOn: dependencies.data
          .filter((edge) => edge.gate_key === gate.key)
          .map((edge) => edge.depends_on),
        enabled: gate.enabled,
        changedAt: gate.changed_at,
        changedByName: gate.changer?.full_name ?? null,
      }))

      const tablets: DeviceHealthReading[] = health.data.map((row) => ({
        deviceId: row.device_id,
        label: row.device?.label ?? 'Tablet',
        kind: row.device?.kind === 'kitchen' ? 'kitchen' : 'counter',
        outletId: row.outlet_id,
        outletName: row.outlet?.name ?? 'Outlet',
        build: row.build,
        bootedGates: row.booted_gates,
        requests: row.requests,
        failed: row.failed,
        slowestMs: row.slowest_ms,
        reportedAt: row.reported_at,
      }))

      return { gates: summaries, tablets }
    },

    async history(key) {
      const { data, error } = await client
        .from('change_gate_events')
        .select(
          'gate_key, enabled, at, reason, source, changer:profiles!change_gate_events_changed_by_fkey(full_name)',
        )
        .eq('gate_key', key)
        .order('at', { ascending: false })
      if (error) throw new DataActionError('read_failed', 'Could not load this change gate.')
      return data.map((event): ChangeGateEvent => ({
        key: event.gate_key,
        enabled: event.enabled,
        at: event.at,
        byName: event.changer?.full_name ?? null,
        reason: event.reason,
        source: event.source === 'operator' ? 'operator' : 'app',
      }))
    },

    async turn(key, enabled, reason) {
      const { error } = await client.rpc('set_change_gate', {
        p_key: key,
        p_enabled: enabled,
        // The database stores a blank reason as none.
        p_reason: reason ?? '',
      })
      if (!error) return
      const known = ['42501', '22023', 'P0002', '22001']
      throw new DataActionError(
        error.code === '42501' ? 'not_permitted' : 'refused',
        known.includes(error.code) ? error.message : 'That change gate could not be turned.',
      )
    },

    async reportHealthReadingGates(report) {
      const { data, error } = await client.rpc('report_device_health_v2', {
        p_build: report.build,
        p_booted_gates: report.bootedGates,
        p_window_seconds: report.windowSeconds,
        p_requests: report.requests,
        p_failed: report.failed,
        p_slowest_ms: report.slowestMs,
      })
      if (error) throw new DataActionError('report_failed', 'Could not report tablet health.')
      return gateAnswers(data)
    },
  }
}
