import { useEffect, useState } from 'react'

/**
 * Whether the device asks for reduced motion, tracked live.
 *
 * Shared by the header's two app actions, which both animate a label in and
 * out and both have to stop doing so on request. Read live rather than once,
 * because the setting can be changed while the app is open and an accessibility
 * preference that needs a relaunch to take effect is not much of one.
 */
export function usePrefersReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const handleChange = (event: MediaQueryListEvent) => setPrefersReducedMotion(event.matches)

    query.addEventListener('change', handleChange)
    return () => query.removeEventListener('change', handleChange)
  }, [])

  return prefersReducedMotion
}
