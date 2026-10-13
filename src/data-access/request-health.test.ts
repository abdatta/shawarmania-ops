import { describe, expect, it, vi } from 'vitest'

import {
  HEALTH_WINDOW_MS,
  RequestHealth,
  instrumentFetch,
  isFailure,
  resourceOf,
} from './request-health'

/**
 * A tablet's request counting (a-release-can-be-switched-off, D13): counts and
 * durations only, failures as the owner should see them, a minute's window, and
 * counting that can never change what a request does.
 */
describe('request health', () => {
  it('names a resource from its path alone, never its query', () => {
    expect(resourceOf('http://x.supabase.co/rest/v1/customers?phone=eq.919876543210')).toBe(
      'rest/v1/customers',
    )
    expect(resourceOf('http://x.supabase.co/rest/v1/rpc/set_change_gate')).toBe(
      'rest/v1/rpc/set_change_gate',
    )
    expect(resourceOf('http://x.supabase.co/functions/v1/counter-devices?code=123456')).toBe(
      'functions/v1/counter-devices',
    )
    expect(resourceOf('http://x.supabase.co/auth/v1/token?grant_type=password')).toBe('auth')
    expect(resourceOf('not a url')).toBe('other')
  })

  it('counts a 5xx, a timeout and a rate limit as failed, and an answer as not', () => {
    expect([500, 503, 504, 408, 429].every(isFailure)).toBe(true)
    expect([200, 204, 400, 401, 403, 404, 409].some(isFailure)).toBe(false)
  })

  it('keeps a minute: requests, failures and the slowest', () => {
    let now = 0
    const health = new RequestHealth(() => now)
    health.record(false, 120)
    health.record(true, 8_000)
    now = 30_000
    health.record(false, 400)
    expect(health.window()).toEqual({ windowSeconds: 60, requests: 3, failed: 1, slowestMs: 8_000 })
    now = 30_000 + HEALTH_WINDOW_MS - 1
    expect(health.window()).toEqual({ windowSeconds: 60, requests: 1, failed: 0, slowestMs: 400 })
  })

  it('passes the response through untouched and counts it', async () => {
    const response = new Response('ok', { status: 503 })
    const record = vi.fn()
    let clock = 0
    const counted = instrumentFetch(
      async () => {
        clock = 250
        return response
      },
      { record },
      () => clock,
    )
    await expect(counted('http://x/rest/v1/bills')).resolves.toBe(response)
    expect(record).toHaveBeenCalledWith(true, 250)
  })

  it('counts a request that throws as failed, and throws it again', async () => {
    const record = vi.fn()
    const counted = instrumentFetch(
      async () => {
        throw new TypeError('Failed to fetch')
      },
      { record },
    )
    await expect(counted('http://x/rest/v1/bills')).rejects.toThrow('Failed to fetch')
    expect(record).toHaveBeenCalledWith(true, expect.any(Number))
  })

  it('never lets its own failure change a request', async () => {
    const response = new Response('ok')
    const counted = instrumentFetch(async () => response, {
      record: () => {
        throw new Error('counting broke')
      },
    })
    await expect(counted('http://x/rest/v1/bills')).resolves.toBe(response)
  })
})
