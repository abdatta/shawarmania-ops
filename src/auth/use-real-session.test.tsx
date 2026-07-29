import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Assignment } from '@/data-access/adapters'
import type { Profile } from '@/data-access/auth'

import { useRealSession } from './use-real-session'

/**
 * The session provider's job is to notice one thing quickly, reflect one thing
 * promptly, and never do the third: deactivation, an assignment change, and —
 * never — sign anybody out because the network blinked.
 *
 * Reassignment used to end a session, because role and outlet were baked into
 * the access token and a stale token could not be reconciled. Since
 * multi-outlet-people nothing about authority is in the token, so an
 * assignment change is simply picked up on the next revalidation — which is
 * what the tests below assert instead.
 */

const auth = vi.hoisted(() => ({
  currentUser: vi.fn(),
  loadOwnProfile: vi.fn(),
  loadOwnAssignments: vi.fn(),
  signOut: vi.fn(),
  onAuthChange: vi.fn(),
}))

vi.mock('@/data-access/auth', () => auth)

const PROFILE: Profile = {
  id: 'u-1',
  full_name: 'Synthetic Admin Kal',
  phone: null,
  is_active: true,
  role_title: 'Manager',
  created_at: '2026-07-26T00:00:00+00:00',
}

const KALYANI = 'outlet-kalyani'
const KANCHRAPARA = 'outlet-kanchrapara'

const MANAGES_KALYANI: Assignment = {
  id: 'a-1',
  role: 'franchise_admin',
  outletId: KALYANI,
  startedOn: '2025-08-01',
  endedOn: null,
}

const WORKS_AT_KANCHRAPARA: Assignment = {
  id: 'a-2',
  role: 'employee',
  outletId: KANCHRAPARA,
  startedOn: '2026-07-01',
  endedOn: null,
}

function becomeVisible() {
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => {
  vi.clearAllMocks()
  auth.onAuthChange.mockReturnValue(() => {})
  auth.signOut.mockResolvedValue(undefined)
  auth.currentUser.mockResolvedValue({ userId: 'u-1', email: 'admin.kalyani@example.com' })
  auth.loadOwnProfile.mockResolvedValue(PROFILE)
  auth.loadOwnAssignments.mockResolvedValue([MANAGES_KALYANI])
})

describe('useRealSession', () => {
  it('is anonymous with no signed-in user', async () => {
    auth.currentUser.mockResolvedValue(null)
    const { result } = renderHook(() => useRealSession())
    await waitFor(() => expect(result.current.state.status).toBe('anonymous'))
    expect(auth.signOut).not.toHaveBeenCalled()
  })

  it('builds the session from the profile and the assignments', async () => {
    const { result } = renderHook(() => useRealSession())
    await waitFor(() => expect(result.current.state.status).toBe('ready'))

    expect(result.current.state).toEqual({
      status: 'ready',
      session: {
        mode: 'real',
        userId: 'u-1',
        assignments: [MANAGES_KALYANI],
        role: 'franchise_admin',
        outletId: KALYANI,
        displayName: 'Synthetic Admin Kal',
      },
    })
  })

  it('derives the highest role, and no single outlet, for somebody at two', async () => {
    auth.loadOwnAssignments.mockResolvedValue([MANAGES_KALYANI, WORKS_AT_KANCHRAPARA])

    const { result } = renderHook(() => useRealSession())
    await waitFor(() => expect(result.current.state.status).toBe('ready'))

    const state = result.current.state
    if (state.status !== 'ready') throw new Error('expected a ready session')
    expect(state.session.role).toBe('franchise_admin')
    // Two outlets, so there is no "their outlet" to derive. A surface that
    // needs one asks; a surface that needs all of them reads `assignments`.
    expect(state.session.outletId).toBeNull()
    expect(state.session.assignments).toHaveLength(2)
  })

  it('ignores an assignment that has ended', async () => {
    auth.loadOwnAssignments.mockResolvedValue([
      MANAGES_KALYANI,
      { ...WORKS_AT_KANCHRAPARA, endedOn: '2026-07-20' },
    ])

    const { result } = renderHook(() => useRealSession())
    await waitFor(() => expect(result.current.state.status).toBe('ready'))

    const state = result.current.state
    if (state.status !== 'ready') throw new Error('expected a ready session')
    // Back to one live outlet, so the derived one is that outlet again.
    expect(state.session.outletId).toBe(KALYANI)
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

  it('picks up a new assignment without signing anybody out', async () => {
    const { result } = renderHook(() => useRealSession())
    await waitFor(() => expect(result.current.state.status).toBe('ready'))

    auth.loadOwnAssignments.mockResolvedValue([MANAGES_KALYANI, WORKS_AT_KANCHRAPARA])
    act(() => becomeVisible())

    await waitFor(() => {
      const state = result.current.state
      if (state.status !== 'ready') throw new Error('expected a ready session')
      expect(state.session.assignments).toHaveLength(2)
    })
    // The whole point of taking authority out of the token: nothing had to be
    // reissued, and nobody had to sign in again.
    expect(auth.signOut).not.toHaveBeenCalled()
  })

  it('keeps the session when the last assignment ends, with nothing held', async () => {
    const { result } = renderHook(() => useRealSession())
    await waitFor(() => expect(result.current.state.status).toBe('ready'))

    auth.loadOwnAssignments.mockResolvedValue([{ ...MANAGES_KALYANI, endedOn: '2026-07-29' }])
    act(() => becomeVisible())

    await waitFor(() => {
      const state = result.current.state
      if (state.status !== 'ready') throw new Error('expected a ready session')
      expect(state.session.role).toBeNull()
    })
    // Placed nowhere is not signed out: the account still exists and still
    // works. What to show them is the role root's problem, not this hook's.
    expect(auth.signOut).not.toHaveBeenCalled()
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
