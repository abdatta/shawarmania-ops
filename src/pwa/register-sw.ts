import { registerSW } from 'virtual:pwa-register'

/**
 * Service worker registration.
 *
 * A cached app shell means a bad deploy can persist on a counter tablet that
 * has never refreshed, so two behaviours here are non-optional:
 *
 *  1. Check for a new version on every launch.
 *  2. Activate a waiting worker immediately, but never reload the page — the
 *     new build takes effect on the *next* load.
 *
 * Point 2 is the deliberate trade. Reloading mid-shift could discard a
 * half-rung order in front of a customer; a build that lands one launch later
 * is the cheaper failure.
 */
export function registerServiceWorker(): void {
  const updateServiceWorker = registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      void registration?.update()
    },
    onNeedRefresh() {
      // `false` = skip waiting without reloading the page.
      void updateServiceWorker(false)
    },
  })
}
