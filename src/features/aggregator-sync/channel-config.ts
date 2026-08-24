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
 * `showsHyperpure` is Zomato's alone: one sign-in carries both Zomato-side
 * channels (Model A), so Zomato's page reports on the child it tows and offers
 * their shared repair. Swiggy owns an independent session with an independent
 * mailbox, so its surface never renders a Hyperpure line and its repair can
 * only ever dispatch Swiggy's own login — there is nothing for it to tow.
 */
export interface AggregatorChannelConfig {
  channel: 'zomato' | 'swiggy'
  /** The adapter instance for this channel: independent by construction. */
  adapter: AggregatorSyncAdapter
  title: string
  subtitle: string
  /** The word every row and card uses instead of saying "the channel". */
  label: 'Zomato' | 'Swiggy'
  showsHyperpure: boolean
  /** Test-id prefix, so both surfaces can sit in one DOM in tests. */
  testIdPrefix: 'zomato' | 'swiggy'
  attention: {
    source: AttentionSourceId
    label: (count: number) => string
    useCounts: () => readonly { outletId: string; needing: number }[] | null
  }
  /** The sub-path this channel's ledger lives under, stripped from links. */
  pathSegment: '/zomato' | '/swiggy'
  otpHeading: string
  uploadHint: string
  uploadAccept: string
  lapsedTitle: string
}
