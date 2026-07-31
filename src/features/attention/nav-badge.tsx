import { Badge } from '@/components/ui/badge'
import type { AttentionSourceId } from '@/gates/registry'

import { ATTENTION_SOURCES } from './sources'

/**
 * The badge on a navigation entry.
 *
 * A component rather than a call inside the shell's `map`, because the source
 * is looked up by id and a hook cannot be called from a loop. Each entry gets
 * its own instance, so each source's hooks run in a fixed order of their own.
 *
 * It renders nothing at all until the count is known and non-zero, so an entry
 * with nothing waiting is indistinguishable from one that was never badged.
 */
export function NavAttentionBadge({
  source,
  surface,
}: {
  source: AttentionSourceId
  /** The nav entry's own label, so the badge is read as belonging to it. */
  surface: string
}) {
  const useSource = ATTENTION_SOURCES[source]
  const attention = useSource()
  if (attention === null) return null

  return (
    <Badge
      count={attention.count}
      label={`${surface}: ${attention.label}`}
      data-testid={`nav-badge-${source}`}
    />
  )
}
