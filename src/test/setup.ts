import { afterEach, vi } from 'vitest'

/*
 * Build-tooling suites (scripts/**) run in the node environment and share this
 * setup file. They have no DOM, so everything below is guarded rather than
 * split into a second vitest project — one suite list is easier to keep honest
 * than two.
 */
if (typeof window !== 'undefined') {
  await import('@testing-library/jest-dom/vitest')
  const { cleanup } = await import('@testing-library/react')

  afterEach(() => {
    cleanup()
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
  })

  // jsdom does not implement matchMedia, which the theme module reads.
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }),
    })
  }
}
