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

  /**
   * The budget `waitFor` and every `findBy*` actually run on.
   *
   * `vite.config.ts` raised Vitest's own `testTimeout` to 20s for a stated
   * reason — jsdom per file, several files in parallel, `userEvent` typing one
   * key at a time — but that is the ceiling on a whole test. **Testing
   * Library keeps a separate one for a single wait, and it defaults to a
   * second**, which the outer number does nothing about.
   *
   * A second is plenty on an idle machine and not always enough on a loaded
   * one: a test that fills four fields and waits for the row to appear can
   * exceed it while the app is behaving perfectly. That produced intermittent
   * red across the suite, in different files each run — the worst kind,
   * because it teaches people to re-run rather than to look.
   *
   * Five seconds is a ceiling for a wait that is not going to resolve, not a
   * budget to spend, and it stays well under the 20s test timeout so a
   * genuinely stuck wait still fails inside its own test with its own message.
   */
  const { configure } = await import('@testing-library/react')
  configure({ asyncUtilTimeout: 5_000 })
  // Enrolled tablets keep their durable delivery subscriber mounted even on
  // the no-shift screen. jsdom therefore needs the browser storage boundary
  // whenever an app-route test resolves a counter session, not only in the
  // outbox unit suites that import this polyfill themselves.
  await import('fake-indexeddb/auto')
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

  /**
   * A unit test opens no sockets.
   *
   * Since counter-devices-and-offline a resolved session subscribes to a
   * Supabase Realtime channel, and jsdom has no WebSocket of its own — so Node's
   * undici one is used, whose events are not the `Event` jsdom's `dispatchEvent`
   * accepts. The mismatch surfaces as an uncaught `ERR_INVALID_ARG_TYPE` from
   * inside the socket, attributed to whichever test happened to be running.
   *
   * Stubbed rather than mocked per suite, for the same reason `showModal` and
   * `matchMedia` are: this is a gap in the environment, not a behaviour any test
   * is asserting. What the channel delivers is proved in the browser, by #9's
   * two-browser gate; what every surface does **without** it is what the unit
   * suites cover, and this stub is exactly that condition.
   */
  class SilentWebSocket {
    static readonly CONNECTING = 0
    static readonly OPEN = 1
    static readonly CLOSING = 2
    static readonly CLOSED = 3
    readonly readyState = SilentWebSocket.CLOSED
    close(): void {}
    send(): void {}
    addEventListener(): void {}
    removeEventListener(): void {}
    dispatchEvent(): boolean {
      return false
    }
  }
  Object.defineProperty(window, 'WebSocket', { writable: true, value: SilentWebSocket })
  Object.defineProperty(globalThis, 'WebSocket', { writable: true, value: SilentWebSocket })

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
