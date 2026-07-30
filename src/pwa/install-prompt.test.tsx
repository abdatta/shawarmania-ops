import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { InstallAppButton } from '@/components/install-app-button'

import { InstallPromptProvider } from './install-prompt'

const installName = 'Install Shawarmania Ops as an app'
const originalMatchMedia = window.matchMedia
const originalUserAgent = navigator.userAgent
const originalPlatform = navigator.platform
const originalMaxTouchPoints = navigator.maxTouchPoints
const originalStandalone = (navigator as Navigator & { standalone?: boolean }).standalone

function setNavigatorProperty(name: string, value: unknown) {
  Object.defineProperty(navigator, name, {
    configurable: true,
    value,
  })
}

function mockMatchMedia({
  installed = false,
  fullscreen = false,
  reducedMotion = false,
}: {
  installed?: boolean
  fullscreen?: boolean
  reducedMotion?: boolean
} = {}) {
  window.matchMedia = vi.fn((query: string) => {
    const matches =
      (query === '(display-mode: standalone)' && installed) ||
      (query === '(display-mode: fullscreen)' && fullscreen) ||
      (query === '(prefers-reduced-motion: reduce)' && reducedMotion)

    return {
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    } as MediaQueryList
  })
}

function createInstallEvent() {
  const prompt = vi.fn().mockResolvedValue(undefined)
  const event = new Event('beforeinstallprompt', { cancelable: true })

  Object.defineProperties(event, {
    prompt: { value: prompt },
    userChoice: {
      value: Promise.resolve({ outcome: 'accepted', platform: 'web' }),
    },
  })

  return { event, prompt }
}

function renderInstallButton() {
  return render(
    <InstallPromptProvider>
      <InstallAppButton />
    </InstallPromptProvider>,
  )
}

function dispatchInstallCapability() {
  const capability = createInstallEvent()
  act(() => {
    window.dispatchEvent(capability.event)
  })
  return capability
}

describe('PWA install affordance', () => {
  beforeEach(() => {
    sessionStorage.clear()
    mockMatchMedia()
    setNavigatorProperty('userAgent', originalUserAgent)
    setNavigatorProperty('platform', originalPlatform)
    setNavigatorProperty('maxTouchPoints', originalMaxTouchPoints)
    setNavigatorProperty('standalone', false)
  })

  afterEach(() => {
    vi.useRealTimers()
    window.matchMedia = originalMatchMedia
    setNavigatorProperty('userAgent', originalUserAgent)
    setNavigatorProperty('platform', originalPlatform)
    setNavigatorProperty('maxTouchPoints', originalMaxTouchPoints)
    setNavigatorProperty('standalone', originalStandalone)
    sessionStorage.clear()
  })

  it('captures the browser capability and consumes it exactly once', async () => {
    const user = userEvent.setup()
    renderInstallButton()
    expect(screen.queryByRole('button', { name: installName })).not.toBeInTheDocument()

    const { event, prompt } = dispatchInstallCapability()

    expect(event.defaultPrevented).toBe(true)
    await user.click(screen.getByRole('button', { name: installName }))

    await waitFor(() => expect(prompt).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: installName })).not.toBeInTheDocument(),
    )
  })

  it('hides when installation completes', () => {
    renderInstallButton()
    dispatchInstallCapability()
    expect(screen.getByRole('button', { name: installName })).toBeInTheDocument()

    act(() => {
      window.dispatchEvent(new Event('appinstalled'))
    })

    expect(screen.queryByRole('button', { name: installName })).not.toBeInTheDocument()
  })

  it.each([
    ['standalone display mode', { installed: true }, false],
    ['fullscreen display mode', { fullscreen: true }, false],
    ['iOS standalone flag', {}, true],
  ])('stays hidden in %s', (_label, mediaOptions, standalone) => {
    mockMatchMedia(mediaOptions)
    setNavigatorProperty('standalone', standalone)
    renderInstallButton()
    dispatchInstallCapability()

    expect(screen.queryByRole('button', { name: installName })).not.toBeInTheDocument()
  })

  it('explains the manual iOS Safari path instead of inventing a native prompt', async () => {
    setNavigatorProperty(
      'userAgent',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
    )
    setNavigatorProperty('platform', 'iPhone')
    setNavigatorProperty('maxTouchPoints', 5)
    const user = userEvent.setup()
    renderInstallButton()

    await user.click(screen.getByRole('button', { name: installName }))

    expect(
      screen.getByText(
        'In Safari, tap Share, then Add to Home Screen. Turn on Open as Web App, then tap Add.',
      ),
    ).toBeInTheDocument()
  })

  it('remains absent when the browser offers no install path', () => {
    renderInstallButton()

    expect(screen.queryByRole('button', { name: installName })).not.toBeInTheDocument()
  })

  it('preserves a captured capability while the routed content changes', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <InstallPromptProvider>
        <p>Public route</p>
      </InstallPromptProvider>,
    )
    const { prompt } = dispatchInstallCapability()

    rerender(
      <InstallPromptProvider>
        <p>Real shell</p>
        <InstallAppButton />
      </InstallPromptProvider>,
    )

    await user.click(screen.getByRole('button', { name: installName }))
    expect(prompt).toHaveBeenCalledTimes(1)
  })

  it('reveals its label once per session after three seconds, then compacts after five', () => {
    vi.useFakeTimers()
    const firstRender = renderInstallButton()
    dispatchInstallCapability()
    const button = screen.getByRole('button', { name: installName })
    expect(button).toHaveClass('w-[var(--size-control-phone)]')

    act(() => {
      vi.advanceTimersByTime(3_000)
    })
    expect(button).toHaveClass('w-[96px]')
    expect(sessionStorage.getItem('shawarmania-install-label-seen')).toBe('true')

    act(() => {
      vi.advanceTimersByTime(5_000)
    })
    expect(button).toHaveClass('w-[var(--size-control-phone)]')

    firstRender.unmount()
    renderInstallButton()
    dispatchInstallCapability()
    const secondButton = screen.getByRole('button', { name: installName })
    act(() => {
      vi.advanceTimersByTime(3_000)
    })
    expect(secondButton).toHaveClass('w-[var(--size-control-phone)]')
  })

  it('keeps the label stable when reduced motion is requested', () => {
    mockMatchMedia({ reducedMotion: true })
    renderInstallButton()
    dispatchInstallCapability()

    expect(screen.getByRole('button', { name: installName })).toHaveClass('w-[96px]')
  })
})
