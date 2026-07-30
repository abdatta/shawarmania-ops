import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0'

import { authAliasToUsername } from '../../../shared/username.ts'
import { isOwner, loadAccount, serviceClient } from '../_shared/authority.ts'
import { json } from '../_shared/http.ts'
import { sendRecoveryEmail } from '../_shared/recovery-mail.ts'

interface SendEmailHookPayload {
  user?: {
    id?: string
    email?: string
  }
  email_data?: {
    token_hash?: string
    redirect_to?: string
    email_action_type?: string
  }
}

const LOCAL_HOOK_SECRET = 'v1,whsec_c2hhd2FybWFuaWEtbG9jYWwtaG9vay12MQ=='

function recoveryRedirect(): string {
  return Deno.env.get('OWNER_RECOVERY_REDIRECT_URL') ?? 'https://ops.shawarmania.in/recover'
}

function recoveryLink(tokenHash: string): string {
  const link = new URL(recoveryRedirect())
  link.searchParams.set('token_hash', tokenHash)
  link.searchParams.set('type', 'recovery')
  return link.toString()
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const payloadText = await req.text()
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const configuredSecret =
    Deno.env.get('SEND_EMAIL_HOOK_SECRET') ??
    (supabaseUrl.includes('127.0.0.1') || supabaseUrl.includes('kong') ? LOCAL_HOOK_SECRET : null)
  if (!configuredSecret) return json({ error: 'hook_not_configured' }, 500)

  let payload: SendEmailHookPayload
  try {
    const base64Secret = configuredSecret.replace(/^v1,whsec_/, '')
    payload = new Webhook(base64Secret).verify(
      payloadText,
      Object.fromEntries(req.headers),
    ) as SendEmailHookPayload
  } catch {
    return json({ error: 'invalid_signature' }, 401)
  }

  const action = payload.email_data?.email_action_type
  const tokenHash = payload.email_data?.token_hash
  const redirectTo = payload.email_data?.redirect_to
  const profileId = payload.user?.id
  const authAlias = payload.user?.email

  // Recovery is the only mail action this system permits. In particular,
  // email_change is how a signed-in user could otherwise rewrite the hidden
  // Auth alias outside the admin username path.
  if (
    action !== 'recovery' ||
    !tokenHash ||
    !profileId ||
    !authAliasToUsername(authAlias) ||
    redirectTo !== recoveryRedirect()
  ) {
    return json({ error: 'mail_action_not_allowed' }, 403)
  }

  const service = serviceClient()
  const target = await loadAccount(service, profileId)
  if (!target || !target.isActive || !isOwner(target)) {
    return json({ error: 'mail_action_not_allowed' }, 403)
  }

  const { data: accountEmail, error } = await service
    .from('account_emails')
    .select('email')
    .eq('profile_id', profileId)
    .maybeSingle()
  if (error || !accountEmail?.email) return json({ error: 'mail_action_not_allowed' }, 403)

  const sent = await sendRecoveryEmail(accountEmail.email as string, recoveryLink(tokenHash), {
    resendApiKey: Deno.env.get('RESEND_API_KEY'),
    recoveryEmailFrom: Deno.env.get('RECOVERY_EMAIL_FROM'),
    supabaseUrl,
  })
  if (!sent) return json({ error: 'provider_failed' }, 502)
  return json({}, 200)
})
