import { useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

import { useAdapters } from '@/data-access'
import type { KitchenMarks } from '@/data-access/adapters'
import { CounterDeviceContext } from '@/session/counter-context'
import { useRefreshQueue } from '@/lib/use-refresh-queue'

import { KitchenMarksContext } from './kitchen-marks-state'
import { useCounterState } from './use-counter-state'

/**
 * What the counter knows of its kitchens (#72), read once and shared by the two
 * places that show it: the bells on the rail's cards, and *Kitchen offline* in
 * the counter's header.
 *
 * Read on mount, whenever the rail reloads (an order write), and on the kitchen
 * pulse — which a kitchen's ACK, a kitchen's filter change and a kitchen shift
 * starting or ending all bump. Only on a counter tablet with a live shift: the
 * read needs one, and nothing else draws a bell. A failed read keeps the last
 * answers — a bell is a reminder, not a fact the counter acts on.
 */

export function KitchenMarksProvider({ children }: { children: ReactNode }) {
  const { kitchen } = useAdapters()
  const counterDevice = useContext(CounterDeviceContext)
  const { shift } = useCounterState()
  const [marks, setMarks] = useState<KitchenMarks | null>(null)
  const outletId = counterDevice?.device.outletId ?? null
  const onCounter = counterDevice != null && shift !== null
  const shiftId = shift?.id

  const read = useCallback(
    async (isCurrent: () => boolean) => {
      if (!onCounter || !outletId || !shiftId) return setMarks(null)
      try {
        const next = await kitchen.readCounterMarks()
        if (isCurrent()) setMarks(next)
      } catch {
        // Keep what was last read.
      }
    },
    [kitchen, onCounter, outletId, shiftId],
  )
  const { refresh } = useRefreshQueue(read)

  useEffect(() => {
    void Promise.resolve().then(refresh)
  }, [refresh])

  useEffect(() => {
    if (!outletId || !onCounter) return
    const unsubscribe = kitchen.subscribe(outletId, () => void refresh())
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, 5000)
    const foreground = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    document.addEventListener('visibilitychange', foreground)
    window.addEventListener('online', foreground)
    return () => {
      unsubscribe()
      clearInterval(timer)
      document.removeEventListener('visibilitychange', foreground)
      window.removeEventListener('online', foreground)
    }
  }, [kitchen, outletId, onCounter, refresh])

  const value = useMemo(() => ({ marks, refresh }), [marks, refresh])
  return <KitchenMarksContext.Provider value={value}>{children}</KitchenMarksContext.Provider>
}
