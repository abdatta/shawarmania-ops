import type { ReactNode } from 'react'

import { cn } from '@/lib/cn'

/**
 * What a surface shows while it is waiting on a read.
 *
 * The rule it exists to keep is small and specific: **content arriving must not
 * shift what is already on screen**. A line of "Loading…" is one line tall and
 * a list of cards is not, so every read used to end with the controls above it
 * jumping. This occupies roughly the space the loaded thing will occupy, so the
 * arrival is a fill rather than a reflow.
 *
 * It is one shared component on purpose. Before this there was no loading
 * component anywhere in the repo and each screen wrote its own sentence, which
 * is how a surface ends up showing the previous outlet's rows under the new
 * outlet's name (attendance-one-day-per-person, design D8).
 *
 * **The design is a primitive plus a region, not a catalogue of variants.**
 * `Shimmer` is one animated block sized entirely by its caller; `LoadingRegion`
 * is the wrapper that owns the accessibility contract. A surface composes
 * `Shimmer` blocks inside a `LoadingRegion` **using the same container classes
 * its loaded content uses**, so the placeholder is that surface's own shape by
 * construction rather than an approximation of it. A fixed catalogue cannot
 * cover surfaces that genuinely differ, and an approximate shape reserves the
 * wrong height and reflows on arrival just as a sentence does
 * (shimmer-as-default-loading, design D1).
 *
 * The four shapes that actually recur — a stack of cards, a single strip, a
 * table, a card of label/value figures — are exported as named compositions so
 * the common cases stay short. Anything else composes the primitive directly.
 *
 * **The wait is announced, and never conveyed by motion alone.** The region is
 * `aria-busy` and carries a name saying what is loading, so a reader who cannot
 * see the shimmer is told the same thing; and under `prefers-reduced-motion` the
 * animation stops while the blocks stay, so the waiting state survives without
 * it. That guard is written here explicitly — Tailwind's `animate-pulse` does
 * not honour the preference by itself, contrary to what this file claimed
 * before shimmer-as-default-loading measured it.
 *
 * **This governs reads, not writes.** A control whose action is in flight keeps
 * showing that on the control itself — a disabled button reading "Saving…" — so
 * a placeholder never stands in front of the thing the reader just submitted.
 */

/** The one animated block. Every shape in the app is built from these. */
export function Shimmer({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        'rounded-xl border border-border bg-surface-raised',
        // Tailwind's `animate-pulse` is NOT gated by the preference on its own —
        // the utility compiles to a bare `animation` declaration — so the guard
        // is explicit. Only the animation stops: the blocks and the
        // announcement are what carry the wait, and they are untouched.
        'animate-pulse motion-reduce:animate-none',
        className,
      )}
    />
  )
}

/**
 * The wrapper that owns the semantics, written once so every placeholder in the
 * app carries the identical contract. `className` takes the caller's own layout
 * classes — the ones its loaded content uses — which is what makes composition
 * reproduce the page's shape.
 */
export function LoadingRegion({
  label,
  className,
  children,
  ...rest
}: {
  /** What is loading, as a phrase: "attendance for this day". Required. */
  label: string
  className?: string
  children: ReactNode
} & { 'data-testid'?: string }) {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className={className} {...rest}>
      <span className="sr-only">Loading {label}…</span>
      {children}
    </div>
  )
}

/**
 * A stack of cards. `blockHeight` exists because a stack of short figure cards
 * should not reserve the height of tall outlet cards — the default is the tall
 * card the attendance surfaces wait behind.
 */
export function LoadingList({
  label,
  rows = 3,
  blockHeight = 'h-24',
  className,
  ...rest
}: {
  label: string
  /** How many card-shaped blocks to reserve. Match the usual result count. */
  rows?: number
  /** The height of one block, as a Tailwind class. Match the card it stands in for. */
  blockHeight?: string
  className?: string
} & { 'data-testid'?: string }) {
  return (
    <LoadingRegion label={label} className={cn('space-y-3', className)} {...rest}>
      {Array.from({ length: rows }, (_, index) => (
        <Shimmer key={index} className={blockHeight} />
      ))}
    </LoadingRegion>
  )
}

/**
 * The same wait where what is loading is a strip rather than a list — a summary
 * row, a picker, a header figure.
 */
export function LoadingBlock({
  label,
  className,
  ...rest
}: {
  label: string
  className?: string
} & { 'data-testid'?: string }) {
  return (
    <LoadingRegion label={label} {...rest}>
      <Shimmer className={cn('h-16', className)} />
    </LoadingRegion>
  )
}

/**
 * The `DataTable` shape: N row strips, so a table waits behind rows rather than
 * behind card-height blocks.
 *
 * **There is deliberately no header strip.** The loaded table has a header row,
 * and reserving it was the literal-minded reading — but a short strip above a
 * stack of taller ones reads as a mistake rather than as a heading, and it
 * draws the eye to the one thing on screen that nobody should be looking at. A
 * placeholder is judged by whether it is unobtrusive, not by whether it maps
 * one-to-one onto the DOM it stands in for. An even rhythm wins; the header's
 * height is absorbed into the reservation.
 *
 * `rowHeight` defaults to the phone row density `DataTable` declares, which is
 * what a table of short cells actually renders. It is a prop rather than a
 * fixed token because the density is a *minimum*: on a narrow phone a table
 * with several wordy columns wraps well past it, and a placeholder built from
 * the token would reserve half the height that arrives. Measure the surface and
 * pass what its rows really take.
 */
export function LoadingTable({
  label,
  rows = 4,
  rowHeight = 'h-[var(--size-row-phone)]',
  className,
  ...rest
}: {
  label: string
  /** How many table rows to reserve. Match the usual result count. */
  rows?: number
  /** The height of one row, as a Tailwind class. Match what the rows render at. */
  rowHeight?: string
  className?: string
} & { 'data-testid'?: string }) {
  return (
    <LoadingRegion label={label} className={cn('space-y-1', className)} {...rest}>
      {Array.from({ length: rows }, (_, index) => (
        <Shimmer key={index} className={rowHeight} />
      ))}
    </LoadingRegion>
  )
}

/** The `Card` treatment, so a figures placeholder is that card's own silhouette. */
const FIGURES_CARD = 'rounded-xl border border-border bg-surface p-4 shadow-sm'

/**
 * Cards of label/value rows — the shape cash, P&L and reports all share.
 *
 * `rows` takes an array because none of those surfaces is one card: cash waits
 * behind its figures and the close-day form, P&L and reports behind three cards
 * each. One entry per card, its value being that card's row count, stacked the
 * way the loaded cards stack. A plain number is the single-card case.
 */
export function LoadingFigures({
  label,
  rows = 4,
  className,
  ...rest
}: {
  label: string
  /** Rows per card, the total row included. An array reserves a stack of cards. */
  rows?: number | number[]
  className?: string
} & { 'data-testid'?: string }) {
  const cards = typeof rows === 'number' ? [rows] : rows

  return (
    <LoadingRegion label={label} className={cn('space-y-3', className)} {...rest}>
      {cards.map((rowCount, card) => (
        <div key={card} className={FIGURES_CARD}>
          <div className="space-y-2">
            {Array.from({ length: rowCount }, (_, index) => (
              <Shimmer key={index} className="h-6" />
            ))}
          </div>
        </div>
      ))}
    </LoadingRegion>
  )
}
