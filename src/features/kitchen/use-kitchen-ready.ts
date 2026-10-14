import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { KitchenAdapter } from '@/data-access/adapters'
import type { KitchenCardView } from './use-kitchen-board'

export const KITCHEN_READY_EXIT_MS = 320
export const KITCHEN_READY_GAP_MS = 180
export type ReadyPhase = 'saving' | 'leaving' | 'gap'
interface PendingReady {
  id: string
  card: KitchenCardView
  phase: ReadyPhase
  position: number
  slotOrder: readonly string[]
}

/** A refreshed board must not move a disappearing ticket into its last slot. */
export function retainReadySlots(
  cards: KitchenCardView[],
  pending: ReadonlyMap<string, PendingReady>,
) {
  const ordered = cards.map((card) => pending.get(card.order.id)?.card ?? card)
  for (const held of [...pending.values()].sort((a, b) => a.position - b.position)) {
    if (!ordered.some((card) => card.order.id === held.card.order.id)) {
      const preceding = held.slotOrder
        .slice(0, held.position)
        .reverse()
        .map((id) => ordered.findIndex((card) => card.order.id === id))
        .find((index) => index >= 0)
      const following = held.slotOrder
        .slice(held.position + 1)
        .map((id) => ordered.findIndex((card) => card.order.id === id))
        .find((index) => index >= 0)
      const position =
        preceding !== undefined
          ? preceding + 1
          : (following ?? Math.min(held.position, ordered.length))
      ordered.splice(position, 0, held.card)
    }
  }
  return ordered
}

/** Ready persists on the board; only counter handover starts the departure. */
export function useKitchenReady(
  kitchen: KitchenAdapter,
  read: () => Promise<void>,
  cards: readonly KitchenCardView[],
) {
  const [pending, setPending] = useState(new Map<string, PendingReady>())
  const [error, setError] = useState<string | null>(null)
  const current = useRef(pending)
  const previous = useRef<readonly KitchenCardView[]>([])
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())
  const generation = useRef(0)
  const publish = (next: Map<string, PendingReady>) => {
    current.current = next
    setPending(next)
  }
  const remove = (orderId: string) => {
    const next = new Map(current.current)
    next.delete(orderId)
    publish(next)
  }

  useLayoutEffect(() => {
    const before = previous.current
    previous.current = cards
    const departing = before.filter(
      (card) =>
        card.order.readyId &&
        !cards.some((next) => next.order.id === card.order.id) &&
        !current.current.has(card.order.id),
    )
    const returned = cards.filter((card) => {
      const phase = current.current.get(card.order.id)?.phase
      return phase === 'leaving' || phase === 'gap'
    })
    if (!departing.length && !returned.length) return
    const next = new Map(current.current)
    for (const card of returned) next.delete(card.order.id)
    for (const card of departing) {
      const id = card.order.id
      const held: PendingReady = {
        id: crypto.randomUUID(),
        card,
        phase: 'leaving',
        position: before.indexOf(card),
        slotOrder: before.map((slot) => slot.order.id),
      }
      next.set(id, held)
      const exit = setTimeout(() => {
        timers.current.delete(exit)
        if (current.current.get(id)?.id !== held.id || current.current.get(id)?.phase !== 'leaving')
          return
        publish(new Map(current.current).set(id, { ...held, phase: 'gap' }))
        const gap = setTimeout(() => {
          timers.current.delete(gap)
          if (current.current.get(id)?.id === held.id && current.current.get(id)?.phase === 'gap')
            remove(id)
        }, KITCHEN_READY_GAP_MS)
        timers.current.add(gap)
      }, KITCHEN_READY_EXIT_MS)
      timers.current.add(exit)
    }
    publish(next)
    // These helpers read the current ref; only a new board starts a departure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards])

  useEffect(() => {
    const heldTimers = timers.current
    const heldGeneration = generation
    return () => {
      heldGeneration.current++
      for (const timer of heldTimers) clearTimeout(timer)
      heldTimers.clear()
      current.current = new Map()
    }
  }, [])

  const toggle = (card: KitchenCardView, position = 0, slotOrder: readonly string[] = []) => {
    const orderId = card.order.id
    if (current.current.has(orderId)) return
    const undo = card.order.readyId
    if (undo ? !kitchen.undoReady : !kitchen.ready) return
    setError(null)
    const token = generation.current
    const entry: PendingReady = {
      id: crypto.randomUUID(),
      card,
      phase: 'saving',
      position,
      slotOrder,
    }
    publish(new Map(current.current).set(orderId, entry))
    const write = undo
      ? kitchen.undoReady!(entry.id, undo)
      : kitchen.ready!({
          id: entry.id,
          orderId: card.order.sourceOrderId ?? orderId,
          lines: card.order.lines.map((line) => ({ id: line.id, quantity: line.quantity })),
        })
    void write
      .then(() => read())
      .then(() => {
        if (generation.current === token) remove(orderId)
      })
      .catch((failure: unknown) => {
        if (generation.current !== token) return
        remove(orderId)
        setError(failure instanceof Error ? failure.message : 'Could not update Done.')
      })
  }

  const reset = () => {
    generation.current++
    previous.current = []
    for (const timer of timers.current) clearTimeout(timer)
    timers.current.clear()
    publish(new Map())
    setError(null)
  }
  return { pending, error, toggle, reset }
}
