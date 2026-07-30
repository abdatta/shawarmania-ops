import { describe, expect, it, vi } from 'vitest'

import { checkProductionAuthReadiness } from './check-production-auth-readiness.mjs'

const config = {
  supabaseUrl: 'https://project.example.test',
  anonKey: 'public-anon-key',
}

describe('production auth readiness check', () => {
  it('accepts only an explicit successful readiness response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ready: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    await expect(checkProductionAuthReadiness({ ...config, fetchImpl })).resolves.toBeUndefined()
    expect(fetchImpl).toHaveBeenCalledWith(
      new URL('https://project.example.test/functions/v1/email-sign-in'),
      expect.objectContaining({
        method: 'POST',
        headers: {
          apikey: 'public-anon-key',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'deployment-readiness' }),
      }),
    )
  })

  it.each([
    ['a missing function', new Response('{}', { status: 404 })],
    ['an incomplete backend', new Response('{"ready":false}', { status: 503 })],
    ['a misleading success body', new Response('{"ready":"true"}', { status: 200 })],
  ])('fails closed for %s', async (_description, response) => {
    await expect(
      checkProductionAuthReadiness({
        ...config,
        fetchImpl: vi.fn().mockResolvedValue(response),
      }),
    ).rejects.toThrow('username backend rollout is incomplete')
  })

  it('fails before the request when either public build variable is absent', async () => {
    const fetchImpl = vi.fn()
    await expect(
      checkProductionAuthReadiness({
        supabaseUrl: '',
        anonKey: '',
        fetchImpl,
      }),
    ).rejects.toThrow('VITE_SUPABASE_URL')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('does not echo provider responses or network details', async () => {
    await expect(
      checkProductionAuthReadiness({
        ...config,
        fetchImpl: vi.fn().mockRejectedValue(new Error('secret upstream detail')),
      }),
    ).rejects.not.toThrow('secret upstream detail')
  })
})
