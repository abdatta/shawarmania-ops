import { useEffect, useMemo, useRef, useState } from 'react'

import type { BillingOrder, KitchenMarks } from '@/data-access/adapters'

import {
  createHandbellPlayer,
  createReadyRinger,
  unlockHandbell,
  type HandbellPlayer,
  type ReadyRinger,
} from './handbell'

const NOBODY: ReadonlySet<string> = new Set()

/**
 * The counter's handbell, driven by its own reads (each-dish-is-ticked-off,
 * design R6). Returns the orders whose bell is swinging.
 *
 * It listens to nothing but what the rail and the kitchen marks already read:
 * no timer, no request of its own. A tap anywhere on the counter unlocks the
 * sound, which every browser holds back until the page is touched. Nothing is
 * absorbed until both the rail and the marks have been read once, so a page
 * that loads with Ready food on it rings nothing.
 */
export function useReadyRinger(
  orders: readonly BillingOrder[] | null,
  marks: KitchenMarks | null,
  /** Injected in tests; the real handbell otherwise. */
  player?: HandbellPlayer,
): ReadonlySet<string> {
  const ringer = useRef<ReadyRinger | null>(null)
  const [swinging, setSwinging] = useState<ReadonlySet<string>>(NOBODY)

  // Made in an effect, not during render: StrictMode's mount-unmount-mount
  // would otherwise dispose the only ringer and leave the counter silent. A new
  // ringer has read nothing, so its first read rings nothing either.
  useEffect(() => {
    const current = createReadyRinger(player ?? createHandbellPlayer())
    const unsubscribe = current.subscribe(() => setSwinging(new Set(current.swinging())))
    ringer.current = current
    return () => {
      unsubscribe()
      current.dispose()
      ringer.current = null
      setSwinging(NOBODY)
    }
  }, [player])

  useEffect(() => {
    const unlock = () => unlockHandbell()
    window.addEventListener('pointerdown', unlock)
    return () => window.removeEventListener('pointerdown', unlock)
  }, [])

  /** Per order, each dish's food the kitchen marked Ready and the food the counter ticked. */
  const read = useMemo(() => {
    if (!orders || !marks) return null
    return Object.fromEntries(
      orders.map((order) => [
        order.id,
        Object.fromEntries(
          order.lines
            .filter((line) => line.kind !== 'packaging' && line.orderLineId)
            .map((line) => [
              line.orderLineId!,
              {
                ready:
                  marks.readyQuantities?.[order.id]?.[line.orderLineId!] ?? line.readyQuantity ?? 0,
                prepared: line.preparedQuantity ?? 0,
              },
            ]),
        ),
      ]),
    )
  }, [orders, marks])

  useEffect(() => {
    if (read) ringer.current?.absorb(read)
  }, [read])

  return swinging
}
