import { useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

import { useChangeGate } from '@/change-gates/context'
import { useAdapters } from '@/data-access'
import type { KitchenMarks } from '@/data-access/adapters'
import { useRefreshQueue } from '@/lib/use-refresh-queue'
import { CounterDeviceContext } from '@/session/counter-context'

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
 *
 * **With the dish ticks on** (each-dish-is-ticked-off, design D8, R5) the read
 * is `counter_kitchen_marks_v2` — each kitchen's slot and each dish's ready
 * quantity — on the same triggers, and also on a return to the foreground or
 * the network, one read at a time with one trailing read kept. Never on a
 * timer: the first launch's five-second fallback here was one of the reads
 * behind the 12 October freeze.
 */
export function KitchenMarksProvider({ children }: { children: ReactNode }) {
  const dishWorkflow = useChangeGate('dish-ticks')
  return dishWorkflow ? (
    <DishKitchenMarksProvider>{children}</DishKitchenMarksProvider>
  ) : (
    <OldKitchenMarksProvider>{children}</OldKitchenMarksProvider>
  )
}

function OldKitchenMarksProvider({ children }: { children: ReactNode }) {
  const { kitchen } = useAdapters()
  const counterDevice = useContext(CounterDeviceContext)
  const { shift } = useCounterState()
  const [marks, setMarks] = useState<KitchenMarks | null>(null)
  const outletId = counterDevice?.device.outletId ?? null
  const onCounter = counterDevice !== null && shift !== null

  const refresh = useCallback(async () => {
    if (!onCounter) return setMarks(null)
    try {
      setMarks(await kitchen.readCounterMarks())
    } catch {
      // Keep what was last read.
    }
  }, [kitchen, onCounter])

  useEffect(() => {
    void Promise.resolve().then(refresh)
  }, [refresh])

  useEffect(() => {
    if (!outletId || !onCounter) return
    return kitchen.subscribe(outletId, () => void refresh())
  }, [kitchen, outletId, onCounter, refresh])

  const value = useMemo(() => ({ marks, refresh }), [marks, refresh])
  return <KitchenMarksContext.Provider value={value}>{children}</KitchenMarksContext.Provider>
}

function DishKitchenMarksProvider({ children }: { children: ReactNode }) {
  const { kitchen } = useAdapters()
  const counterDevice = useContext(CounterDeviceContext)
  const { shift } = useCounterState()
  const [marks, setMarks] = useState<KitchenMarks | null>(null)
  const outletId = counterDevice?.device.outletId ?? null
  const onCounter = counterDevice !== null && shift !== null
  const shiftId = shift?.id

  const read = useCallback(
    async (isCurrent: () => boolean) => {
      if (!onCounter || !outletId || !shiftId) return setMarks(null)
      try {
        const next = await kitchen.readDishMarks()
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
    const foreground = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    document.addEventListener('visibilitychange', foreground)
    window.addEventListener('online', foreground)
    return () => {
      unsubscribe()
      document.removeEventListener('visibilitychange', foreground)
      window.removeEventListener('online', foreground)
    }
  }, [kitchen, outletId, onCounter, refresh])

  const value = useMemo(() => ({ marks, refresh }), [marks, refresh])
  return <KitchenMarksContext.Provider value={value}>{children}</KitchenMarksContext.Provider>
}
