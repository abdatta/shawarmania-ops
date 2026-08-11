import { registerSW } from 'virtual:pwa-register'

import { startApplyLoop } from './apply-update'
import { watchTypedWork } from './occupancy'
import { recordUpdateReady } from './update-store'
import { startUpdateWatch } from './update-watch'

/**
 * Service worker registration.
 *
 * A cached app shell means a bad deploy can persist on a counter tablet that
 * has never refreshed, so a new build has to reach an open device without
 * waiting for somebody to relaunch it — and it has to arrive without throwing
 * away what is on screen when it does.
 *
 * **`onNeedReload` is the whole point of this file.** vite-plugin-pwa reloads
 * the page itself unless that callback is supplied: its `waiting` handler arms
 * a `controlling` listener whose body is `window.location.reload()`, and only
 * an `onNeedReload` diverts it. This file previously passed `false` to
 * `updateServiceWorker` believing that meant "skip waiting without reloading";
 * the shipped signature is `(_reloadPage = true)` and the argument has never
 * been read, so sending skip-waiting was itself what triggered the reload we
 * meant to prevent. It survived only because the single check ran at launch,
 * putting the reload a second or two after open, usually before anyone typed.
 *
 * Skip-waiting is still sent immediately, so the next load runs the new build
 * whatever else happens. That is deliberate: a waiting worker does not activate
 * across an ordinary reload, so deferring it would make closing and reopening
 * the app an unreliable way to force a new build, which is the one manual
 * override there is (design D1).
 */
export function registerServiceWorker(): () => void {
  let stopWatching: (() => void) | undefined

  const updateServiceWorker = registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return

      const check = () => {
        // Rejects while offline, and that is not a fault: the next trigger,
        // very likely `online`, will ask again.
        void registration.update().catch(() => undefined)
      }

      check()
      stopWatching = startUpdateWatch(check)
    },
    onNeedRefresh() {
      // Activate the waiting worker. The page is not reloaded by this; the
      // reload that used to follow it is intercepted below.
      void updateServiceWorker()
    },
    onNeedReload() {
      // Where the forced reload used to happen. Recording it is the entire
      // body: `apply-update.ts` decides when, and the header offers it in the
      // meantime.
      recordUpdateReady()
    },
  })

  const stopTypingWatch = watchTypedWork()
  const stopApplyLoop = startApplyLoop()

  return () => {
    stopWatching?.()
    stopTypingWatch()
    stopApplyLoop()
  }
}
