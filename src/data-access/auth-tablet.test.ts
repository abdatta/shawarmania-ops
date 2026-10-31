import { readFileSync } from 'node:fs'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetBootSnapshotForTests, writeSavedAnswers } from '@/change-gates/snapshot'
import { describeChangeGate } from '@/test/change-gates'

/**
 * A person's session never replaces a tablet's (a-tablet-keeps-its-login,
 * design D2). A browser has one Auth slot, `shawarmania.auth`: a staff member
 * signing in on the counter laptop used to overwrite the tablet's session there,
 * and signing out left the laptop unregistered. With the gate on, the account
 * module refuses before any request leaves the browser.
 */

const supabase = vi.hoisted(() => ({
  getSession: vi.fn(),
  signInWithPassword: vi.fn(),
  setSession: vi.fn(),
  invoke: vi.fn(),
  from: vi.fn(),
}))

vi.mock('./supabase', () => ({
  getSupabaseClient: () => ({
    auth: {
      getSession: supabase.getSession,
      signInWithPassword: supabase.signInWithPassword,
      setSession: supabase.setSession,
    },
    functions: { invoke: supabase.invoke },
    from: supabase.from,
  }),
}))

import {
  ActivationError,
  AUTH_STORAGE_KEY,
  currentUser,
  DEVICE_EMAIL_DOMAIN,
  isDeviceEmail,
  loadOwnCounterDevice,
  redeemInvite,
  signIn,
  SignInError,
  storedSessionIsDevice,
  storedSessionIsDeviceNow,
} from './auth'

const TABLET_EMAIL = `tablet-dddddddd-0000-4000-a000-000000000002@${DEVICE_EMAIL_DOMAIN}`
const PERSON_ALIAS = 'biller.kalyani@login.shawarmania.invalid'
const ASSOCIATED_EMAIL = 'owner@example.com'

/** What supabase-js keeps under its storage key, reduced to what is read. */
function storeSession(email: string | null) {
  if (email === null) {
    localStorage.removeItem(AUTH_STORAGE_KEY)
    return
  }
  localStorage.setItem(
    AUTH_STORAGE_KEY,
    JSON.stringify({ access_token: 'a', refresh_token: 'r', user: { id: 'u', email } }),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  // The client reads the same slot, as supabase-js does.
  supabase.getSession.mockImplementation(async () => {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY)
    const stored = raw ? (JSON.parse(raw) as { user: { email: string } }) : null
    return { data: { session: stored ? { user: stored.user } : null }, error: null }
  })
  supabase.signInWithPassword.mockResolvedValue({
    data: { user: { id: 'person-1', email: PERSON_ALIAS } },
    error: null,
  })
  supabase.invoke.mockResolvedValue({ data: null, error: null })
})

afterEach(() => {
  localStorage.clear()
  resetBootSnapshotForTests()
})

describe('the machine identity', () => {
  it('is the same domain the server issues tablet addresses in', () => {
    // Read as text: the Edge Function's module is outside the app's typecheck.
    const server = readFileSync('supabase/functions/_shared/counter-code.ts', 'utf8')
    expect(server).toMatch(/export const DEVICE_EMAIL_DOMAIN = '([^']+)'/)
    expect(server.match(/export const DEVICE_EMAIL_DOMAIN = '([^']+)'/)?.[1]).toBe(
      DEVICE_EMAIL_DOMAIN,
    )
  })

  it('tells a tablet address from a person alias and an associated email', () => {
    expect(isDeviceEmail(TABLET_EMAIL)).toBe(true)
    expect(isDeviceEmail(TABLET_EMAIL.toUpperCase())).toBe(true)
    expect(isDeviceEmail(PERSON_ALIAS)).toBe(false)
    expect(isDeviceEmail(ASSOCIATED_EMAIL)).toBe(false)
    expect(isDeviceEmail(`someone@evil${DEVICE_EMAIL_DOMAIN}`)).toBe(false)
    expect(isDeviceEmail(null)).toBe(false)
    expect(isDeviceEmail(undefined)).toBe(false)
  })

  it('is reported on the current user, for the session check', async () => {
    storeSession(TABLET_EMAIL)
    await expect(currentUser()).resolves.toMatchObject({ isDevice: true })
    storeSession(PERSON_ALIAS)
    await expect(currentUser()).resolves.toMatchObject({ isDevice: false })
  })
})

describe('the stored session, read with no request', () => {
  it('is a tablet’s only when the stored user is a machine identity', async () => {
    storeSession(TABLET_EMAIL)
    expect(storedSessionIsDeviceNow()).toBe(true)
    await expect(storedSessionIsDevice()).resolves.toBe('counter')

    storeSession(PERSON_ALIAS)
    expect(storedSessionIsDeviceNow()).toBe(false)
    await expect(storedSessionIsDevice()).resolves.toBeNull()

    storeSession(ASSOCIATED_EMAIL)
    await expect(storedSessionIsDevice()).resolves.toBeNull()
  })

  it('reads absent and corrupt storage as not a tablet', async () => {
    storeSession(null)
    expect(storedSessionIsDeviceNow()).toBe(false)
    await expect(storedSessionIsDevice()).resolves.toBeNull()

    localStorage.setItem(AUTH_STORAGE_KEY, '{not json')
    expect(storedSessionIsDeviceNow()).toBe(false)
    localStorage.setItem(AUTH_STORAGE_KEY, 'null')
    expect(storedSessionIsDeviceNow()).toBe(false)
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ user: { email: 42 } }))
    expect(storedSessionIsDeviceNow()).toBe(false)
  })

  it('reads storage that cannot be opened as not a tablet', () => {
    const throwing = {
      getItem: () => {
        throw new Error('SecurityError')
      },
    }
    expect(storedSessionIsDeviceNow(throwing)).toBe(false)
    expect(storedSessionIsDeviceNow(null)).toBe(false)
  })

  it('names a kitchen once the row has been read as one', async () => {
    supabase.from.mockReturnValue({
      select: () => ({
        eq: () => ({
          is: () => ({
            maybeSingle: async () => ({
              data: { id: 'k', outlet_id: 'o', label: 'Kitchen', kind: 'kitchen' },
              error: null,
            }),
          }),
        }),
      }),
    })
    await loadOwnCounterDevice('k')
    storeSession(TABLET_EMAIL)
    await expect(storedSessionIsDevice()).resolves.toBe('kitchen')

    supabase.from.mockReturnValue({
      select: () => ({
        eq: () => ({
          is: () => ({
            maybeSingle: async () => ({
              data: { id: 'c', outlet_id: 'o', label: 'Cafe', kind: 'counter' },
              error: null,
            }),
          }),
        }),
      }),
    })
    await loadOwnCounterDevice('c')
    await expect(storedSessionIsDevice()).resolves.toBe('counter')
  })
})

describeChangeGate('a-tablet-keeps-its-login', (on) => {
  beforeEach(() => {
    writeSavedAnswers(localStorage, { 'a-tablet-keeps-its-login': on })
    resetBootSnapshotForTests()
  })

  const fetchSpy = () => vi.spyOn(globalThis, 'fetch')

  it(
    on
      ? 'refuses a person’s sign-in over a tablet’s session, before any request'
      : 'sends a person’s sign-in over a tablet’s session, as before',
    async () => {
      storeSession(TABLET_EMAIL)
      const before = localStorage.getItem(AUTH_STORAGE_KEY)
      const fetch = fetchSpy()

      if (on) {
        const refusal = signIn('biller.kalyani', 'a-long-password')
        await expect(refusal).rejects.toBeInstanceOf(SignInError)
        await expect(refusal).rejects.toMatchObject({
          code: 'tablet',
          message: 'This is a counter tablet. Sign in on your own phone.',
        })
        expect(supabase.signInWithPassword).not.toHaveBeenCalled()
        expect(supabase.invoke).not.toHaveBeenCalled()
        expect(supabase.setSession).not.toHaveBeenCalled()
        expect(fetch).not.toHaveBeenCalled()
        expect(localStorage.getItem(AUTH_STORAGE_KEY)).toBe(before)
      } else {
        await expect(signIn('biller.kalyani', 'a-long-password')).resolves.toMatchObject({
          userId: 'person-1',
          isDevice: false,
        })
        expect(supabase.signInWithPassword).toHaveBeenCalledTimes(1)
      }
      fetch.mockRestore()
    },
  )

  it(
    on
      ? 'refuses an activation over a tablet’s session, before any request'
      : 'sends an activation over a tablet’s session, as before',
    async () => {
      storeSession(TABLET_EMAIL)
      const before = localStorage.getItem(AUTH_STORAGE_KEY)
      const fetch = fetchSpy()

      if (on) {
        const refusal = redeemInvite('ABCD2345', 'biller.kalyani', 'a-long-password')
        await expect(refusal).rejects.toBeInstanceOf(ActivationError)
        await expect(refusal).rejects.toMatchObject({
          code: 'tablet',
          message: 'This is a counter tablet. Sign in on your own phone.',
        })
        expect(supabase.invoke).not.toHaveBeenCalled()
        expect(fetch).not.toHaveBeenCalled()
        expect(localStorage.getItem(AUTH_STORAGE_KEY)).toBe(before)
      } else {
        await expect(
          redeemInvite('ABCD2345', 'biller.kalyani', 'a-long-password'),
        ).resolves.toBeUndefined()
        expect(supabase.invoke).toHaveBeenCalledWith('redeem-invite', expect.anything())
      }
      fetch.mockRestore()
    },
  )

  it('lets a person sign in where no tablet is set up, either way', async () => {
    storeSession(null)
    await expect(signIn('biller.kalyani', 'a-long-password')).resolves.toMatchObject({
      userId: 'person-1',
    })
    storeSession(PERSON_ALIAS)
    await expect(signIn('biller.kalyani', 'a-long-password')).resolves.toMatchObject({
      userId: 'person-1',
    })
    expect(supabase.signInWithPassword).toHaveBeenCalledTimes(2)
  })
})
