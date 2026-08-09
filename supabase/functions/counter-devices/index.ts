import {
  callerFrom,
  isOwner,
  outletsFor,
  serviceClient,
  type Caller,
} from '../_shared/authority.ts'
import { json, noContent, preflight, readJson, str } from '../_shared/http.ts'
import { generateCode, hashCode, normaliseCode } from '../_shared/invite-code.ts'
import {
  generateShiftCode,
  normaliseShiftCode,
  SETUP_CODE_VALID_FOR,
  SHIFT_REQUEST_VALID_FOR,
} from '../_shared/counter-code.ts'
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'

/**
 * Every counter act that needs the service-role key, in one place.
 *
 * Two kinds of caller reach this function and they are kept apart deliberately:
 *
 *  * a **person**, resolved by `callerFrom` — an admin issuing or removing a
 *    setup code, or an operator confirming, rejecting or ending their own shift;
 *  * a **tablet**, resolved by `deviceCallerFrom` — asking for a shift, or
 *    withdrawing its own request.
 *
 * `callerFrom` refuses a tablet for free, because it looks for a profile and a
 * tablet has none. That is not a happy accident: it is the machine/person
 * separation showing up at the edge as well as in the session path.
 *
 * The house rule holds throughout (docs/ROLES_AND_PERMISSIONS.md): **being an
 * Edge Function is not authorisation.** Nothing here trusts the body about who
 * is calling. The database functions re-derive authority a second time, so this
 * layer exists to mint secrets and to turn refusals into names — never to be the
 * boundary on its own.
 *
 * The two secrets are minted here rather than in Postgres for one reason: only
 * the hash may ever reach the database, and the plaintext must be returned to
 * exactly one caller and stored nowhere.
 */

interface DeviceCaller {
  deviceId: string
  outletId: string
}

/** The tablet this token belongs to, or null because it belongs to a person. */
async function deviceCallerFrom(
  req: Request,
  service: SupabaseClient,
): Promise<DeviceCaller | null> {
  const header = req.headers.get('Authorization') ?? ''
  if (!header.toLowerCase().startsWith('bearer ')) return null
  const token = header.slice(7).trim()
  if (token === '') return null

  const { data, error } = await service.auth.getUser(token)
  if (error || !data.user) return null

  const { data: device } = await service
    .from('counter_devices')
    .select('id, outlet_id')
    .eq('id', data.user.id)
    .is('removed_at', null)
    .maybeSingle()
  if (!device) return null
  return { deviceId: device.id as string, outletId: device.outlet_id as string }
}

/** May this person set up or remove a tablet at this outlet? */
function mayAdminister(caller: Caller, outletId: string): boolean {
  return isOwner(caller) || outletsFor(caller, 'franchise_admin').includes(outletId)
}

const FORBIDDEN = { error: 'forbidden' }
const INVALID = { error: 'invalid_request' }

type Row = Record<string, unknown> | undefined

function firstRow(data: unknown): Row {
  return (Array.isArray(data) ? data[0] : data) as Row
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const body = await readJson(req)
  if (!body) return json(INVALID, 400)
  const action = str(body['action'])
  if (!action) return json(INVALID, 400)

  const service = serviceClient()

  // ── The tablet's own two acts ────────────────────────────────────────────
  if (action === 'request-shift' || action === 'cancel-request') {
    const device = await deviceCallerFrom(req, service)
    if (!device) return json(FORBIDDEN, 403)

    if (action === 'cancel-request') {
      await service.rpc('cancel_counter_shift_request', { p_device_id: device.deviceId })
      // 'none' and 'ok' are the same outcome from the tablet's side: there is no
      // pending request now. Saying which would be noise on a cancel button.
      return noContent()
    }

    const username = str(body['username'])
    if (!username) return json(INVALID, 400)

    // Generated here and returned to this tablet alone. The database stores the
    // hash, and no client role may read that column — including the person the
    // request names, who is expected to read the digits off the screen.
    const code = generateShiftCode()
    const { data, error } = await service.rpc('request_counter_shift', {
      p_device_id: device.deviceId,
      p_username: username,
      p_code_hash: await hashCode(code),
      p_valid_for: SHIFT_REQUEST_VALID_FOR,
    })
    const row = firstRow(data)
    if (error || row?.['status'] !== 'ok') return json({ error: 'request_failed' }, 400)

    // Enumeration safety is the database's: an unknown username produced a row
    // exactly like a real one, so this response cannot tell them apart either.
    return json({
      requestId: row['request_id'],
      code,
      expiresAt: row['expires_at'],
    })
  }

  // ── Everything else belongs to a person ─────────────────────────────────
  const caller = await callerFrom(req, service)
  if (!caller) return json(FORBIDDEN, 403)

  if (action === 'issue-setup-code') {
    const outletId = str(body['outletId'])
    const label = str(body['label'])
    if (!outletId || !label) return json(INVALID, 400)
    if (!mayAdminister(caller, outletId)) return json(FORBIDDEN, 403)

    const code = generateCode()
    const { data, error } = await service.rpc('issue_counter_device_setup_code', {
      p_outlet_id: outletId,
      p_issued_by: caller.id,
      p_label: label,
      p_code_hash: await hashCode(normaliseCode(code)),
      p_valid_for: SETUP_CODE_VALID_FOR,
    })
    const row = firstRow(data)
    if (error) return json({ error: 'unavailable' }, 503)
    if (row?.['status'] === 'tablet_exists') return json({ error: 'tablet_exists' }, 409)
    if (row?.['status'] !== 'ok') return json(FORBIDDEN, 403)

    // Once. There is no way to ask for it again, because only its hash was kept.
    return json({ code, validFor: SETUP_CODE_VALID_FOR })
  }

  if (action === 'remove') {
    const deviceId = str(body['deviceId'])
    if (!deviceId) return json(INVALID, 400)

    const { data, error } = await service.rpc('remove_counter_device', {
      p_device_id: deviceId,
      p_removed_by: caller.id,
    })
    if (error) return json({ error: 'unavailable' }, 503)
    if (data === 'not_authorised') return json(FORBIDDEN, 403)
    if (data !== 'ok') return json({ error: 'not_found' }, 404)
    return noContent()
  }

  if (action === 'confirm') {
    const requestId = str(body['requestId'])
    const rawCode = str(body['code'])
    if (!requestId || !rawCode) return json(INVALID, 400)

    const { data, error } = await service.rpc('confirm_counter_shift', {
      p_person_id: caller.id,
      p_request_id: requestId,
      p_code_hash: await hashCode(normaliseShiftCode(rawCode)),
    })
    const row = firstRow(data)
    if (error) return json({ error: 'unavailable' }, 503)
    const status = row?.['status']
    // Each of these is a different thing for the person to do next, so unlike
    // the code endpoints they are named. None of them says anything about an
    // account other than the caller's own.
    if (status === 'wrong_code') return json({ error: 'wrong_code' }, 400)
    if (status === 'exhausted') return json({ error: 'exhausted' }, 400)
    if (status === 'not_eligible') return json({ error: 'not_eligible' }, 403)
    if (status !== 'ok') return json({ error: 'invalid_request' }, 400)
    return json({ shiftId: row['shift_id'] })
  }

  if (action === 'reject') {
    const requestId = str(body['requestId'])
    if (!requestId) return json(INVALID, 400)
    const { data, error } = await service.rpc('reject_counter_shift_request', {
      p_person_id: caller.id,
      p_request_id: requestId,
    })
    if (error) return json({ error: 'unavailable' }, 503)
    if (data !== 'ok') return json({ error: 'invalid_request' }, 400)
    return noContent()
  }

  if (action === 'end-shift') {
    const shiftId = str(body['shiftId'])
    if (!shiftId) return json(INVALID, 400)
    const { data, error } = await service.rpc('end_counter_shift', {
      p_person_id: caller.id,
      p_shift_id: shiftId,
    })
    if (error) return json({ error: 'unavailable' }, 503)
    if (data !== 'ok') return json({ error: 'invalid_request' }, 400)
    return noContent()
  }

  return json(INVALID, 400)
})
