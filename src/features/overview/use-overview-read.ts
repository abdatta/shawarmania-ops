import { useCallback, useEffect, useState } from 'react'
import { useOnForeground } from '@/features/attention/attention'

/** Each reader owns its arrival and failure; old requests cannot fill a new scope. */
export function useOverviewRead<T>(read: () => Promise<T>) {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<{ read: typeof read; value?: T; error?: boolean }>()
  const retry = useCallback(() => setAttempt((value) => value + 1), [])
  useOnForeground(retry)
  useEffect(() => {
    let active = true
    void read().then(
      (value) => {
        if (active) setState({ read, value })
      },
      () => {
        if (active) setState({ read, error: true })
      },
    )
    return () => {
      active = false
    }
  }, [read, attempt])
  return {
    value: state?.read === read ? state.value : undefined,
    error: Boolean(state?.read === read && state.error),
    retry,
  }
}
