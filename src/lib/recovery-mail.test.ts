import { describe, expect, it, vi } from 'vitest'

import { sendRecoveryEmail } from '../../supabase/functions/_shared/recovery-mail'

const RECIPIENT = 'owner@example.com'
const LINK = 'https://ops.shawarmania.in/recover?token_hash=test&type=recovery'

describe('Super Admin recovery mail transport', () => {
  it('sends production recovery through Resend', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))

    await expect(
      sendRecoveryEmail(
        RECIPIENT,
        LINK,
        {
          resendApiKey: 're_test',
          recoveryEmailFrom: 'Shawarmania Ops <owner@example.com>',
          supabaseUrl: 'https://project.supabase.co',
        },
        fetcher,
      ),
    ).resolves.toBe(true)

    expect(fetcher).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer re_test' }),
      }),
    )
    const request = fetcher.mock.calls[0]![1] as RequestInit
    expect(JSON.parse(request.body as string)).toMatchObject({
      from: 'Shawarmania Ops <owner@example.com>',
      to: [RECIPIENT],
      text: expect.stringContaining(LINK),
    })
  })

  it('reports a provider refusal so the signed hook can fail closed', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('refused', { status: 503 }))

    await expect(
      sendRecoveryEmail(
        RECIPIENT,
        LINK,
        { resendApiKey: 're_test', supabaseUrl: 'https://project.supabase.co' },
        fetcher,
      ),
    ).resolves.toBe(false)
  })

  it('never falls back to the local sink on a hosted project', async () => {
    const fetcher = vi.fn()

    await expect(
      sendRecoveryEmail(RECIPIENT, LINK, { supabaseUrl: 'https://project.supabase.co' }, fetcher),
    ).resolves.toBe(false)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('uses Mailpit only for the local stack', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))

    await expect(
      sendRecoveryEmail(RECIPIENT, LINK, { supabaseUrl: 'http://127.0.0.1:54321' }, fetcher),
    ).resolves.toBe(true)
    expect(fetcher).toHaveBeenCalledWith(
      'http://inbucket:8025/api/v1/send',
      expect.objectContaining({ method: 'POST' }),
    )
  })
})
