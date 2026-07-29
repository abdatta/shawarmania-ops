import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Profile, TokenClaims } from '@/data-access/auth'

import { useRealSession } from './use-real-session'

/**
 * The session provider's job is to notice two things quickly and one thing
 * never: deactivation, reassignment, and — never — a flaky network.
 */

const auth = vi.hoisted(() => ({
  currentUser: vi.fn(),
  loadOwnProfile: vi.fn(),
  currentClaims: vi.fn(),
  refreshClaims: vi.fn(),
  signOut: vi.fn(),
  onAuthChange: vi.fn(),
}))

vi.mock('@/data-access/auth', () => auth)

const PROFILE: Profile = {
  id: 'u-1',
  full_name: 'Synthetic Admin Kal',
  phone: null,
  role: 'franchise_admin',
  outlet_id: 'outlet-kalyani',
  is_active: true,
  staff_code: 'KAL-A1',
  role_title: 'Manager',
  joined_on: null,
  left_on: null,
  created_at: '2026-07-26T00:00:00+00:00',
}

const MATCHING_CLAIMS: TokenClaims = { role: 'franchise_admin', outletId: 'outlet-kalyani' }

function becomeVisible() {
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => {
  vi.clearAllMocks()
  auth.onAuthChange.mockReturnValue(() => {})
  auth.signOut.mockResolvedValue(undefined)
  auth.currentUser.mockResolvedValue({ userId: 'u-1', email: 'admin.kalyani@example.com' })
  auth.loadOwnProfile.mockResolvedValue(PROFILE)
  auth.currentClaims.mockResolvedValue(MATCHING_CLAIMS)
  auth.refreshClaims.mockResolvedValue(MATCHING_CLAIMS)
})

describe('useRealSession', () => {
  it('is anonymous with no signed-in user', async () => {
    auth.currentUser.mockResolvedValue(null)
    const { result } = renderHook(() => useRealSession())
    await waitFor(() => expect(result.current.state.status).toBe('anonymous'))
    expect(auth.signOut).not.toHaveBeenCalled()
  })

  it('builds the session from the profile, not from the token', async () => {
    const { result } = renderHook(() => useRealSession())
    await waitFor(() => expect(result.current.state.status).toBe('ready'))

    expect(result.current.state).toEqual({
      status: 'ready',
      session: {
        mode: 'real',
        userId: 'u-1',
        role: 'franchise_admin',
        outletId: 'outlet-kalyani',
        displayName: 'Synthetic Admin Kal',
      },
    })
  })

  it('treats an empty own-profile read as deactivation and ends the session', async () => {
    // The exact signal: every policy is gated on app_account_active(), so a
    // deactivated account cannot read its own row.
    auth.loadOwnProfile.mockResolvedValue(null)

    const { result } = renderHook(() => useRealSession())
    await waitFor(() => expect(result.current.state.status).toBe('anonymous'))

    expect(result.current.state).toEqual({ status: 'anonymous', reason: 'deactivated' })
    expect(auth.signOut).toHaveBeenCalled()
  })

  it('notices deactivation while the app is already open', async () => {
    const { result } = renderHook(() => useRealSession())
    await waitFor(() => expect(result.current.state.status).toBe('ready'))

    auth.loadOwnProfile.mockResolvedValue(null)
    act(() => becomeVisible())

    await waitFor(() =>
      expect(result.current.state).toEqual({ status: 'anonymous', reason: 'deactivated' }),
    )
  })

  it('refreshes once when the claims disagree with the profile, and carries on', async () => {
    auth.currentClaims.mockResolvedValue({ role: 'employee', outletId: 'outlet-kalyani' })
    auth.refreshClaims.mockResolvedValue(MATCHING_CLAIMS)

    const { result } = renderHook(() => useRealSession())
    await waitFor(() => expect(result.current.state.status).toBe('ready'))

    expect(auth.refreshClaims).toHaveBeenCalledTimes(1)
    expect(auth.signOut).not.toHaveBeenCalled()
  })

  it('ends the session when a refresh does not resolve the mismatch', async () => {
    auth.currentClaims.mockResolvedValue({ role: 'employee', outletId: 'outlet-kalyani' })
    auth.refreshClaims.mockResolvedValue({ role: 'employee', outletId: 'outlet-kalyani' })

    const { result } = renderHook(() => useRealSession())
    await waitFor(() =>
      expect(result.current.state).toEqual({ status: 'anonymous', reason: 'role-changed' }),
    )
    expect(auth.signOut).toHaveBeenCalled()
  })

  it('treats a changed outlet as a mismatch too, not only a changed role', async () => {
    auth.currentClaims.mockResolvedValue({
      role: 'franchise_admin',
      outletId: 'outlet-kanchrapara',
    })
    auth.refreshClaims.mockResolvedValue({
      role: 'franchise_admin',
      outletId: 'outlet-kanchrapara',
    })

    const { result } = renderHook(() => useRealSession())
    await waitFor(() =>
      expect(result.current.state).toEqual({ status: 'anonymous', reason: 'role-changed' }),
    )
  })

  it('does not sign anyone out because the network failed', async () => {
    const { result } = renderHook(() => useRealSession())
    await waitFor(() => expect(result.current.state.status).toBe('ready'))

    auth.loadOwnProfile.mockRejectedValue(new Error('offline'))
    act(() => becomeVisible())

    // Give the failed revalidation time to do the wrong thing, if it were going to.
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(result.current.state.status).toBe('ready')
    expect(auth.signOut).not.toHaveBeenCalled()
  })

  it('offers a retry rather than a sign-out when the very first check fails', async () => {
    auth.loadOwnProfile.mockRejectedValue(new Error('offline'))

    const { result } = renderHook(() => useRealSession())
    await waitFor(() => expect(result.current.state.status).toBe('unavailable'))
    expect(auth.signOut).not.toHaveBeenCalled()

    auth.loadOwnProfile.mockResolvedValue(PROFILE)
    act(() => result.current.revalidate())
    await waitFor(() => expect(result.current.state.status).toBe('ready'))
  })

  it('signs out on request', async () => {
    const { result } = renderHook(() => useRealSession())
    await waitFor(() => expect(result.current.state.status).toBe('ready'))

    await act(async () => {
      await result.current.endSession()
    })

    expect(auth.signOut).toHaveBeenCalled()
    expect(result.current.state).toEqual({ status: 'anonymous' })
  })
})
