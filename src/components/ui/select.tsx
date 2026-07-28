import type { ComponentProps } from 'react'

import { cn } from '@/lib/cn'

/**
 * A native `<select>`, themed to match `Input`.
 *
 * Native rather than a custom listbox on purpose: the platform control is the
 * one every phone renders as a full-height wheel, which is faster and more
 * reliable one-handed than anything drawn in the page — and it needs no focus
 * management, no keyboard handling and no dependency.
 *
 * Font size comes from the base layer's 16px input floor, so a manager's phone
 * never zooms the viewport when this takes focus.
 */
export function Select({ className, ...props }: ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'h-[var(--size-control)] w-full rounded-lg border border-border bg-surface px-3',
        'text-content focus-visible:focus-ring',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}
