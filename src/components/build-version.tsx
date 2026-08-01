import { formatDateTime } from '@/domain'
import { cn } from '@/lib/cn'
import { BUILD_SHA, BUILD_TIME } from '@/pwa/build-info'

/** The running build, visible on the device. */
export function BuildVersion({ className }: { className?: string }) {
  let builtAt = BUILD_TIME
  try {
    builtAt = formatDateTime(BUILD_TIME)
  } catch {
    // A malformed injected timestamp must never break the shell.
  }

  return (
    <p
      className={cn('text-xs text-content-muted whitespace-nowrap', className)}
      data-testid="build-version"
    >
      Build <span data-numeric="">{BUILD_SHA}</span> · {builtAt}
    </p>
  )
}
