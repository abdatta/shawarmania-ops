import { useEffect, useMemo } from 'react'

/** One read at a time, with one trailing read for changes received in flight. */
function createRefreshQueue(read: (isCurrent: () => boolean) => Promise<void>) {
  let flight: Promise<void> | null = null
  let requested = false
  let generation = 0
  return {
    invalidate() {
      generation++
      requested = false
    },
    refresh(): Promise<void> {
      requested = true
      if (!flight) {
        flight = Promise.resolve()
          .then(async () => {
            while (requested) {
              requested = false
              const token = generation
              await read(() => token === generation)
            }
          })
          .finally(() => {
            flight = null
          })
      }
      return flight
    },
  }
}

export function useRefreshQueue(read: (isCurrent: () => boolean) => Promise<void>) {
  const queue = useMemo(() => createRefreshQueue(read), [read])
  useEffect(() => () => queue.invalidate(), [queue])
  return queue
}
