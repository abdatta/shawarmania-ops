import { RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/cn'
import { usePrefersReducedMotion } from '@/lib/use-prefers-reduced-motion'
import { requestUpdateNow } from '@/pwa/apply-update'
import { useAppUpdate } from '@/pwa/use-app-update'

/** Long enough to read, short enough not to sit there as a permanent label. */
const LABEL_VISIBLE_MS = 3_000

/** Long enough that the reveal reads as deliberate rather than as a flicker. */
const LABEL_HIDDEN_MS = 5_000

/**
 * Take a waiting build now.
 *
 * Only ever shown once the app has looked and found the page occupied, so its
 * appearance already means "we are not doing this to you unasked". It stays
 * until the update is taken: an affordance that appeared and disappeared with
 * each keystroke would read as a glitch rather than an offer.
 *
 * **It keeps reintroducing itself, and that is the difference from the install
 * action.** Install teaches its label once per tab and then goes quiet, because
 * installing is an invitation nobody is waiting on. This one is the app saying
 * it is holding a build back, on a counter tablet nobody is studying, so it
 * expands and collapses on a cycle until it is used. Reduced motion turns the
 * cycle off and leaves the label up, which says the same thing without moving.
 */
export function UpdateAppButton() {
  const { deferred } = useAppUpdate()
  const prefersReducedMotion = usePrefersReducedMotion()
  const [isLabelVisible, setIsLabelVisible] = useState(true)

  useEffect(() => {
    if (!deferred || prefersReducedMotion) return

    const timer = window.setTimeout(
      () => setIsLabelVisible((visible) => !visible),
      isLabelVisible ? LABEL_VISIBLE_MS : LABEL_HIDDEN_MS,
    )

    return () => window.clearTimeout(timer)
  }, [deferred, isLabelVisible, prefersReducedMotion])

  if (!deferred) return null

  const isExpanded = prefersReducedMotion || isLabelVisible

  return (
    <Button
      aria-label="Update Shawarmania Ops to the latest version"
      className={cn(
        'group min-h-[44px] min-w-[44px] overflow-hidden transition-[width,gap,padding,filter,background-color] duration-300 motion-reduce:transition-none',
        isExpanded
          ? 'w-[104px] gap-2 px-4'
          : 'w-[var(--size-control-phone)] gap-0 px-0 hover:w-[104px] hover:gap-2 hover:px-4 focus-visible:w-[104px] focus-visible:gap-2 focus-visible:px-4',
      )}
      onClick={() => requestUpdateNow()}
      size="phone"
      title="Update Shawarmania Ops to the latest version"
      type="button"
      variant="primary"
    >
      <RefreshCw aria-hidden="true" className="size-[18px] shrink-0" />
      <span
        className={cn(
          'max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-[max-width,opacity] duration-300 motion-reduce:transition-none group-hover:max-w-16 group-hover:opacity-100 group-focus-visible:max-w-16 group-focus-visible:opacity-100',
          isExpanded && 'max-w-16 opacity-100',
        )}
      >
        Update
      </span>
    </Button>
  )
}
