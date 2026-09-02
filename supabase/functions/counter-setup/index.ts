import { serviceClient } from '../_shared/authority.ts'
import { json, preflight, readJson, str } from '../_shared/http.ts'
import { hashCode, normaliseCode } from '../_shared/invite-code.ts'
import { deviceEmail, generateDevicePassword } from '../_shared/counter-code.ts'

/**
 * Setting a tablet up: exchange a one-time setup code for a machine session.
 *
 * The second endpoint in the app that takes no session at all, and for the same
 * reason as the first: the thing being set up does not have one yet. It is
 * modelled on `redeem-invite` deliberately, because that flow is already built,
 * already proven and already understood by whoever runs this shop.
 *
 * What keeps it honest:
 *
 *  1. It decides nothing. `redeem_counter_device_setup_code` checks the code,
 *     enforces label uniqueness at the outlet, consumes the code and writes the
 *     row, all in one transaction — so there is no check-then-act window here.
 *  2. Every code failure looks identical. Unknown, wrong, expired, consumed,
 *     superseded, attempts exhausted: one status, one body.
 *  3. **A failed redemption leaves nothing that can authenticate.** The machine
 *     Auth user has to exist before the row can reference it, so it is created
 *     first and deleted again the moment the answer is anything but `ok`.
 *  4. No human credential is anywhere near this. The password it mints is
 *     random, is never shown, and belongs to a machine.
 *
 * `label_taken` is the single specific refusal, and it is allowed to be specific
 * because it describes the OUTLET rather than the code, to a caller who already
 * holds a live code for that outlet.
 *
 * The row this writes is **not yet a counter**. The browser signs in with the
 * credential below and then proves the session, and only that makes it one — so
 * a lost response here costs a code and no longer costs the outlet a till.
 *
 * Registered with verify_jwt = false in supabase/config.toml.
 */

const INVALID = { error: 'invalid_code' }
const LABEL_TAKEN = { error: 'label_taken' }

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const body = await readJson(req)
  const rawCode = body ? str(body['code']) : undefined
  if (!rawCode) return json(INVALID, 400)

  const service = serviceClient()
  const codeHash = await hashCode(normaliseCode(rawCode))

  // The identity comes first because the tablet row references it. Everything
  // after this point either finishes the setup or removes this user again.
  const password = generateDevicePassword()
  // The address is minted from its own random id rather than from the user id,
  // which does not exist yet. It is an address, not an identifier anything joins
  // on: `counter_devices.id` is the machine's identity everywhere else.
  const email = deviceEmail(crypto.randomUUID())
  const created = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { counter_device: true },
  })
  const userId = created.data.user?.id
  if (created.error || !userId) {
    console.error('could not create a machine identity for a tablet', created.error)
    return json({ error: 'setup_failed' }, 500)
  }

  const discard = async (): Promise<void> => {
    const { error } = await service.auth.admin.deleteUser(userId)
    // Loud rather than silent: an orphaned machine identity is an account that
    // can sign in and reach nothing, which is harmless but should not accumulate
    // unnoticed.
    if (error) console.error('could not discard an unused machine identity', error, userId)
  }

  const { data, error } = await service.rpc('redeem_counter_device_setup_code', {
    p_code_hash: codeHash,
    p_device_id: userId,
  })
  const row = (Array.isArray(data) ? data[0] : data) as
    { status?: string; device_id?: string | null; outlet_id?: string | null } | undefined

  if (error || !row || row.status !== 'ok' || !row.device_id) {
    await discard()
    if (row?.status === 'label_taken') return json(LABEL_TAKEN, 409)
    return json(INVALID, 400)
  }

  // The credential, once. The tablet signs in with it immediately and keeps only
  // the session — there is still exactly one way a session is minted.
  return json({
    email,
    password,
    deviceId: row.device_id,
    outletId: row.outlet_id,
  })
})
