import { Info } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'

import { cn } from '@/lib/cn'

/**
 * The reasoning behind a figure, one tap away instead of always on screen.
 *
 * **The problem this solves.** These surfaces have a lot to explain — why a
 * broken opening chain is reported rather than repaired, why a spend stays out of
 * the month, why verifying freezes nothing. Every one of those sentences is worth
 * keeping and none of them is worth reading twice. Rendered inline they turned
 * the drawer into a page of warning-coloured paragraphs, which is how a reader
 * learns to skip the paragraph that matters.
 *
 * So the *fact* stays visible as a chip and the *reason* moves behind this.
 *
 * **What must NOT go behind it.** Anything the reader has to see before acting:
 * the difference on a count, and the alert that a minus means money going in.
 * Those are not explanations, they are the content — and hiding a safety warning
 * behind a tap is worse than a wall of text, because a wall of text can at least
 * be read by accident.
 *
 * Accessible by construction: a real `<button>` carrying `aria-expanded` and
 * `aria-controls`, with an accessible name that says what will be explained
 * rather than "more info". The panel is unmounted while closed, so a reader
 * using find-in-page is not led to text that is not on screen.
 */
export function Why({
  label,
  children,
  className,
  ...rest
}: {
  /** What this explains, as a phrase: "why this is not repaired". */
  label: string
  children: ReactNode
  className?: string
} & { 'data-testid'?: string }) {
  const [open, setOpen] = useState(false)
  const panelId = useId()

  return (
    <span className={cn('inline-flex flex-col items-start gap-1', className)} {...rest}>
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        aria-expanded={open}
        aria-controls={panelId}
        className={cn(
          'inline-flex size-5 items-center justify-center rounded-full',
          'text-content-muted hover:bg-surface-raised focus-visible:focus-ring',
        )}
      >
        <Info aria-hidden size={13} />
        <span className="sr-only">{label}</span>
      </button>
      {open && (
        <span id={panelId} className="block text-xs text-content-muted">
          {children}
        </span>
      )}
    </span>
  )
}
