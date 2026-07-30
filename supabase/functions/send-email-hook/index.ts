import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0'

import { authAliasToUsername } from '../../../shared/username.ts'
import { isOwner, loadAccount, serviceClient } from '../_shared/authority.ts'
import { json } from '../_shared/http.ts'

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

function recoveryRedirect(): string {
  return Deno.env.get('OWNER_RECOVERY_REDIRECT_URL') ?? 'https://ops.shawarmania.in/recover'
}

function recoveryLink(tokenHash: string): string {
  const link = new URL(recoveryRedirect())
  link.searchParams.set('token_hash', tokenHash)
  link.searchParams.set('type', 'recovery')
  return link.toString()
}

function htmlFor(link: string): string {
  return [
    '<p>You asked to reset the Shawarmania owner password.</p>',
    `<p><a href="${link}">Reset owner password</a></p>`,
    '<p>If you did not ask for this, you can ignore this message.</p>',
  ].join('')
}

async function sendRecoveryEmail(to: string, link: string): Promise<boolean> {
  const resendKey = Deno.env.get('RESEND_API_KEY')
  if (resendKey) {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: Deno.env.get('RECOVERY_EMAIL_FROM') ?? 'Shawarmania Ops <access@ops.shawarmania.in>',
        to: [to],
        subject: 'Reset your Shawarmania owner password',
        html: htmlFor(link),
        text: `Reset your Shawarmania owner password: ${link}`,
      }),
    })
    return response.ok
  }

  // The local Supabase stack includes Mailpit. Its HTTP send API lets the same
  // signed hook flow reach the test inbox without any real provider or DNS.
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  if (!supabaseUrl.includes('127.0.0.1') && !supabaseUrl.includes('kong')) return false
  const response = await fetch('http://inbucket:8025/api/v1/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      From: { Email: 'access@shawarmania.test', Name: 'Shawarmania Ops' },
      To: [{ Email: to }],
      Subject: 'Reset your Shawarmania owner password',
      HTML: htmlFor(link),
      Text: `Reset your Shawarmania owner password: ${link}`,
      Tags: ['owner-recovery'],
    }),
  })
  return response.ok
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const payloadText = await req.text()
  const configuredSecret = Deno.env.get('SEND_EMAIL_HOOK_SECRET')
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

  const { data: contact, error } = await service
    .from('account_recovery_contacts')
    .select('email')
    .eq('profile_id', profileId)
    .maybeSingle()
  if (error || !contact?.email) return json({ error: 'mail_action_not_allowed' }, 403)

  const sent = await sendRecoveryEmail(contact.email as string, recoveryLink(tokenHash))
  if (!sent) return json({ error: 'provider_failed' }, 502)
  return json({}, 200)
})
