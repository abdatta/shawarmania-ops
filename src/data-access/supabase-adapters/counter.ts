import {
  FunctionsFetchError,
  type RealtimeChannel,
  type SupabaseClient,
} from '@supabase/supabase-js'

import {
  CounterActionError,
  type CounterAdapter,
  type CounterDeviceOperationalSnapshot,
  type CounterDeviceSummary,
  type CounterShiftRequest,
  type IssuedShiftRequest,
  type LiveCounterShift,
} from '../adapters'
import { failureCode } from '../auth'
import type { Database } from '../database.types'

/**
 * Tablets, and the two-device handshake (#9).
 *
 * Reads come straight from the tables under RLS: the request list an operator
 * sees is literally the same query the tablet would make, and the database
 * returns different rows. Every write goes to the `counter-devices` Edge
 * Function, because each of them either mints a secret or acts with authority
 * that must be re-derived from a token rather than taken from a body.
 *
 * **`select *` is never used on `counter_shift_requests`**, and that is a
 * contract rather than a style: the `code_hash` column is withheld by grant, so
 * a whole-row read is refused with 42501 for every client role. Naming columns
 * is what keeps the code somewhere only the tablet's screen can show it.
 */

const REQUEST_COLUMNS =
  'id, device_id, outlet_id, created_at, expires_at, resolution, ' +
  'counter_devices(label), outlets(name)'

const SHIFT_COLUMNS =
  'id, person_id, device_id, outlet_id, opened_at, business_date, expires_at, ' +
  'counter_devices(label), outlets(name)'

const MESSAGES: Record<string, string> = {
  forbidden: 'You are not allowed to do that.',
  tablet_exists: 'This outlet already has a tablet. Remove that one first.',
  wrong_code: 'That is not the code on the tablet. Check it and try again.',
  exhausted: 'Too many wrong codes. Ask the tablet to try again with a new one.',
  not_eligible: 'You are not set up to bill at that outlet.',
  request_failed: 'Could not ask for a shift. Try again in a moment.',
  invalid_request: 'That request is no longer waiting.',
  not_found: 'That tablet is already gone.',
  unavailable: 'Could not reach Shawarmania. Try again in a moment.',
  // Reused verbatim from the attendance adapter rather than reworded. It is the
  // same condition with the same advice, and a second phrasing for it would be
  // the beginning of a third.
  unsendable: 'This app could not send that action. Nothing was recorded. Please report this.',
}

/** A joined row comes back as an object or, on some shapes, a one-element array. */
function joined<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

interface RequestRow {
  id: string
  device_id: string
  outlet_id: string
  created_at: string
  expires_at: string
  counter_devices: { label: string } | { label: string }[] | null
  outlets: { name: string } | { name: string }[] | null
}

interface ShiftRow {
  id: string
  person_id: string
  device_id: string
  outlet_id: string
  opened_at: string
  business_date: string
  expires_at: string
  counter_devices: { label: string } | { label: string }[] | null
  outlets: { name: string } | { name: string }[] | null
}

interface OperationsRow {
  read_at: string
  device_id: string
  outlet_id: string
  label: string
  set_up_at: string
  last_seen_at: string | null
  last_reported_unsent: number
  shift_id: string | null
  operator_name: string | null
  opened_at: string | null
  business_date: string | null
  bill_count: number | null
  cash_total_paise: number | null
  upi_total_paise: number | null
  open_order_count: number | null
  drawer_cash_paise: number | null
}

interface SharedChannel {
  channel: RealtimeChannel
  listeners: Set<() => void>
}

export function createSupabaseCounterAdapter(client: SupabaseClient<Database>): CounterAdapter {
  /** Live channels this adapter holds, one per topic. See `subscribe` below. */
  const channels = new Map<string, SharedChannel>()

  /**
   * Every write, and the one place a failure is given a name.
   *
   * Three classifications, told apart by the evidence actually held, following
   * the rule `unreachable-backend-sign-in-error` (#30) set for sign-in:
   *
   *  * **no response arrived** — `FunctionsFetchError`, the only positive
   *    evidence of a transport failure supabase-js gives us — is a connection
   *    problem, and says so;
   *  * **a response naming a reason we know** is that reason;
   *  * **anything else** could not be sent. A 404 because the function is not
   *    deployed, a 500, a body in a shape `failureCode` cannot read: none of
   *    them is the person's connection and none is a state retrying escapes.
   *
   * That third branch used to be `?? 'unavailable'`, which is how an owner
   * trying to register a tablet on 2026-08-11 was told to check their internet
   * connection about a request that had been answered in milliseconds. The
   * gateway's own 404 body is `{"code":..., "message":...}` with no `error`
   * key, so `failureCode` returns null for it, and null was being read as
   * evidence of something it says nothing about.
   */
  async function call<T>(body: Record<string, unknown>): Promise<T> {
    const { data, error } = await client.functions.invoke('counter-devices', { body })
    if (!error) return data as T

    const named = await failureCode(error)
    const code = named ?? (error instanceof FunctionsFetchError ? 'unavailable' : 'unsendable')
    throw new CounterActionError(
      code,
      MESSAGES[code] ?? 'That did not work. Try again in a moment.',
    )
  }

  /**
   * Changes filtered server-side by the row's own column and then filtered AGAIN
   * by RLS, which is what makes this safe to subscribe to at all: the filter is a
   * narrowing, not the boundary.
   *
   * **One channel per topic, and the listeners share it.** This is not an
   * optimisation, it is the only thing that works: `client.channel(topic)`
   * returns the channel that already holds that topic, and adding a listener to
   * one that has already subscribed throws. Three readers of the same person are
   * ordinary — the navigation renders its bottom bar and its rail, and the home
   * card makes a third — so without the sharing below the second of them takes
   * the whole shell down with an unhandled error.
   *
   * Every caller of this must still resolve on load and on focus. Realtime is a
   * nudge to re-read, never the way the data arrives — so an unavailable channel
   * degrades the feature to "open the app and it is there".
   */
  function subscribe(
    name: string,
    filters: [string, string | undefined][],
    onChange: () => void,
  ): () => void {
    let shared = channels.get(name)
    if (!shared) {
      const channel = client.channel(name)
      const listeners = new Set<() => void>()
      for (const [table, filter] of filters) {
        channel.on(
          'postgres_changes',
          { event: '*', schema: 'public', table, ...(filter ? { filter } : {}) },
          () => {
            for (const listener of [...listeners]) listener()
          },
        )
      }
      channel.subscribe()
      shared = { channel, listeners }
      channels.set(name, shared)
    }

    const here = shared
    here.listeners.add(onChange)
    return () => {
      here.listeners.delete(onChange)
      // The last reader takes the channel with it, so a signed-out session and a
      // tablet whose shift ended leave no socket behind.
      if (here.listeners.size === 0) {
        channels.delete(name)
        void client.removeChannel(here.channel)
      }
    }
  }

  return {
    async listDevices(): Promise<CounterDeviceSummary[]> {
      const { data, error } = await client
        .from('counter_devices')
        .select('id, outlet_id, label, set_up_at, last_seen_at, last_reported_unsent')
        .is('removed_at', null)
        .order('label')
      if (error) throw error
      return (data ?? []).map((row) => ({
        id: row.id,
        outletId: row.outlet_id,
        label: row.label,
        setUpAt: row.set_up_at,
        lastSeenAt: row.last_seen_at,
        lastReportedUnsent: row.last_reported_unsent,
      }))
    },

    async readDeviceOperations(
      outletIds: readonly string[],
    ): Promise<CounterDeviceOperationalSnapshot[]> {
      const { data, error } = await client.rpc('counter_operations_snapshot', {
        p_outlet_ids: [...outletIds],
      })
      if (error) throw error
      return ((data ?? []) as OperationsRow[]).map((row) => {
        const operations = row.shift_id
          ? {
              shiftId: row.shift_id,
              operatorName: row.operator_name ?? 'Unknown operator',
              openedAt: row.opened_at!,
              businessDate: row.business_date!,
              billCount: row.bill_count ?? 0,
              cashTotalPaise: row.cash_total_paise ?? 0,
              upiTotalPaise: row.upi_total_paise ?? 0,
              openOrderCount: row.open_order_count ?? 0,
              drawerCashPaise: row.drawer_cash_paise ?? 0,
            }
          : null
        return {
          id: row.device_id,
          outletId: row.outlet_id,
          label: row.label,
          setUpAt: row.set_up_at,
          lastSeenAt: row.last_seen_at,
          lastReportedUnsent: row.last_reported_unsent,
          readAt: row.read_at,
          operations,
        }
      })
    },

    async issueSetupCode(outletId: string, label: string) {
      return await call<{ code: string; validFor: string }>({
        action: 'issue-setup-code',
        outletId,
        label,
      })
    },

    async removeDevice(deviceId: string): Promise<void> {
      await call({ action: 'remove', deviceId })
    },

    async requestShift(username: string): Promise<IssuedShiftRequest> {
      return await call<IssuedShiftRequest>({ action: 'request-shift', username })
    },

    async cancelRequest(): Promise<void> {
      await call({ action: 'cancel-request' })
    },

    /**
     * How the tablet learns what happened without being touched.
     *
     * Null means still pending. A request the tablet can no longer read at all
     * also reads as null, which is correct: the tablet's own timeout is what
     * ends the wait, not a guess about why a row went missing.
     */
    async getRequestResolution(requestId: string): Promise<string | null> {
      const { data, error } = await client
        .from('counter_shift_requests')
        .select('resolution')
        .eq('id', requestId)
        .maybeSingle()
      if (error) throw error
      return data?.resolution ?? null
    },

    async listPendingRequests(): Promise<CounterShiftRequest[]> {
      const { data, error } = await client
        .from('counter_shift_requests')
        .select(REQUEST_COLUMNS)
        .is('resolution', null)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
      if (error) throw error
      return ((data ?? []) as unknown as RequestRow[]).map((row) => ({
        id: row.id,
        deviceId: row.device_id,
        deviceLabel: joined(row.counter_devices)?.label ?? null,
        outletId: row.outlet_id,
        outletName: joined(row.outlets)?.name ?? null,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
      }))
    },

    async listLiveShifts(): Promise<LiveCounterShift[]> {
      const { data, error } = await client
        .from('counter_shifts')
        .select(SHIFT_COLUMNS)
        .is('ended_at', null)
        .gt('expires_at', new Date().toISOString())
        .order('opened_at', { ascending: false })
      if (error) throw error
      return ((data ?? []) as unknown as ShiftRow[]).map((row) => ({
        id: row.id,
        personId: row.person_id,
        deviceId: row.device_id,
        deviceLabel: joined(row.counter_devices)?.label ?? null,
        outletId: row.outlet_id,
        outletName: joined(row.outlets)?.name ?? null,
        openedAt: row.opened_at,
        businessDate: row.business_date,
        expiresAt: row.expires_at,
      }))
    },

    async confirmShift(requestId: string, code: string): Promise<void> {
      await call({ action: 'confirm', requestId, code })
    },

    async rejectRequest(requestId: string): Promise<void> {
      await call({ action: 'reject', requestId })
    },

    async endShift(shiftId: string): Promise<void> {
      await call({ action: 'end-shift', shiftId })
    },

    /**
     * **`counter_shift_requests` is subscribed unfiltered, and that is not an
     * oversight.**
     *
     * Realtime applies the same column grants a read does — which is what keeps
     * `code_hash` off the wire, and is proved in
     * `supabase/tests/rest/counter-handshake.test.ts`. The same rule bites the
     * filter: `person_id` is granted to nobody since the enumeration fix, so a
     * server-side filter on it matches nothing and the channel goes silent
     * without erroring. That failure is invisible, because every surface here
     * also reads on mount and on focus, so the card still appears — just not
     * live. It cost a day to find once; it is written down so it cannot cost
     * another.
     *
     * Dropping the filter loses nothing. `counter_shift_requests_select` already
     * limits this reader to requests naming them, so the filter was a narrowing
     * of a set that has exactly one member. `counter_shifts` keeps its filter
     * because that table grants every column, and there a manager or the owner
     * genuinely does see other people's rows.
     */
    subscribeToOwnHandshake(personId: string, onChange: () => void): () => void {
      return subscribe(
        `counter-person-${personId}`,
        [
          ['counter_shift_requests', undefined],
          ['counter_shifts', `person_id=eq.${personId}`],
        ],
        onChange,
      )
    },

    subscribeToDeviceHandshake(deviceId: string, onChange: () => void): () => void {
      return subscribe(
        `counter-device-${deviceId}`,
        [
          ['counter_shift_requests', `device_id=eq.${deviceId}`],
          ['counter_shifts', `device_id=eq.${deviceId}`],
        ],
        onChange,
      )
    },

    subscribeToOutletBilling(outletId: string, onChange: () => void): () => void {
      return subscribe(
        `counter-billing-${outletId}`,
        [
          ['menu_categories', `outlet_id=eq.${outletId}`],
          ['menu_items', `outlet_id=eq.${outletId}`],
          ['orders', `outlet_id=eq.${outletId}`],
          ['bills', `outlet_id=eq.${outletId}`],
        ],
        onChange,
      )
    },

    /**
     * The heartbeat. Deliberately swallows its own failure: a tablet that cannot
     * report is a tablet that is having a bad time already, and the management
     * surface reads the absence correctly as stale telemetry.
     */
    async reportState(unsent: number): Promise<void> {
      await client.rpc('report_counter_device_state', { p_unsent: unsent })
    },
  }
}
