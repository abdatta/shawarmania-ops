import { AggregatorSyncSurface } from './aggregator-sync-surface'
import type { AggregatorChannelConfig } from './channel-config'
import { useAdapters } from '@/data-access'

import { useSwiggyNeedsYouCounts, zomatoAttentionLabel } from './needs-you-count'

/**
 * The Swiggy page of the shared sync surface.
 *
 * Swiggy is the second channel to reach this screen, and the first whose
 * session stands entirely on its own: no Hyperpure line, no shared repair
 * ladder, no code typed for one portal closing another's request. Its upload
 * fallback takes the annexure the settlement email carries, because that file —
 * unlike a PDF payment advice, which proves money moved but names no orders —
 * can settle a cycle on its own evidence.
 */
export function SwiggySyncSurface() {
  const { swiggySync } = useAdapters()
  const config: AggregatorChannelConfig = {
    channel: 'swiggy',
    adapter: swiggySync,
    title: 'Swiggy',
    subtitle: 'What was read, and anything that needs you.',
    label: 'Swiggy',
    showsHyperpure: false,
    testIdPrefix: 'swiggy',
    attention: {
      source: 'swiggy-needs-you',
      label: zomatoAttentionLabel,
      useCounts: useSwiggyNeedsYouCounts,
    },
    pathSegment: '/swiggy',
    otpHeading: 'Swiggy sent you a code',
    uploadHint:
      'If the automation is blocked, bring a cycle in by hand: the payout annexure from the settlement email carries every order and reconciles itself. A Business Metrics report is read as evidence only.',
    uploadAccept: '.xlsx,.pdf,.zip,.csv',
    lapsedTitle: 'Swiggy ended the session',
  }

  return <AggregatorSyncSurface config={config} />
}
