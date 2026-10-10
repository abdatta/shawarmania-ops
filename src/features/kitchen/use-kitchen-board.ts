import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useAdapters } from '@/data-access'
import type { KitchenBoard, KitchenOrder } from '@/data-access/adapters'
import {
  acknowledgementFor,
  KITCHEN_REREAD_MS,
  KITCHEN_STALE_AFTER_MS,
  kitchenCardState,
  kitchenAlertShouldRing,
  type KitchenCardState,
} from '@/domain'

import { createRinger, SILENT, type Ringer, type RingState, type TunePlayer } from './ringer'
import { createTunePlayer } from './tunes'

/**
 * The kitchen board, kept live (#70, design D5 and D9).
 *
 * Three triggers re-read it, and none is load-bearing alone: the outlet's pulse
 * (a nudge, never the data), a re-read every twenty seconds while the screen is
 * visible, and the return to the foreground. The screen is **stale** — and
 * says so — when the browser reports no network, the live channel is not
 * subscribed, or the last successful read is older than forty-five seconds.
 *
 * Alerts are decided here, by comparing each read with the one before: a card
 * that became new, edited or cancelled, or whose contents changed while it was
 * alerting, rings and shakes. **The first read rings nothing**: what is already
 * on the board when the screen opens glows silently.
 */

export interface KitchenCardView {
  order: KitchenOrder
  state: KitchenCardState
  /** Bumped each time this card starts alerting, so its shake can replay. */
  shake: number
  /** Its rings: the dots on its ACK count them down, and it shakes while they last. */
  rings: RingState
}

interface Seen {
  state: KitchenCardState
  version: string
  linesKey: string
}

function linesKey(order: KitchenOrder): string {
  return order.lines.map((line) => `${line.id}:${line.quantity}`).join(',')
}

export function useKitchenBoard(options: {
  outletId: string
  /** Injected in tests; the real tunes otherwise. */
  player?: TunePlayer
  now?: () => number
}) {
  const { kitchen } = useAdapters()
  const now = options.now ?? Date.now
  const [board, setBoard] = useState<KitchenBoard | null>(null)
  const [lastReadAt, setLastReadAt] = useState<number | null>(null)
  const [live, setLive] = useState(false)
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  )
  const [clock, setClock] = useState(() => now())
  const [shakes, setShakes] = useState<Record<string, number>>({})
  const [rings, setRings] = useState<Record<string, RingState>>({})
  const seen = useRef<Map<string, Seen> | null>(null)
  const previousBoardReadAt = useRef<string | null>(null)
  const ringer = useRef<Ringer | null>(null)
  const reading = useRef(false)
  const [mountedAt] = useState(() => now())
  const [failed, setFailed] = useState(false)

  // Made in an effect, not during render: StrictMode's mount-unmount-mount
  // would otherwise dispose the only ringer and leave the board silent.
  const player = options.player
  useEffect(() => {
    const current = createRinger(player ?? createTunePlayer())
    ringer.current = current
    const unsubscribe = current.subscribe(() => setRings(current.snapshot()))
    return () => {
      unsubscribe()
      current.dispose()
      ringer.current = null
    }
  }, [player])

  const absorb = useCallback((next: KitchenBoard) => {
    const previous = seen.current
    const current = new Map<string, Seen>()
    const raised: { key: string; kind: 'new' | 'edit' | 'cancel' }[] = []
    const silent = new Set<string>()
    const alerting = new Set<string>()
    for (const order of next.orders) {
      const state = kitchenCardState(order)
      const entry = { state, version: order.version, linesKey: linesKey(order) }
      current.set(order.id, entry)
      const kind = acknowledgementFor(state)
      if (!kind) continue
      alerting.add(order.id)
      const before = previous?.get(order.id)
      if (
        !before ||
        before.state !== state ||
        before.version !== entry.version ||
        before.linesKey !== entry.linesKey
      ) {
        if (
          kitchenAlertShouldRing(previousBoardReadAt.current, next.filterChangedAt, order.version)
        ) {
          raised.push({ key: order.id, kind })
        } else {
          silent.add(order.id)
          ringer.current?.settle(order.id)
        }
      }
    }
    seen.current = current
    previousBoardReadAt.current = next.readAt
    ringer.current?.keepOnly(alerting)
    if (raised.length > 0 || silent.size > 0) {
      ringer.current?.raiseAll(raised)
      setShakes((held) => {
        const copy = { ...held }
        for (const key of silent) copy[key] = 0
        for (const alert of raised) copy[alert.key] = (copy[alert.key] ?? 0) + 1
        return copy
      })
    }
    setBoard(next)
  }, [])

  const read = useCallback(async () => {
    if (reading.current) return
    reading.current = true
    try {
      const next = await kitchen.readBoard()
      absorb(next)
      setLastReadAt(now())
      setFailed(false)
    } catch {
      setFailed(true)
      // The staleness rule reports it; the last board stays on screen, dimmed.
    } finally {
      reading.current = false
    }
  }, [kitchen, absorb, now])

  useEffect(() => {
    const first = window.setTimeout(() => void read(), 0)
    const unsubscribe = kitchen.subscribe(options.outletId, () => void read(), setLive)
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void read()
    }, KITCHEN_REREAD_MS)
    const tick = window.setInterval(() => setClock(now()), 5000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void read()
    }
    const onOnline = () => {
      setOnline(true)
      void read()
    }
    const onOffline = () => setOnline(false)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.clearTimeout(first)
      unsubscribe()
      window.clearInterval(timer)
      window.clearInterval(tick)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [kitchen, options.outletId, read, now])

  // A channel takes a moment to subscribe; only its continued absence counts.
  const channelDown = !live && clock - mountedAt > 10_000
  const stale =
    !online ||
    failed ||
    channelDown ||
    (lastReadAt !== null && clock - lastReadAt > KITCHEN_STALE_AFTER_MS)

  const acknowledge = useCallback(
    async (order: KitchenOrder) => {
      const kind = acknowledgementFor(kitchenCardState(order))
      if (!kind) return
      ringer.current?.settle(order.id)
      try {
        await kitchen.acknowledge({
          id: crypto.randomUUID(),
          orderId: order.id,
          kind,
          orderVersion: order.version,
        })
      } finally {
        await read()
      }
    },
    [kitchen, read],
  )

  const cards = useMemo<KitchenCardView[]>(
    () =>
      (board?.orders ?? []).map((order) => ({
        order,
        state: kitchenCardState(order),
        shake: shakes[order.id] ?? 0,
        rings: rings[order.id] ?? SILENT,
      })),
    [board, shakes, rings],
  )

  return { board, cards, stale, online, live, lastReadAt, clock, read, acknowledge }
}
