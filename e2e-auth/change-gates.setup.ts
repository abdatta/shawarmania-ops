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
  const key = serviceRoleKey()
  const response = await fetch(`${SUPABASE_URL}/rest/v1/change_gates?select=key,enabled`, {
    headers: { apikey: key, authorization: `Bearer ${key}` },
  })
  if (!response.ok) throw new Error(`reading change_gates failed: ${response.status}`)
  const rows = (await response.json()) as { key: string; enabled: boolean }[]
  return new Map(rows.map((row) => [row.key, row.enabled]))
}

export async function turnEveryGate(state: GateState) {
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
 * `turnEveryGate(state)` would turn. Retired gates are left out the same way:
 * only declared keys are compared.
 */
export async function gatesNotAt(state: GateState): Promise<string[]> {
  const on = state === 'on'
  const database = await answers()
  return parentsFirst().filter((gate) => database.get(gate) !== on)
}

export default async function globalSetup() {
  await turnEveryGate(GATE_STATE)
  return async () => {
    if (GATE_STATE === 'on') await turnEveryGate('off')
  }
}
