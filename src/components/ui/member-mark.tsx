import { Star } from 'lucide-react'

import { cn } from '@/lib/cn'

/**
 * The gold member's mark: a star, and nothing else (a-gold-member-is-a-label).
 *
 * **An icon, not the ⭐ emoji.** An emoji is drawn by whatever font the device
 * carries, so the counter tablet and the owner's phone would show two different
 * stars, and neither would follow the theme.
 *
 * It says "Gold member" to a screen reader and adds **no text** to the row it
 * sits in, so a name beside it reads exactly as it did before membership
 * existed. Never accompanied by a date, an actor or a figure — the counter is
 * told the state and nothing it could use to reason about a customer's trade.
 */
export function MemberMark({ className }: { className?: string }) {
  return (
    <span
      role="img"
      aria-label="Gold member"
      title="Gold member"
      data-testid="member-mark"
      className={cn('inline-flex shrink-0 items-center', className)}
    >
      <Star
        aria-hidden
        className="size-4 fill-member-fill text-member"
        strokeWidth={2}
        absoluteStrokeWidth
      />
    </span>
  )
}
