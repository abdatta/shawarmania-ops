import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, SlidersHorizontal, VolumeX, WifiOff } from 'lucide-react'

import { useChangeGate } from '@/change-gates/context'
import { BuildVersion } from '@/components/build-version'
import { LoadingRegion, Shimmer } from '@/components/ui/loading'
import { useAdapters } from '@/data-access'
import type { KitchenCategory } from '@/data-access/adapters'
import { formatTime } from '@/domain'
import { cn } from '@/lib/cn'
import { useCounterDevice } from '@/session/counter-context'

import { DishKitchenCard } from './dish-kitchen-card'
import { KitchenFilterSheet } from './kitchen-filter-sheet'
import { SILENT, type TunePlayer } from './ringer'
import { audioBlocked, unlockAudio } from './tunes'
import { useDishKitchenBoard, type KitchenCardView } from './use-dish-kitchen-board'
import { useOffscreenCards, type Offscreen } from './use-offscreen-cards'
import { useWakeLock } from './use-wake-lock'
import { retainReadySlots, useKitchenReady } from './use-kitchen-ready'
import { useKitchenMasonry } from './use-kitchen-masonry'
import { kitchenFilterKey } from './kitchen-filter-key'

/**
 * The kitchen tablet's screen (each-dish-is-ticked-off, design D7, D9).
 *
 * The board is `kitchen_board_v2`: notes on lines, only the food still owed,
 * in free-flowing columns. Each card has Done beside its timer, a Done ticket
 * collapses to a gray receipt that stays until the counter hands its food
 * over, and Undo is there until then.
 *
 * As on the first kitchen screen (#70), the Filter button is labelled with the filter in force,
 * a pointer floats over the board while a card awaiting ACK is out of sight, and
 * two alerts cannot be dismissed: **out of sync** and **sound off**.
 */
export function DishKitchenBoardScreen({ player }: { player?: TunePlayer }) {
  const device = useCounterDevice()
  const { kitchen } = useAdapters()
  const { board, cards, stale, clock, read, acknowledge, silence } = useDishKitchenBoard({
    outletId: device.device.outletId,
    ...(player ? { player } : {}),
  })
  const [station, setStation] = useState(1)
  const [filterOpen, setFilterOpen] = useState(false)
  const [categories, setCategories] = useState<KitchenCategory[]>([])
  const [muted, setMuted] = useState(() => audioBlocked())
  useWakeLock()
  const fewerRequests = useChangeGate('fewer-requests')
  const filterKey = kitchenFilterKey(board?.filter)

  useEffect(() => {
    if (fewerRequests) return
    let active = true
    void kitchen
      .listCategories()
      .then((rows) => {
        if (active) setCategories(rows)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [kitchen, board?.filter.mode, board?.filter.categoryIds, fewerRequests])

  // With `fewer-requests` on, the names are read when the filter really changes,
  // not beside every board read: the ids arrive as a new array each time
  // (the-app-asks-the-server-less, D3).
  useEffect(() => {
    if (!fewerRequests || filterKey === null) return
    let active = true
    void kitchen
      .listCategories()
      .then((rows) => {
        if (active) setCategories(rows)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [kitchen, filterKey, fewerRequests])

  useEffect(() => {
    const timer = window.setInterval(() => setMuted(audioBlocked()), 2000)
    return () => window.clearInterval(timer)
  }, [])

  const filterSummary = useMemo(() => {
    if (!board) return ''
    const names = categories
      .filter((category) => category.isActive && board.filter.categoryIds.includes(category.id))
      .map((category) => category.name)
    if (board.filter.mode === 'include') {
      return names.length > 0 ? `Only ${names.join(', ')}` : 'Nothing chosen yet'
    }
    return names.length > 0 ? `Everything except ${names.join(', ')}` : 'Everything'
  }, [board, categories])

  const now = new Date(clock)

  // Cards arrive oldest first; the tablet's own setting may turn them round.
  const baseOrdered = useMemo(
    () => (board?.sort === 'newest_first' ? [...cards].reverse() : cards),
    [board?.sort, cards],
  )
  const ready = useKitchenReady(kitchen, read, baseOrdered)
  /*
    Hold a departing Done ticket in its original slot through the fade and gap.
    A Done or an Undo still saving is held too, until the board shows what it
    became: then the receipt (or ticket) it replaces goes in the same render
    the new card arrives, and the new card takes its column — never both on the
    board at once, with everything around them dealt again (owner, 2026-10-14).
  */
  const orderOf = (card: KitchenCardView) => card.order.sourceOrderId ?? card.order.id
  const held = new Map(
    [...ready.pending].filter(
      ([id, entry]) =>
        entry.phase !== 'saving' ||
        baseOrdered.some((card) => card.order.id === id) ||
        !baseOrdered.some((card) => orderOf(card) === orderOf(entry.card)),
    ),
  )
  const ordered = retainReadySlots(
    baseOrdered.filter(
      (card) => ![...ready.pending.values()].some((entry) => entry.id === card.order.readyId),
    ),
    held,
  )
  const grid = useRef<HTMLDivElement>(null)
  useKitchenMasonry(
    grid,
    `${Boolean(board)}:${ordered.map((card) => `${card.order.id}:${card.shake}`).join(',')}`,
  )
  const offscreen = useOffscreenCards(
    grid,
    ordered.map((card) => `${card.order.id}:${card.shake}`).join(','),
  )
  const waiting = ordered.filter(
    (card) =>
      !ready.pending.has(card.order.id) && card.state !== 'quiet' && offscreen[card.order.id],
  )

  return (
    <div
      className="flex min-h-dvh flex-col bg-canvas text-content"
      onPointerDown={() => {
        unlockAudio()
        window.setTimeout(() => setMuted(audioBlocked()), 300)
      }}
    >
      <header className="flex items-center justify-between gap-3 border-b border-border bg-surface px-4 py-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold">{device.device.label}</h1>
          {board && (
            <p data-testid="kitchen-operator" className="text-sm text-content-muted">
              {board.operatorName} · {formatTime(now)}
            </p>
          )}
        </div>
        {/* The filter in force is the button's own label: what it says is what
            a tap changes, rather than a summary in one corner and its control
            in the other (owner, 2026-10-09). */}
        <button
          type="button"
          onClick={() => setFilterOpen(true)}
          disabled={!board}
          aria-label={filterSummary ? `Filter: ${filterSummary}` : 'Filter'}
          className="inline-flex min-h-12 min-w-0 max-w-[60%] items-center gap-2 rounded-xl border-2 border-border px-4 font-bold text-content"
        >
          <SlidersHorizontal aria-hidden size={20} className="shrink-0" />
          <span data-testid="kitchen-filter-summary" className="truncate">
            {filterSummary || 'Filter'}
          </span>
        </button>
      </header>

      {kitchen.setDemoStation && (
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2">
          <label className="flex items-center gap-2 text-sm font-bold">
            Demo kitchen
            <select
              aria-label="Demo kitchen"
              value={station}
              onChange={(event) => {
                const next = Number(event.target.value)
                ready.reset()
                kitchen.setDemoStation?.(next)
                setStation(next)
                void read()
              }}
              className="min-h-11 rounded-lg border border-border bg-surface px-3 text-content"
            >
              <option value={1}>Kitchen 1 · Shawarma and sides</option>
              <option value={2}>Kitchen 2 · Main course</option>
            </select>
          </label>
          <span className="text-xs text-content-muted">
            Done tickets stay until counter handover. Expand a ticket to undo Done.
          </span>
        </div>
      )}
      {ready.error && (
        <p role="alert" className="px-4 py-2 font-bold text-danger">
          {ready.error}
        </p>
      )}
      <main className={cn('flex-1 p-4', stale && 'opacity-60')}>
        {!board ? (
          <LoadingRegion
            label="Loading the kitchen board"
            className="grid items-start grid-cols-[repeat(auto-fill,minmax(min(100%,22rem),1fr))] gap-4"
          >
            {[1, 2, 3, 4].map((key) => (
              <div key={key} className="space-y-4 rounded-2xl border border-border p-4">
                <div className="flex items-start justify-between gap-2">
                  <Shimmer className="h-12 w-24" />
                  <div className="flex items-center gap-2">
                    <Shimmer className="size-14 rounded-full" />
                    <Shimmer className="size-14 rounded-full" />
                  </div>
                </div>
                <Shimmer className="h-6 w-24" />
                <Shimmer className="h-14" />
                <Shimmer className="h-14" />
                <Shimmer className="h-15" />
              </div>
            ))}
          </LoadingRegion>
        ) : ordered.length === 0 ? (
          <p className="mt-16 text-center text-2xl text-content-muted">
            No orders for this kitchen right now.
          </p>
        ) : (
          <div ref={grid} data-testid="kitchen-masonry" className="relative">
            {ordered.map((card, position) => (
              <DishKitchenCard
                key={`${card.order.id}:${card.shake}`}
                order={card.order}
                state={card.state}
                shake={card.shake}
                rings={ready.pending.has(card.order.id) ? SILENT : card.rings}
                now={now}
                disabled={stale}
                {...(ready.pending.has(card.order.id)
                  ? { readyPhase: ready.pending.get(card.order.id)!.phase }
                  : {})}
                onReady={() => {
                  silence(card.order.id)
                  ready.toggle(
                    card,
                    position,
                    ordered.map((slot) => slot.order.id),
                  )
                }}
                onAcknowledge={() => void acknowledge(card.order)}
              />
            ))}
          </div>
        )}
      </main>
      <BuildVersion className="px-4 pb-3 text-center" />

      {(stale || muted || waiting.length > 0) && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex flex-col items-center gap-3 px-4">
          {waiting.length > 0 && <WaitingPointer waiting={waiting} offscreen={offscreen} />}
          {stale && (
            <div
              role="alert"
              data-testid="kitchen-sync-alert"
              className="pointer-events-auto flex max-w-xl items-center gap-3 rounded-2xl border-2 border-danger bg-surface px-5 py-4 text-lg font-semibold text-danger shadow-lg"
            >
              <WifiOff aria-hidden size={28} />
              Out of sync — this screen may be missing orders. Check the internet connection.
            </div>
          )}
          {muted && (
            <button
              type="button"
              data-testid="kitchen-sound-alert"
              onClick={() => {
                unlockAudio()
                window.setTimeout(() => setMuted(audioBlocked()), 300)
              }}
              className="pointer-events-auto flex max-w-xl items-center gap-3 rounded-2xl border-2 border-warning bg-warning px-5 py-4 text-lg font-semibold text-on-warning shadow-lg"
            >
              <VolumeX aria-hidden size={28} />
              Sound is off — tap anywhere to turn it on
            </button>
          )}
        </div>
      )}

      {board && filterOpen && (
        <KitchenFilterSheet
          open
          mode={board.filter.mode}
          categoryIds={board.filter.categoryIds}
          sort={board.sort}
          onClose={() => setFilterOpen(false)}
          onSaved={() => void read()}
        />
      )}
    </div>
  )
}

const URGENCY = { cancelled: 0, new: 1, edited: 2, quiet: 3 } as const
const WORD = { new: 'New', edited: 'Edited', cancelled: 'Cancelled', quiet: '' } as const
const FILL = {
  new: 'bg-primary text-on-primary',
  edited: 'bg-kitchen-edit text-on-kitchen-edit',
  cancelled: 'bg-kitchen-cancel text-on-kitchen-cancel',
  quiet: '',
} as const

/**
 * Points at tickets waiting for an ACK that are out of sight (#70). One names
 * itself — *↓ New #N*; several are counted. Either way it takes the colour
 * of the most urgent of them, cancel before new before edit, and a tap scrolls
 * to that one, oldest first among equals. The arrow says which way it is.
 */
function WaitingPointer({
  waiting,
  offscreen,
}: {
  waiting: readonly KitchenCardView[]
  offscreen: Record<string, Offscreen>
}) {
  const target = [...waiting].sort(
    (a, b) =>
      URGENCY[a.state] - URGENCY[b.state] ||
      Date.parse(a.order.orderedAt) - Date.parse(b.order.orderedAt),
  )[0]!
  const Arrow = offscreen[target.order.id] === 'above' ? ArrowUp : ArrowDown
  const label =
    waiting.length === 1
      ? `${WORD[target.state]} #${target.order.orderNumber}`
      : `${waiting.length} waiting for ACK`
  return (
    <button
      type="button"
      data-testid="kitchen-offscreen"
      onClick={() => {
        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        document
          .querySelector(`[data-order-id="${target.order.id}"]`)
          ?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' })
      }}
      className={cn(
        'pointer-events-auto flex min-h-14 items-center gap-2 rounded-full px-6 text-lg font-black shadow-lg',
        FILL[target.state],
      )}
    >
      <Arrow aria-hidden size={24} strokeWidth={3} />
      {label}
    </button>
  )
}
