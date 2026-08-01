import {
  AuthApiError,
  AuthRetryableFetchError,
  FunctionsFetchError,
  FunctionsHttpError,
} from '@supabase/supabase-js'
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

import { ActivationError, previewInvite, redeemInvite, signIn, SignInError } from './auth'

const CONNECTION_MESSAGE =
  "Could not reach Shawarmania. Check this device's internet connection and try again."

function functionHttpError(reason: string, status = 400): FunctionsHttpError {
  return new FunctionsHttpError(
    new Response(JSON.stringify({ error: reason }), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  )
}

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
      error: functionHttpError('invalid_credentials', 401),
    })

    await expect(signIn('owner@example.com', 'wrong-password')).rejects.toEqual(
      expect.objectContaining<Partial<SignInError>>({
        code: 'invalid_credentials',
      }),
    )
    expect(supabase.setSession).not.toHaveBeenCalled()
  })

  it('keeps a reached username refusal indistinguishable from the email refusal', async () => {
    supabase.signInWithPassword.mockResolvedValue({
      data: { user: null },
      error: new AuthApiError('provider wording must stay private', 400, 'invalid_credentials'),
    })

    await expect(signIn('owner', 'wrong-password')).rejects.toEqual(
      expect.objectContaining<Partial<SignInError>>({
        code: 'invalid_credentials',
        message: 'Those sign-in details are not right.',
      }),
    )
  })

  it('classifies a username Auth request with no HTTP response as unreachable', async () => {
    supabase.signInWithPassword.mockResolvedValue({
      data: { user: null },
      error: new AuthRetryableFetchError('provider wording must stay private', 0),
    })

    await expect(signIn('owner', 'a-password')).rejects.toEqual(
      expect.objectContaining<Partial<SignInError>>({
        code: 'unreachable',
        message: CONNECTION_MESSAGE,
      }),
    )
  })

  it('does not call a received retryable server response unreachable', async () => {
    supabase.signInWithPassword.mockResolvedValue({
      data: { user: null },
      error: new AuthRetryableFetchError('provider wording must stay private', 503),
    })

    await expect(signIn('owner', 'a-password')).rejects.toEqual(
      expect.objectContaining<Partial<SignInError>>({
        code: 'invalid_credentials',
        message: 'Those sign-in details are not right.',
      }),
    )
  })

  it('classifies an email bridge fetch failure as unreachable', async () => {
    supabase.invoke.mockResolvedValue({
      data: null,
      error: new FunctionsFetchError(new TypeError('provider wording must stay private')),
    })

    await expect(signIn('owner@example.com', 'a-password')).rejects.toEqual(
      expect.objectContaining<Partial<SignInError>>({
        code: 'unreachable',
        message: CONNECTION_MESSAGE,
      }),
    )
  })

  it('classifies a no-response session installation after email resolution as unreachable', async () => {
    supabase.setSession.mockResolvedValue({
      data: { user: null },
      error: new AuthRetryableFetchError('provider wording must stay private', 0),
    })

    await expect(signIn('owner@example.com', 'a-password')).rejects.toEqual(
      expect.objectContaining<Partial<SignInError>>({
        code: 'unreachable',
        message: CONNECTION_MESSAGE,
      }),
    )
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

describe('activation provider failures', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('preserves the uniform invalid-code refusal from a reached preview request', async () => {
    supabase.invoke.mockResolvedValue({
      data: null,
      error: functionHttpError('invalid_code'),
    })

    await expect(previewInvite('ABCDE-FGHJK')).rejects.toEqual(
      expect.objectContaining<Partial<ActivationError>>({ code: 'invalid_code' }),
    )
  })

  it('preserves the explicit rate-limit result from a reached activation request', async () => {
    supabase.invoke.mockResolvedValue({
      data: null,
      error: functionHttpError('rate_limited', 429),
    })

    await expect(previewInvite('ABCDE-FGHJK')).rejects.toEqual(
      expect.objectContaining<Partial<ActivationError>>({
        code: 'rate_limited',
        message:
          'Too many activation attempts from this connection. Wait a few minutes and try again.',
      }),
    )
  })

  it('reports connection guidance when activation preview receives no response', async () => {
    supabase.invoke.mockResolvedValue({
      data: null,
      error: new FunctionsFetchError(new TypeError('provider wording must stay private')),
    })

    await expect(previewInvite('ABCDE-FGHJK')).rejects.toEqual(
      expect.objectContaining<Partial<ActivationError>>({
        code: 'unavailable',
        message: CONNECTION_MESSAGE,
      }),
    )
  })

  it('reports connection guidance when activation redemption receives no response', async () => {
    supabase.invoke.mockResolvedValue({
      data: null,
      error: new FunctionsFetchError(new TypeError('provider wording must stay private')),
    })

    await expect(redeemInvite('ABCDE-FGHJK', 'new.staff', 'a-real-password')).rejects.toEqual(
      expect.objectContaining<Partial<ActivationError>>({
        code: 'unavailable',
        message: CONNECTION_MESSAGE,
      }),
    )
  })
})
