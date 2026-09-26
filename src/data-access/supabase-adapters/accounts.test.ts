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

describe('the attendance roster', () => {
  it('is one read of profiles and never the privileged account function', async () => {
    const order = vi.fn().mockResolvedValue({
      data: [
        {
          id: 'person-1',
          full_name: 'Two Outlets',
          is_active: true,
          role_title: 'Counter staff',
          assignments: [
            {
              id: 'assignment-1',
              role: 'employee',
              outlet_id: 'outlet-1',
              started_on: '2026-07-01',
              ended_on: null,
            },
          ],
        },
      ],
      error: null,
    })
    const select = vi.fn(() => ({ order }))
    const from = vi.fn(() => ({ select }))
    const invoke = vi.fn()
    const adapter = createSupabaseAccountsAdapter({
      from,
      functions: { invoke },
    } as unknown as SupabaseClient<Database>)

    expect(await adapter.listRoster()).toEqual([
      {
        id: 'person-1',
        fullName: 'Two Outlets',
        roleTitle: 'Counter staff',
        isActive: true,
        assignments: [
          {
            id: 'assignment-1',
            role: 'employee',
            outletId: 'outlet-1',
            startedOn: '2026-07-01',
            endedOn: null,
          },
        ],
      },
    ])
    expect(from).toHaveBeenCalledOnce()
    expect(from).toHaveBeenCalledWith('profiles')
    // No identifier, invite or fingerprint is asked for.
    expect(select).toHaveBeenCalledWith(expect.not.stringMatching(/phone|username|email/))
    expect(invoke).not.toHaveBeenCalled()
  })
})
