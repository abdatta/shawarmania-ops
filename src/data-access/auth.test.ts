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

import {
  ActivationError,
  CounterSetupError,
  previewInvite,
  redeemInvite,
  setUpCounterDevice,
  signIn,
  SignInError,
} from './auth'

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

/**
 * Setting a tablet up, and the three things a failure can be.
 *
 * Written because all three were one thing. Every failure that was not a
 * transport failure became `invalid_code`, so an undeployed function and a
 * fault raised before the code was read both reached somebody at a counter as
 * "that setup code did not work" — advice that would have them burn a second
 * code on a service that could not answer.
 */
describe('setting a tablet up, and who is to blame', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const DEAD_CODE = /that setup code did not work/i
  const UNSENDABLE =
    'This app could not send that action. Nothing was recorded. Please report this.'

  /** What the platform gateway itself answers for a function that is not deployed. */
  function notDeployed(): FunctionsHttpError {
    return new FunctionsHttpError(
      new Response(
        JSON.stringify({ code: 'NOT_FOUND', message: 'Requested function was not found' }),
        {
          status: 404,
          headers: { 'content-type': 'application/json' },
        },
      ),
    )
  }

  it('does not blame the code when the function is not deployed', async () => {
    // The 2026-08-11 production state, exactly: `counter-setup` answering 404
    // with a body that carries no `error` key at all.
    supabase.invoke.mockResolvedValue({ data: null, error: notDeployed() })

    await expect(setUpCounterDevice('ABCDE-FGHJK')).rejects.toEqual(
      expect.objectContaining<Partial<CounterSetupError>>({
        code: 'unsendable',
        message: UNSENDABLE,
      }),
    )
  })

  it('does not blame the code for a fault raised before the code is read', async () => {
    // `setup_failed` is returned when the machine identity cannot be created,
    // which happens before the hash is compared to anything. The code is
    // untouched and still usable.
    supabase.invoke.mockResolvedValue({ data: null, error: functionHttpError('setup_failed', 500) })

    await expect(setUpCounterDevice('ABCDE-FGHJK')).rejects.toEqual(
      expect.objectContaining<Partial<CounterSetupError>>({ code: 'unsendable' }),
    )
  })

  it('does not blame the code for a 200 carrying no credential', async () => {
    supabase.invoke.mockResolvedValue({ data: {}, error: null })

    await expect(setUpCounterDevice('ABCDE-FGHJK')).rejects.toEqual(
      expect.objectContaining<Partial<CounterSetupError>>({ code: 'unsendable' }),
    )
  })

  it('still reports a refused code as a refused code', async () => {
    supabase.invoke.mockResolvedValue({ data: null, error: functionHttpError('invalid_code') })

    await expect(setUpCounterDevice('ABCDE-FGHJK')).rejects.toEqual(
      expect.objectContaining<Partial<CounterSetupError>>({ code: 'invalid_code' }),
    )
    await expect(setUpCounterDevice('ABCDE-FGHJK')).rejects.toThrow(DEAD_CODE)
  })

  it('still names the outlet-level refusal, which describes no code', async () => {
    supabase.invoke.mockResolvedValue({
      data: null,
      error: functionHttpError('tablet_exists', 409),
    })

    await expect(setUpCounterDevice('ABCDE-FGHJK')).rejects.toEqual(
      expect.objectContaining<Partial<CounterSetupError>>({ code: 'tablet_exists' }),
    )
  })

  it('still reports a genuinely unreachable service as a connection problem', async () => {
    supabase.invoke.mockResolvedValue({
      data: null,
      error: new FunctionsFetchError(new TypeError('provider wording must stay private')),
    })

    await expect(setUpCounterDevice('ABCDE-FGHJK')).rejects.toEqual(
      expect.objectContaining<Partial<CounterSetupError>>({
        code: 'unavailable',
        message: CONNECTION_MESSAGE,
      }),
    )
  })

  /**
   * The property the whole flow rests on, asserted directly rather than left to
   * be inferred from the branch above. `counter-setup` collapses unknown, wrong,
   * expired, consumed, superseded and exhausted into one `invalid_code` body
   * before it answers; this proves nothing on the client pulls them apart, so a
   * later branch that tried to would fail here rather than ship an oracle.
   */
  it('gives one identical refusal however the code failed', async () => {
    const messages = new Set<string>()

    for (const status of [400, 400, 400, 401, 403]) {
      supabase.invoke.mockResolvedValue({
        data: null,
        error: functionHttpError('invalid_code', status),
      })
      await setUpCounterDevice('ABCDE-FGHJK').catch((cause: CounterSetupError) => {
        messages.add(`${cause.code}:${cause.message}`)
      })
    }

    expect(messages.size, 'a code refusal must not vary with anything').toBe(1)
  })
})
