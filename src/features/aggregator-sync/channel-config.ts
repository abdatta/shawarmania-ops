import { useAdapters } from '@/data-access'
import type { AggregatorSyncAdapter } from '@/data-access/adapters'
import type { AttentionSourceId } from '@/gates/registry'

/**
 * What differs between the channels, stated once.
 *
 * Everything else about the two sync surfaces — the health line, the event
 * list, the code card, the upload fallback, the read-again lockout — is the
 * same question asked of a different portal's rows, and it is written once in
 * the shared surface rather than forked into a twin that would drift.
 *
 * **This file is also the cheap lever for withholding a channel** (#48, design
 * D9). A channel is data here, so one can be taken off the surface by not
 * building its config — no route, no gate and no badge involved. That is why
 * the two per-channel gates in the registry could go `hidden` without losing
 * the ability to promote or demote one channel on its own.
 *
 * `showsHyperpure` is Zomato's alone: one sign-in carries both Zomato-side
 * channels (Model A), so Zomato's page reports on the child it tows and offers
 * their shared repair. Swiggy owns an independent session with an independent
 * mailbox, so its surface never renders a Hyperpure line and its repair can
 * only ever dispatch Swiggy's own login — there is nothing for it to tow.
 */
export interface AggregatorChannelConfig {
  channel: DeliveryChannel
  /** The adapter instance for this channel: independent by construction. */
  adapter: AggregatorSyncAdapter
  title: string
  subtitle: string
  /** The word every row and card uses instead of saying "the channel". */
  label: 'Zomato' | 'Swiggy'
  showsHyperpure: boolean
  /** Test-id prefix, so both surfaces can sit in one DOM in tests. */
  testIdPrefix: 'zomato' | 'swiggy'
  /**
   * Which attention source badges this channel.
   *
   * Kept as documentation of the registry mapping rather than as something the
   * surface reads. The COUNTS are the Delivery container's, because the outlet
   * chips carry both channels' work and only the container may know about both.
   */
  attention: { source: AttentionSourceId }
  /** The sub-path this channel's ledger lives under, stripped from links. */
  pathSegment: '/delivery/zomato' | '/delivery/swiggy'
  otpHeading: string
  uploadHint: string
  uploadAccept: string
  lapsedTitle: string
}

/** Every restaurant channel the Delivery surface serves, in switch order. */
export const DELIVERY_CHANNELS = ['zomato', 'swiggy'] as const

export type DeliveryChannel = (typeof DELIVERY_CHANNELS)[number]

/** Whether a route segment names a channel this surface actually serves. */
export function isDeliveryChannel(value: string | undefined): value is DeliveryChannel {
  return DELIVERY_CHANNELS.some((channel) => channel === value)
}

/**
 * Zomato's identity: its adapter instance, its words, and the Hyperpure line
 * only it carries, because one sign-in tows both Zomato-side channels.
 */
export function useZomatoChannelConfig(): AggregatorChannelConfig {
  const { aggregatorSync } = useAdapters()
  return {
    channel: 'zomato',
    adapter: aggregatorSync,
    title: 'Zomato',
    subtitle: 'What was read, and anything that needs you.',
    label: 'Zomato',
    showsHyperpure: true,
    testIdPrefix: 'zomato',
    attention: { source: 'zomato-needs-you' },
    pathSegment: '/delivery/zomato',
    otpHeading: 'Zomato sent you a code',
    uploadHint:
      'If the automation is blocked, bring a period in by hand: a Zomato order history, a Zomato settlement report, or a Hyperpure statement. The file is read the same way the robot reads it.',
    uploadAccept: '.xlsx,.zip,.csv',
    lapsedTitle: 'Zomato ended the session',
  }
}

/**
 * Swiggy's identity. The first channel whose session stands entirely on its
 * own: no Hyperpure line, no shared repair ladder, no code typed for one portal
 * closing another's request. Its upload fallback takes the annexure the
 * settlement email carries, because that file — unlike a PDF payment advice,
 * which proves money moved but names no orders — can settle a cycle on its own
 * evidence.
 */
export function useSwiggyChannelConfig(): AggregatorChannelConfig {
  const { swiggySync } = useAdapters()
  return {
    channel: 'swiggy',
    adapter: swiggySync,
    title: 'Swiggy',
    subtitle: 'What was read, and anything that needs you.',
    label: 'Swiggy',
    showsHyperpure: false,
    testIdPrefix: 'swiggy',
    attention: { source: 'swiggy-needs-you' },
    pathSegment: '/delivery/swiggy',
    otpHeading: 'Swiggy sent you a code',
    uploadHint:
      'If the automation is blocked, bring a cycle in by hand: the payout annexure from the settlement email carries every order and reconciles itself. A Business Metrics report is read as evidence only.',
    uploadAccept: '.xlsx,.pdf,.zip,.csv',
    lapsedTitle: 'Swiggy ended the session',
  }
}
