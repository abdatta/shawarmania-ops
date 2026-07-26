import type { ComponentProps } from 'react'

import { cn } from '@/lib/cn'

/**
 * Font size is forced to 16px in the base layer rather than set here: below
 * 16px, iOS Safari zooms the viewport on focus, which is maddening on a
 * counter tablet.
 */
export function Input({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'h-[var(--size-control)] w-full rounded-lg border border-border bg-surface px-3',
        'text-content placeholder:text-content-muted focus-visible:focus-ring',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}
