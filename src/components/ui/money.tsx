import type { ComponentProps } from 'react'

import { formatPaise } from '@/domain'
import { cn } from '@/lib/cn'

type MoneyProps = Omit<ComponentProps<'span'>, 'children'> & {
  /** Integer paise. Passing a float throws — see src/domain/money.ts. */
  paise: number
  /** Large display treatment: a bill total, the cash difference at close. */
  display?: boolean
}

/**
 * The single way money reaches the screen. Never format inline, and never hand
 * a float to a component: columns of rupees that do not align are easy to
 * misread, and in a cash app that is a correctness problem rather than a
 * cosmetic one.
 */
export function Money({ paise, display = false, className, ...props }: MoneyProps) {
  return (
    <span data-numeric="" className={cn(display && 'font-display text-2xl', className)} {...props}>
      {formatPaise(paise)}
    </span>
  )
}
