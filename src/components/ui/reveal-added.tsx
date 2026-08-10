import { useEffect, useRef, type HTMLAttributes } from 'react'

import { cn } from '@/lib/cn'

const HIGHLIGHT = ['rounded-lg', 'bg-surface-raised', 'ring-2', 'ring-primary']

/** Scrolls new work into view; decorative highlighting respects reduced motion. */
export function RevealAdded({
  as = 'div',
  active,
  className,
  ...props
}: {
  as?: 'div' | 'li'
  active: boolean
} & HTMLAttributes<HTMLElement>) {
  const divRef = useRef<HTMLDivElement>(null)
  const liRef = useRef<HTMLLIElement>(null)

  useEffect(() => {
    const node = as === 'li' ? liRef.current : divRef.current
    if (!active || !node) return
    node.scrollIntoView?.({ block: 'nearest' })
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    node.classList.add(...HIGHLIGHT)
    const timer = window.setTimeout(() => node.classList.remove(...HIGHLIGHT), 1800)
    return () => {
      window.clearTimeout(timer)
      node.classList.remove(...HIGHLIGHT)
    }
  }, [active, as])

  if (as === 'li') return <li {...props} ref={liRef} className={cn(className)} />
  return <div {...props} ref={divRef} className={cn(className)} />
}
