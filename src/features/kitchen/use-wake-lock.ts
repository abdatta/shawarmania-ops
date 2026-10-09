import { useEffect } from 'react'

/**
 * Keep the kitchen's display awake while it is visible (#70).
 *
 * A screen that dims mid-rush takes its live connection with it on many
 * tablets. The Screen Wake Lock is released by the browser whenever the page
 * is hidden, so it is taken again on every return to the foreground. Where the
 * API is missing, nothing happens and the tablet's own display settings must
 * keep it on (docs/OPERATIONS.md).
 */
export function useWakeLock(): void {
  useEffect(() => {
    type Sentinel = { release(): Promise<void> }
    const nav = navigator as Navigator & {
      wakeLock?: { request(type: 'screen'): Promise<Sentinel> }
    }
    if (!nav.wakeLock) return
    let sentinel: Sentinel | null = null
    let active = true

    const take = () => {
      if (document.visibilityState !== 'visible') return
      void nav
        .wakeLock!.request('screen')
        .then((held) => {
          if (active) sentinel = held
          else void held.release()
        })
        .catch(() => undefined)
    }

    take()
    document.addEventListener('visibilitychange', take)
    return () => {
      active = false
      document.removeEventListener('visibilitychange', take)
      void sentinel?.release().catch(() => undefined)
    }
  }, [])
}
