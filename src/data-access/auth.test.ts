import { beforeEach, describe, expect, it, vi } from 'vitest'

const supabase = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  invoke: vi.fn(),
  setSession: vi.fn(),
}))

vi.mock('./supabase', () => ({
  getSupabaseClient: () => ({
    auth: {
      signInWithPassword: supabase.signInWithPassword,
      setSession: supabase.setSession,
    },
    functions: { invoke: supabase.invoke },
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
    supabase.invoke.mockResolvedValue({
      data: {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      },
      error: null,
    })
    supabase.setSession.mockResolvedValue({
      data: {
        user: {
          id: 'person-1',
          email: 'owner@login.shawarmania.invalid',
        },
      },
      error: null,
    })
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
    expect(supabase.invoke).not.toHaveBeenCalled()
  })

  it('uses the private email bridge and installs its Supabase session', async () => {
    await expect(signIn(' Owner@Example.com ', 'correct-password')).resolves.toEqual({
      userId: 'person-1',
      username: 'owner',
    })
    expect(supabase.signInWithPassword).not.toHaveBeenCalled()
    expect(supabase.invoke).toHaveBeenCalledWith('email-sign-in', {
      body: { email: 'owner@example.com', password: 'correct-password' },
    })
    expect(supabase.setSession).toHaveBeenCalledWith({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
    })
  })

  it('returns the same refusal when the email bridge cannot authenticate', async () => {
    supabase.invoke.mockResolvedValue({
      data: { error: 'invalid_credentials' },
      error: new Error('non-2xx'),
    })

    await expect(signIn('owner@example.com', 'wrong-password')).rejects.toEqual(
      expect.objectContaining<Partial<SignInError>>({
        code: 'invalid_credentials',
      }),
    )
    expect(supabase.setSession).not.toHaveBeenCalled()
  })

  it('refuses a malformed identifier before either authentication path', async () => {
    await expect(signIn('@owner', 'correct-password')).rejects.toEqual(
      expect.objectContaining<Partial<SignInError>>({
        code: 'invalid_credentials',
      }),
    )
    expect(supabase.signInWithPassword).not.toHaveBeenCalled()
    expect(supabase.invoke).not.toHaveBeenCalled()
  })
})
