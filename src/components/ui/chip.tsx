import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { cn } from '@/lib/cn'

/**
 * A compact status pill: a fact about a row, in as few words as it takes.
 *
 * **Deliberately not `Badge`.** A badge means exactly one thing in this app —
 * *somebody is waiting on you* — and it owns the `--primary` / `--on-primary`
 * pair to say it. A chip states a condition nobody has to act on: what a count
 * came to, who took it, whether the recorder was on site. Reusing `Badge` for
 * that would dilute the one signal in the product that is meant to be
 * unmissable, so this uses its own tones and never `--primary`.
 *
 * **Why chips at all.** These surfaces started as paragraphs, and a drawer read
 * on a phone at 22:00 by somebody holding cash cannot be a wall of prose. Every
 * tone below is a pair the contrast validator already asserts in both themes:
 *
 * | tone | rendering | means |
 * |---|---|---|
 * | `neutral` | bordered, muted text | context: a time, a count of rows |
 * | `good` | `--success` text | it matched, it is on site, it is settled |
 * | `bad` | `--danger` text | short, missing, refused |
 * | `warn` | filled `--warning` / `--on-warning` | look at this before you act |
 *
 * `--warning` is a **fill** rather than a text colour, because
 * `--warning on --surface` is not a gated pair while `--on-warning on --warning`
 * is. A chip that passed AA in light and failed in dark would be exactly the
 * compromise `docs/DESIGN_SYSTEM.md` refuses.
 *
 * **Colour is never the only signal.** Every tone but `neutral` reads as a word
 * too — `short`, `matched`, `away` — so the chip works for a reader who cannot
 * tell the tones apart, and an icon is offered rather than required.
 */

export type ChipTone = 'neutral' | 'good' | 'bad' | 'warn'

const TONES: Record<ChipTone, string> = {
  neutral: 'border border-border bg-surface-raised text-content-muted',
  good: 'border border-border bg-surface-raised text-success',
  bad: 'border border-border bg-surface-raised text-danger',
  warn: 'bg-warning text-on-warning',
}

export function Chip({
  tone = 'neutral',
  icon: Icon,
  children,
  className,
  ...rest
}: {
  tone?: ChipTone
  icon?: LucideIcon
  children: ReactNode
  className?: string
} & { 'data-testid'?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5',
        'text-[0.6875rem] font-semibold leading-tight',
        TONES[tone],
        className,
      )}
      {...rest}
    >
      {Icon && <Icon aria-hidden size={11} className="shrink-0" />}
      {children}
    </span>
  )
}

/** A row of chips that wraps rather than truncating. Money must never be cut off. */
export function ChipRow({
  children,
  className,
  ...rest
}: {
  children: ReactNode
  className?: string
} & { 'data-testid'?: string }) {
  return (
    <span className={cn('flex flex-wrap items-center gap-1', className)} {...rest}>
      {children}
    </span>
  )
}
