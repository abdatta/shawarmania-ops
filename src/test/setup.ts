import { afterEach, vi } from 'vitest'

/**
 * Client configuration, pinned for the suite.
 *
 * **A unit test must not depend on whether the person running it has a `.env`.**
 * `getSupabaseClient()` throws when the pair is missing, so a component whose
 * tree resolves a real session passed on every developer machine and failed in
 * CI — where there is no `.env` — which is the worst place to find out and the
 * one place nobody watches until it is already red.
 *
 * The values are the Supabase CLI's well-known local demo pair: public by
 * design, identical in every local stack, and unreachable from a jsdom test
 * regardless. Nothing here weakens the demo tripwire, which throws *before* the
 * env check and for a different reason.
 */
vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:54321')
vi.stubEnv(
  'VITE_SUPABASE_ANON_KEY',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0',
)

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

  // jsdom does not implement the <dialog> top-layer methods the Modal base
  // uses. The polyfill mirrors just enough: open flag plus the close event.
  if (typeof HTMLDialogElement.prototype.showModal !== 'function') {
    HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
      this.open = true
    }
    HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
      this.open = false
      this.dispatchEvent(new Event('close'))
    }
  }

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
