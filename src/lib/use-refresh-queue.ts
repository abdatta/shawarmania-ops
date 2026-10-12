import { useEffect, useMemo } from 'react'

/** One read at a time, with one trailing read for changes received in flight. */
function createRefreshQueue(read: (isCurrent: () => boolean) => Promise<void>) {
  let running = false
  let pending: { resolve: () => void; reject: (cause: unknown) => void }[] = []
  let generation = 0
  return {
    invalidate() {
      generation++
      for (const waiter of pending) waiter.resolve()
      pending = []
    },
    refresh(): Promise<void> {
      const result = new Promise<void>((resolve, reject) => {
        pending.push({ resolve, reject })
      })
      if (!running) {
        running = true
        void Promise.resolve().then(async () => {
          while (pending.length) {
            const waiters = pending
            pending = []
            const token = generation
            try {
              await read(() => token === generation)
              for (const waiter of waiters) waiter.resolve()
            } catch (cause) {
              for (const waiter of waiters) waiter.reject(cause)
            }
          }
          running = false
        })
      }
      return result
    },
  }
}

export function useRefreshQueue(read: (isCurrent: () => boolean) => Promise<void>) {
  const queue = useMemo(() => createRefreshQueue(read), [read])
  useEffect(() => () => queue.invalidate(), [queue])
  return queue
}
