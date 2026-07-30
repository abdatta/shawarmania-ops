import { authAliasToUsername } from '../../../shared/username.ts'
import { callerFrom, isOwner, serviceClient } from '../_shared/authority.ts'
import { json, preflight, readJson, str } from '../_shared/http.ts'
import { clientIpHash } from '../_shared/invite-code.ts'

const ACCEPTED = {
  accepted: true,
  message: 'If that email is associated with an active Super Admin, a recovery link is on its way.',
}

function recoveryRedirect(): string {
  return Deno.env.get('OWNER_RECOVERY_REDIRECT_URL') ?? 'https://ops.shawarmania.in/recover'
}

async function requestRecovery(req: Request, body: Record<string, unknown>): Promise<Response> {
  const accountEmail = str(body['email'])?.toLowerCase()
  if (!accountEmail) return json(ACCEPTED, 202)

  const service = serviceClient()
  const { data: profileId } = await service.rpc('resolve_owner_recovery', {
    p_email: accountEmail,
    p_ip_hash: await clientIpHash(req),
  })

  if (typeof profileId === 'string') {
    const { data: user } = await service.auth.admin.getUserById(profileId)
    const authAlias = user.user?.email ?? null
    if (authAliasToUsername(authAlias)) {
      const { error } = await service.auth.resetPasswordForEmail(authAlias, {
        redirectTo: recoveryRedirect(),
      })
      // The public response remains identical. This log carries no raw address,
      // alias, token, or user id.
      if (error) console.error('owner recovery provider request failed')
    }
  }

  return json(ACCEPTED, 202)
}

async function recoveryStatus(req: Request): Promise<Response> {
  const service = serviceClient()
  const caller = await callerFrom(req, service)
  if (!caller || !isOwner(caller)) return json({ error: 'recovery_not_allowed' }, 403)

  const { data: user, error } = await service.auth.admin.getUserById(caller.id)
  const username = error ? null : authAliasToUsername(user.user?.email)
  if (!username) return json({ error: 'recovery_not_allowed' }, 403)
  return json({ username }, 200)
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const body = await readJson(req)
  if (!body) return json(ACCEPTED, 202)

  if (body['action'] === 'status') return await recoveryStatus(req)
  return await requestRecovery(req, body)
})
