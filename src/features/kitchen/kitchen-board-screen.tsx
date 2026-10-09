import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, SlidersHorizontal, VolumeX, WifiOff } from 'lucide-react'

import { LoadingList } from '@/components/ui/loading'
import { useAdapters } from '@/data-access'
import type { KitchenCategory } from '@/data-access/adapters'
import { formatTime } from '@/domain'
import { cn } from '@/lib/cn'
import { useCounterDevice } from '@/session/counter-context'

import { KitchenCard } from './kitchen-card'
import { KitchenFilterSheet } from './kitchen-filter-sheet'
import type { TunePlayer } from './ringer'
import { audioBlocked, unlockAudio } from './tunes'
import { useKitchenBoard, type KitchenCardView } from './use-kitchen-board'
import { useOffscreenCards, type Offscreen } from './use-offscreen-cards'
import { useWakeLock } from './use-wake-lock'

/**
 * The kitchen tablet's whole screen once a kitchen shift is open (#70).
 *
 * The counter rail's unfinished orders, oldest first unless the tablet is set
 * to newest first, in columns a cook reads from the stove. The Filter button is
 * labelled with the filter in force, so an empty board is never mistaken for a
 * quiet kitchen, and a pointer floats over the board while a card awaiting ACK
 * is out of sight. Two floating alerts can cover
 * the cards and cannot be dismissed: **out of sync** while the board may be out
 * of date, and **sound off** while the browser is holding the rings back.
 */
export function KitchenBoardScreen({ player }: { player?: TunePlayer }) {
  const device = useCounterDevice()
  const { kitchen } = useAdapters()
  const { board, cards, stale, clock, read, acknowledge } = useKitchenBoard({
    outletId: device.device.outletId,
    ...(player ? { player } : {}),
  })
  const [filterOpen, setFilterOpen] = useState(false)
  const [categories, setCategories] = useState<KitchenCategory[]>([])
  const [muted, setMuted] = useState(() => audioBlocked())
  useWakeLock()

  useEffect(() => {
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
  }, [kitchen, board?.filter.mode, board?.filter.categoryIds])

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
  const ordered = useMemo(
    () => (board?.sort === 'newest_first' ? [...cards].reverse() : cards),
    [board?.sort, cards],
  )
  const grid = useRef<HTMLDivElement>(null)
  const offscreen = useOffscreenCards(
    grid,
    ordered.map((card) => `${card.order.id}:${card.shake}`).join(','),
  )
  const waiting = ordered.filter((card) => card.state !== 'quiet' && offscreen[card.order.id])

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

      <main className={cn('flex-1 p-4', stale && 'opacity-60')}>
        {!board ? (
          <LoadingList label="Loading the kitchen board" rows={4} blockHeight="h-48" />
        ) : cards.length === 0 ? (
          <p className="mt-16 text-center text-2xl text-content-muted">
            No orders for this kitchen right now.
          </p>
        ) : (
          <div ref={grid} className="grid grid-cols-[repeat(auto-fill,minmax(22rem,1fr))] gap-4">
            {ordered.map((card) => (
              <KitchenCard
                key={`${card.order.id}:${card.shake}`}
                order={card.order}
                state={card.state}
                shake={card.shake}
                rings={card.rings}
                now={now}
                disabled={stale}
                onAcknowledge={() => void acknowledge(card.order)}
              />
            ))}
          </div>
        )}
      </main>

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
