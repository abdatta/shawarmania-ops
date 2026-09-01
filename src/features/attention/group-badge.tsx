import { useCallback, useEffect, useMemo, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import type { AttentionSourceId } from '@/gates/registry'

import type { Attention } from './attention'
import { ATTENTION_SOURCES } from './sources'

/**
 * What a **collapsed** navigation group is waiting on: the sum across every
 * child it holds (#51, spec: attention-badges).
 *
 * `attention-badges` already says a reader must not have to change a selection
 * to discover that work exists behind it — the rule that governs the channel
 * switch and the outlet switch. A navigation group is the same problem one
 * level up, so it gets the same answer rather than a new one. Without it,
 * folding Delivery into Setup would put decisions that are waiting right now
 * behind a heading with nothing on it.
 *
 * **The sum and the parts are never both on screen.** An expanded group renders
 * no badge of its own and each child carries its own count, so no waiting item
 * is ever counted twice — two numbers describing one queue would leave the
 * reader to work out whether they overlap.
 *
 * The count is safe by construction rather than by a filter written here: the
 * shell passes only the sources of children `visibleSurfaces` already returned,
 * so a group can never reveal that work exists somewhere this reader could not
 * open.
 */
export function NavGroupAttentionBadge({
  group,
  sources,
}: {
  /** The group's own label, so the badge is read as belonging to it. */
  group: string
  /** One per badged child, already narrowed to what this reader may open. */
  sources: readonly AttentionSourceId[]
}) {
  const [reported, setReported] = useState<Partial<Record<AttentionSourceId, Attention>>>({})

  const report = useCallback((source: AttentionSourceId, attention: Attention | null) => {
    setReported((previous) => {
      // A source that has not answered yet contributes nothing and is not
      // recorded, so "not known" stays distinguishable from "nothing waiting".
      if (attention === null) {
        if (!(source in previous)) return previous
        const next = { ...previous }
        delete next[source]
        return next
      }
      const held = previous[source]
      if (held && held.count === attention.count && held.label === attention.label) return previous
      return { ...previous, [source]: attention }
    })
  }, [])

  const answered = useMemo(
    () => sources.map((source) => reported[source]).filter((value): value is Attention => !!value),
    [sources, reported],
  )

  const total = answered.reduce((sum, attention) => sum + attention.count, 0)

  return (
    <>
      {/*
        One probe per source, because `ATTENTION_SOURCES` maps an id to a hook
        and a hook cannot be called from a loop. Each renders nothing and only
        reports upward — the same trick `NavAttentionBadge` uses one level down,
        for the same reason.
      */}
      {sources.map((source) => (
        <AttentionProbe key={source} source={source} report={report} />
      ))}
      {total > 0 && (
        // The children's own sentences, joined. The shell does not know what is
        // being counted and could not write one honestly (design D2), and a sum
        // across sources is exactly the case where that matters most.
        <Badge
          count={total}
          label={`${group}: ${answered
            .filter((attention) => attention.count > 0)
            .map((attention) => attention.label)
            .join(', ')}`}
          data-testid={`nav-group-badge-${group.toLowerCase()}`}
        />
      )}
    </>
  )
}

/**
 * One source's count, reported upward and rendered nowhere.
 *
 * It reads through the same hook the child's own badge reads through, and those
 * hooks share one request per source through `useSharedRead` — so a probe costs
 * a subscription rather than a second read. Counts are still taken on mount and
 * on return to the foreground, and still never polled.
 */
function AttentionProbe({
  source,
  report,
}: {
  source: AttentionSourceId
  report: (source: AttentionSourceId, attention: Attention | null) => void
}) {
  const useSource = ATTENTION_SOURCES[source]
  const attention = useSource()

  useEffect(() => {
    report(source, attention)
  }, [report, source, attention])

  return null
}
