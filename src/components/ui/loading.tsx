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
 * **The wait is announced, and never conveyed by motion alone.** The region is
 * `aria-busy` and carries a name saying what is loading, so a reader who cannot
 * see the shimmer is told the same thing; and under `prefers-reduced-motion` the
 * animation stops while the blocks stay, so the waiting state survives without
 * it. `animate-pulse` is Tailwind's, which already respects that preference.
 */

/** Roughly one card's height, so a list of them reserves a list's worth. */
const BLOCK = 'rounded-xl border border-border bg-surface-raised'

export function LoadingList({
  label,
  rows = 3,
  className,
  ...rest
}: {
  /** What is loading, as a phrase: "attendance for this day". Required. */
  label: string
  /** How many card-shaped blocks to reserve. Match the usual result count. */
  rows?: number
  className?: string
} & { 'data-testid'?: string }) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      className={cn('space-y-3', className)}
      {...rest}
    >
      <span className="sr-only">Loading {label}…</span>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} aria-hidden className={cn(BLOCK, 'h-24 animate-pulse')} />
      ))}
    </div>
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
    <div role="status" aria-busy="true" aria-live="polite" {...rest}>
      <span className="sr-only">Loading {label}…</span>
      <div aria-hidden className={cn(BLOCK, 'h-16 animate-pulse', className)} />
    </div>
  )
}
