import { useCallback, useEffect, useRef, useState } from 'react'

import { messageOf } from './words'

/**
 * How often an open page asks again while something is going out.
 *
 * The sender reports once a minute (design D6), so a page that asked faster
 * would only re-read the same rows. There is no subscription: an owner watching
 * a batch is a page open for an hour or two, a few times a month.
 */
const WATCH_EVERY_MS = 60_000

export interface CampaignRead<T> {
  /** Null until the first read lands. */
  value: T | null
  /** The first read has landed, for a read whose own answer may be null. */
  settled: boolean
  error: string | null
  /** Ask again now, after the page changed something. */
  reload: () => void
  /** Put a write's own answer on the page without waiting for a read. */
  replace: (value: T) => void
}

/**
 * One read of the campaign rows, kept fresh.
 *
 * Asked when the page opens, when the phone comes back to the tab, and once a
 * minute while `watch` says something is going out and the page is in view. It
 * is how both owners see the same progress (spec, *The app says truthfully
 * where the sender is*).
 *
 * `key` names what is being read. A read that lands after the key moved on is
 * dropped, and until the new key's first read lands the value is null, so one
 * campaign's rows are never shown under another's name.
 */
export function useCampaignRead<T>(
  key: string,
  read: () => Promise<T>,
  watch: (value: T) => boolean,
  failure: string,
): CampaignRead<T> {
  const [held, setHeld] = useState<{ key: string; value: T } | null>(null)
  const [error, setError] = useState<{ key: string; message: string } | null>(null)
  const [asks, setAsks] = useState(0)
  // The newest `read`, for an effect that runs on the key and not on every render.
  const readRef = useRef(read)
  useEffect(() => {
    readRef.current = read
  })

  useEffect(() => {
    let active = true
    readRef
      .current()
      .then((value) => {
        if (!active) return
        setHeld({ key, value })
        setError(null)
      })
      .catch((cause: unknown) => {
        if (active) setError({ key, message: messageOf(cause, failure) })
      })
    return () => {
      active = false
    }
    // `asks` is the point of this dependency: each bump is one more read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, asks])

  const value = held?.key === key ? held.value : null
  const watching = value !== null && watch(value)

  useEffect(() => {
    const ask = () => {
      if (document.visibilityState === 'visible') setAsks((n) => n + 1)
    }
    document.addEventListener('visibilitychange', ask)
    const timer = watching ? window.setInterval(ask, WATCH_EVERY_MS) : null
    return () => {
      document.removeEventListener('visibilitychange', ask)
      if (timer !== null) window.clearInterval(timer)
    }
  }, [watching])

  const reload = useCallback(() => setAsks((n) => n + 1), [])
  const replace = useCallback((next: T) => setHeld({ key, value: next }), [key])

  return {
    value,
    settled: held?.key === key,
    error: error?.key === key ? error.message : null,
    reload,
    replace,
  }
}
