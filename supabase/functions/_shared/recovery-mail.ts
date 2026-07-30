export interface RecoveryMailConfig {
  resendApiKey?: string | null
  recoveryEmailFrom?: string | null
  supabaseUrl?: string | null
}

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

function htmlFor(link: string): string {
  return [
    '<p>You asked to reset your Shawarmania Ops password.</p>',
    `<p><a href="${link}">Reset your password</a></p>`,
    '<p>If you did not ask for this, you can ignore this message.</p>',
  ].join('')
}

export async function sendRecoveryEmail(
  to: string,
  link: string,
  config: RecoveryMailConfig,
  fetcher: Fetcher = fetch,
): Promise<boolean> {
  if (config.resendApiKey) {
    const response = await fetcher('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: config.recoveryEmailFrom ?? 'Shawarmania Ops <access@ops.shawarmania.in>',
        to: [to],
        subject: 'Reset your Shawarmania Ops password',
        html: htmlFor(link),
        text: `Reset your Shawarmania Ops password: ${link}`,
      }),
    })
    return response.ok
  }

  const supabaseUrl = config.supabaseUrl ?? ''
  if (!supabaseUrl.includes('127.0.0.1') && !supabaseUrl.includes('kong')) {
    return false
  }

  const response = await fetcher('http://inbucket:8025/api/v1/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      From: { Email: 'access@shawarmania.test', Name: 'Shawarmania Ops' },
      To: [{ Email: to }],
      Subject: 'Reset your Shawarmania Ops password',
      HTML: htmlFor(link),
      Text: `Reset your Shawarmania Ops password: ${link}`,
      Tags: ['super-admin-recovery'],
    }),
  })
  return response.ok
}
