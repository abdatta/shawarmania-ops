import { RETIRED_CHANGE_GATES } from '../src/change-gates/gates'
import { GATE_STATE, parentsFirst, type GateState } from '../e2e/support/change-gates'

import { SUPABASE_URL, serviceRoleKey } from './tills'

/**
 * The local database's gates, turned to this run's state before the auth suite
 * and back off after it (design D10). Through `change_gate_force`, the service
 * role's turn, which records each turn in the history like any other.
 *
 * Off is set explicitly rather than assumed: a gates-on run that died before
 * its teardown would otherwise leave the next gates-off run running gates on.
 * Only gates whose answer differs are turned, so a run adds no history when
 * nothing changes. The local stack is shared with other sessions, which is why
 * teardown puts every gate back off.
 *
 * A retired gate is the exception, on in every run and left on: its row keeps
 * reading on in production until its contract migration (retire-gate), and the
 * database still asks it, as `order_label_leaves_the_rail` asks `dish-ticks`.
 * Off here, the local stack would run a database production no longer has.
 */

async function rpc(name: string, body: Record<string, unknown>) {
  const key = serviceRoleKey()
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`${name} failed: ${response.status} ${await response.text()}`)
}

/** The local database's answer for every gate it holds, retired ones too. */
async function answers(): Promise<Map<string, boolean>> {
  return new Map((await gateRows()).map((row) => [row.key, row.enabled]))
}

async function gateRows(): Promise<{ key: string; enabled: boolean; retired_at: string | null }[]> {
  const key = serviceRoleKey()
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/change_gates?select=key,enabled,retired_at`,
    { headers: { apikey: key, authorization: `Bearer ${key}` } },
  )
  if (!response.ok) throw new Error(`reading change_gates failed: ${response.status}`)
  return (await response.json()) as { key: string; enabled: boolean; retired_at: string | null }[]
}

/**
 * Retired keys whose row still reads, parents first (the registry lists them
 * children first). A row its contract migration retired is off for good and
 * left alone, as is a key the database never held.
 */
async function retiredStillReading(): Promise<string[]> {
  const live = new Set(
    (await gateRows()).filter((row) => row.retired_at === null).map((row) => row.key),
  )
  return [...RETIRED_CHANGE_GATES].reverse().filter((gate) => live.has(gate))
}

async function turnRetiredGatesOn() {
  for (const gate of await retiredStillReading()) {
    if ((await answers()).get(gate) === true) continue
    await rpc('change_gate_force', {
      p_key: gate,
      p_enabled: true,
      p_reason: 'auth browser tests, a retired gate reads on as in production',
    })
  }
}

export async function turnEveryGate(state: GateState) {
  await turnRetiredGatesOn()
  const on = state === 'on'
  // Parents first when turning on; children first when turning off, so no
  // cascade turns a gate this loop has yet to reach.
  const order = on ? parentsFirst() : parentsFirst().reverse()
  for (const gate of order) {
    if ((await answers()).get(gate) === on) continue
    await rpc('change_gate_force', {
      p_key: gate,
      p_enabled: on,
      p_reason: `auth browser tests, gates ${state}`,
    })
  }
}

/**
 * The declared gates the local database does not have at `state`, the ones
 * `turnEveryGate(state)` would turn, and any retired gate whose row is not on.
 */
export async function gatesNotAt(state: GateState): Promise<string[]> {
  const on = state === 'on'
  const database = await answers()
  const retired = (await retiredStillReading()).filter((gate) => database.get(gate) !== true)
  return [...parentsFirst().filter((gate) => database.get(gate) !== on), ...retired]
}

export default async function globalSetup() {
  await turnEveryGate(GATE_STATE)
  return async () => {
    if (GATE_STATE === 'on') await turnEveryGate('off')
  }
}
