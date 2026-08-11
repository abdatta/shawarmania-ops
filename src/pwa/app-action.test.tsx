import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AppAction } from '@/components/app-action'
import { requestUpdateNow, resetApplyState } from '@/pwa/apply-update'

import { InstallPromptProvider } from './install-prompt'
import { markUpdateDeferred, recordUpdateReady, resetUpdateState } from './update-store'

vi.mock('@/pwa/apply-update', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/pwa/apply-update')>()),
  requestUpdateNow: vi.fn(),
}))

/**
 * One slot, two possible actions, and which one wins.
 *
 * The precedence matters more than it looks: somebody who has not installed the
 * app gets more from installing it than from taking a build a few minutes
 * early, and nothing is lost by the wait, because the update applies itself the
 * moment the page is free.
 */

const installName = 'Install Shawarmania Ops as an app'
const updateName = 'Update Shawarmania Ops to the latest version'

const originalMatchMedia = window.matchMedia

function mockMatchMedia({ reducedMotion = false }: { reducedMotion?: boolean } = {}) {
  window.matchMedia = vi.fn(
    (query: string) =>
      ({
        matches: query === '(prefers-reduced-motion: reduce)' && reducedMotion,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }) as MediaQueryList,
  )
}

/**
 * The label is present for screen readers throughout; only its width moves.
 *
 * Read from `classList` rather than by substring: the collapsed state still
 * carries `group-hover:opacity-100`, so a substring check reports every state
 * as revealed.
 */
function labelIsRevealed() {
  return screen.getByText('Update').classList.contains('opacity-100')
}

function offerInstallCapability() {
  const event = new Event('beforeinstallprompt', { cancelable: true })
  Object.defineProperties(event, {
    prompt: { value: vi.fn().mockResolvedValue(undefined) },
    userChoice: { value: Promise.resolve({ outcome: 'accepted', platform: 'web' }) },
  })
  act(() => {
    window.dispatchEvent(event)
  })
}

/** What the app does when an update is found and the page turns out to be busy. */
function offerUpdate() {
  act(() => {
    recordUpdateReady()
    markUpdateDeferred()
  })
}

function renderAction() {
  return render(
    <InstallPromptProvider>
      <AppAction />
    </InstallPromptProvider>,
  )
}

describe('the header app action', () => {
  beforeEach(() => {
    mockMatchMedia()
    resetUpdateState()
    resetApplyState()
  })

  afterEach(() => {
    resetUpdateState()
    resetApplyState()
    window.matchMedia = originalMatchMedia
    vi.restoreAllMocks()
  })

  it('renders nothing when neither applies', () => {
    renderAction()

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('offers the update when installation is not actionable', () => {
    renderAction()
    offerUpdate()

    expect(screen.getByRole('button', { name: updateName })).toBeInTheDocument()
  })

  it('offers installation alone when both apply', () => {
    renderAction()
    offerInstallCapability()
    offerUpdate()

    expect(screen.getByRole('button', { name: installName })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: updateName })).not.toBeInTheDocument()
  })

  it('does not offer an update that the app has not deferred', () => {
    // Recorded but not yet judged: the page may well be free, and the loop is
    // about to reload it. Showing an action for a second and taking it away is
    // worse than showing nothing.
    renderAction()
    act(() => {
      recordUpdateReady()
    })

    expect(screen.queryByRole('button', { name: updateName })).not.toBeInTheDocument()
  })

  it('keeps offering the update while the page keeps changing', () => {
    renderAction()
    offerUpdate()

    // A second deferral, as the loop makes on every poll, must not disturb it.
    act(() => {
      markUpdateDeferred()
      markUpdateDeferred()
    })

    expect(screen.getByRole('button', { name: updateName })).toBeInTheDocument()
  })

  it('keeps reintroducing itself while the update is unapplied', () => {
    // The install action teaches its label once and goes quiet. This one is on
    // a tablet nobody is studying, so a single reveal five minutes ago has not
    // been seen.
    vi.useFakeTimers()
    renderAction()
    offerUpdate()

    expect(labelIsRevealed()).toBe(true)
    const name = screen.getByRole('button').getAttribute('aria-label')

    act(() => {
      vi.advanceTimersByTime(3_000)
    })
    expect(labelIsRevealed()).toBe(false)

    act(() => {
      vi.advanceTimersByTime(5_000)
    })
    expect(labelIsRevealed()).toBe(true)

    act(() => {
      vi.advanceTimersByTime(3_000)
    })
    expect(labelIsRevealed()).toBe(false)

    // The cycle is visual only; nothing changes underneath a screen reader.
    expect(screen.getByRole('button').getAttribute('aria-label')).toBe(name)
    vi.useRealTimers()
  })

  it('states it without moving when reduced motion is preferred', () => {
    vi.useFakeTimers()
    mockMatchMedia({ reducedMotion: true })
    renderAction()
    offerUpdate()

    expect(labelIsRevealed()).toBe(true)

    act(() => {
      vi.advanceTimersByTime(30_000)
    })

    expect(labelIsRevealed()).toBe(true)
    vi.useRealTimers()
  })

  it('applies the update when the action is used', async () => {
    // Asserted through the seam rather than through `location.reload`, which
    // jsdom will not let a test redefine. That the reload itself happens once
    // and only once is pinned in apply-update.test.ts, against the real guard.
    renderAction()
    offerUpdate()
    await userEvent.click(screen.getByRole('button', { name: updateName }))

    expect(requestUpdateNow).toHaveBeenCalledTimes(1)
  })
})
