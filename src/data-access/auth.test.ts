import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const supabase = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
}))

vi.mock('./supabase', () => ({
  getSupabaseClient: () => ({
    auth: {
      signInWithPassword: supabase.signInWithPassword,
    },
  }),
}))

import { signIn, SignInError } from './auth'

describe('provider identifier at sign-in', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    supabase.signInWithPassword.mockResolvedValue({
      data: {
        user: {
          id: 'person-1',
          email: 'owner@login.shawarmania.invalid',
        },
      },
      error: null,
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('encodes an ordinary username as the reserved Auth alias', async () => {
    await expect(signIn('Owner', 'correct-password')).resolves.toEqual({
      userId: 'person-1',
      username: 'owner',
    })
    expect(supabase.signInWithPassword).toHaveBeenCalledWith({
      email: 'owner@login.shawarmania.invalid',
      password: 'correct-password',
    })
  })

  it('refuses a current email when the cutover switch is absent', async () => {
    await expect(signIn('owner@example.com', 'correct-password')).rejects.toEqual(
      expect.objectContaining<Partial<SignInError>>({
        code: 'invalid_credentials',
      }),
    )
    expect(supabase.signInWithPassword).not.toHaveBeenCalled()
  })

  it('passes a normalized current email only in supervised cutover mode', async () => {
    vi.stubEnv('VITE_AUTH_CUTOVER_MODE', 'email-or-username')
    supabase.signInWithPassword.mockResolvedValue({
      data: {
        user: {
          id: 'legacy-owner',
          email: 'owner@example.com',
        },
      },
      error: null,
    })

    await expect(signIn(' Owner@Example.com ', 'correct-password')).resolves.toEqual({
      userId: 'legacy-owner',
      username: null,
    })
    expect(supabase.signInWithPassword).toHaveBeenCalledWith({
      email: 'owner@example.com',
      password: 'correct-password',
    })
  })
})
