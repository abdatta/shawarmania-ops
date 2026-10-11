import { useEffect, useState } from 'react'
import { businessDayEnd, resolveBusinessDate } from '@/domain/datetime'

/** Presentation clock; changing it never invalidates a loaded analytics snapshot. */
export function useAnalyticsClock(cutover: string | null) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const refresh = () => setNow(Date.now())
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', onVisible)
    // Minute-aligned ticks include every hour boundary; cutovers can include seconds.
    const minute = 60_000 - (now % 60_000)
    const cutoff = cutover
      ? Date.parse(businessDayEnd(resolveBusinessDate(new Date(now), cutover), cutover)) - now
      : minute
    const timer = window.setTimeout(refresh, Math.max(1, Math.min(minute, cutoff)))
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [now, cutover])
  return now
}
