import type { SupabaseClient } from '@supabase/supabase-js'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Database } from '../database.types'
import { deriveAccountLifecycle } from '../adapters'
import { onHumanSessionInvalid } from '@/session/human-session-invalid'

import { createSupabaseAccountsAdapter } from './accounts'

function clientWithFailure(code: string | null): SupabaseClient<Database> {
  const error = code
    ? {
        context: new Response(JSON.stringify({ error: code }), {
          status: code === 'session_invalid' ? 401 : 403,
          headers: { 'content-type': 'application/json' },
        }),
      }
    : new TypeError('Failed to fetch')
  return {
    functions: { invoke: vi.fn().mockResolvedValue({ data: null, error }) },
  } as unknown as SupabaseClient<Database>
}

let stop: (() => void) | undefined
afterEach(() => {
  stop?.()
  stop = undefined
})

describe('real account adapter session classification', () => {
  it('signals the shared human session only for canonical session_invalid', async () => {
    const invalidated = vi.fn()
    stop = onHumanSessionInvalid(invalidated)
    const adapter = createSupabaseAccountsAdapter(clientWithFailure('session_invalid'))

    await expect(adapter.issueHandover('person-1')).rejects.toMatchObject({
      code: 'session_invalid',
    })
    expect(invalidated).toHaveBeenCalledOnce()
  })

  it('keeps a forbidden refusal local to the account action', async () => {
    const invalidated = vi.fn()
    stop = onHumanSessionInvalid(invalidated)
    const adapter = createSupabaseAccountsAdapter(clientWithFailure('forbidden'))

    await expect(adapter.issueHandover('person-1')).rejects.toMatchObject({ code: 'forbidden' })
    expect(invalidated).not.toHaveBeenCalled()
  })

  it('preserves the session when no server response exists', async () => {
    const invalidated = vi.fn()
    stop = onHumanSessionInvalid(invalidated)
    const adapter = createSupabaseAccountsAdapter(clientWithFailure(null))

    await expect(adapter.issueHandover('person-1')).rejects.toMatchObject({ code: 'unavailable' })
    expect(invalidated).not.toHaveBeenCalled()
  })
})

describe('account lifecycle derivation', () => {
  const now = new Date('2026-08-12T12:00:00.000Z')

  it('uses successful sign-in history rather than an invite row as activation truth', () => {
    expect(
      deriveAccountLifecycle(
        {
          isActive: true,
          hasSignedIn: true,
          invite: { purpose: 'password_reset', expiresAt: '2026-08-13T12:00:00.000Z' },
        },
        now,
      ),
    ).toEqual({
      kind: 'password_reset_issued',
      expiresAt: '2026-08-13T12:00:00.000Z',
    })
  })

  it('treats an expired unused invite as inert', () => {
    expect(
      deriveAccountLifecycle(
        {
          isActive: true,
          hasSignedIn: false,
          invite: { purpose: 'activation', expiresAt: '2026-08-11T12:00:00.000Z' },
        },
        now,
      ),
    ).toEqual({ kind: 'needs_setup' })
  })
})
