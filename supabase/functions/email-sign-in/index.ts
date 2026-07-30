import { createClient } from 'jsr:@supabase/supabase-js@2'

import { recoveryRuntimeReady } from '../../../shared/auth-readiness.ts'
import { serviceClient } from '../_shared/authority.ts'
import { json, preflight, readJson } from '../_shared/http.ts'
import { clientIpHash } from '../_shared/invite-code.ts'

const INVALID = { error: 'invalid_credentials' }
const DUMMY_ALIAS = 'unresolved-account@login.shawarmania.invalid'

function isLocalRuntime(): boolean {
  const url = Deno.env.get('SUPABASE_URL') ?? ''
  return url.includes('127.0.0.1') || url.includes('kong')
}

function recoveryMailConfigured(): boolean {
  return recoveryRuntimeReady(
    {
      sendEmailHookSecret: Deno.env.get('SEND_EMAIL_HOOK_SECRET'),
      resendApiKey: Deno.env.get('RESEND_API_KEY'),
      recoveryEmailFrom: Deno.env.get('RECOVERY_EMAIL_FROM'),
      ownerRecoveryRedirectUrl: Deno.env.get('OWNER_RECOVERY_REDIRECT_URL'),
    },
    { local: isLocalRuntime() },
  )
}

async function deploymentReadiness(): Promise<Response> {
  const service = serviceClient()
  const { data, error } = await service.rpc('username_rollout_ready')
  const ready = !error && data === true && recoveryMailConfigured()
  return json({ ready }, ready ? 200 : 503)
}

function publicAuthClient() {
  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!url || !anonKey) {
    throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY must be present in the runtime')
  }
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const body = await readJson(req)
  if (body?.['action'] === 'deployment-readiness') return await deploymentReadiness()

  const email =
    typeof body?.['email'] === 'string' ? body['email'].trim().toLowerCase().slice(0, 321) : ''
  const password = typeof body?.['password'] === 'string' ? body['password'] : ''

  const service = serviceClient()
  const { data: resolvedAlias } = await service.rpc('resolve_email_sign_in', {
    p_email: email,
    p_ip_hash: await clientIpHash(req),
  })
  const authAlias = typeof resolvedAlias === 'string' ? resolvedAlias : null

  // A request-local public client delegates both password verification and
  // session minting to Supabase Auth. The service-role client never sees the
  // password grant, and even an unresolved address takes the same Auth path.
  const { data, error } = await publicAuthClient().auth.signInWithPassword({
    email: authAlias ?? DUMMY_ALIAS,
    password,
  })
  if (error || !authAlias || !data.session || !data.user) {
    return json(INVALID, 401)
  }

  // Close the small race between private resolution and password grant.
  const { data: profile } = await service
    .from('profiles')
    .select('is_active')
    .eq('id', data.user.id)
    .maybeSingle()
  if (!profile?.is_active) return json(INVALID, 401)

  return json(
    {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
    },
    200,
  )
})
