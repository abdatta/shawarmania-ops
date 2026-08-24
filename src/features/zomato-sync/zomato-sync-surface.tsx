import { AggregatorSyncSurface } from '@/features/aggregator-sync/aggregator-sync-surface'
import type { AggregatorChannelConfig } from '@/features/aggregator-sync/channel-config'
import { useAdapters } from '@/data-access'

import { useNeedsYouCounts, zomatoAttentionLabel } from './needs-you-count'

export { readAgainInHours } from '@/features/aggregator-sync/aggregator-sync-surface'

/**
 * The Zomato page of the shared sync surface.
 *
 * Everything rendered here lives in the shared implementation; this file is the
 * channel's identity — its adapter instance, its words, and the Hyperpure line
 * only it carries, because one sign-in tows both Zomato-side channels.
 */
export function ZomatoSyncSurface() {
  const { aggregatorSync } = useAdapters()
  const config: AggregatorChannelConfig = {
    channel: 'zomato',
    adapter: aggregatorSync,
    title: 'Zomato',
    subtitle: 'What was read, and anything that needs you.',
    label: 'Zomato',
    showsHyperpure: true,
    testIdPrefix: 'zomato',
    attention: {
      source: 'zomato-needs-you',
      label: zomatoAttentionLabel,
      useCounts: useNeedsYouCounts,
    },
    pathSegment: '/zomato',
    otpHeading: 'Zomato sent you a code',
    uploadHint:
      'If the automation is blocked, bring a period in by hand: a Zomato order history, a Zomato settlement report, or a Hyperpure statement. The file is read the same way the robot reads it.',
    uploadAccept: '.xlsx,.zip,.csv',
    lapsedTitle: 'Zomato ended the session',
  }

  return <AggregatorSyncSurface config={config} />
}
