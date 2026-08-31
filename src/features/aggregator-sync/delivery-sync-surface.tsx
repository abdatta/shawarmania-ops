import { useEffect } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router'

import { Badge } from '@/components/ui/badge'
import { LoadingBlock } from '@/components/ui/loading'
import { useOutletScope } from '@/features/outlet-scope'
import { cn } from '@/lib/cn'

import { AggregatorSyncSurface } from './aggregator-sync-surface'
import {
  DELIVERY_CHANNELS,
  isDeliveryChannel,
  useSwiggyChannelConfig,
  useZomatoChannelConfig,
  type AggregatorChannelConfig,
  type DeliveryChannel,
} from './channel-config'
import { useNeedsYouCounts, useSwiggyNeedsYouCounts, zomatoAttentionLabel } from './needs-you-count'

/**
 * **Delivery** — one navigation entry for every restaurant channel (#48).
 *
 * Zomato and Swiggy have been one component since #47; the whole difference
 * between them is a title, an icon, a few sentences and whether Hyperpure rides
 * along. Navigation was the last place the twin still existed, and it cost the
 * owner two of their twelve tabs.
 *
 * **What is merged is the container and nothing else.** Each channel still
 * reads through its own adapter instance against its own session, so one
 * channel's waiting work can be neither created nor cleared by the other, and a
 * repair on one signs no other in. Only one channel is mounted at a time, which
 * is what makes that true rather than merely intended: the unselected channel's
 * surface does not exist to read or write anything.
 *
 * **The switch hides nothing.** The navigation badge is the sum across both
 * channels and each segment carries its own count without being selected —
 * the rule the outlet chips on the surface below have obeyed since they were
 * built, now written down (spec: attention-badges).
 *
 * **Which channel is in the route, not in state.** A badge, a link or a
 * returning reader lands on the channel the work is actually on. Where the
 * address names no channel — tapping the navigation entry — the surface
 * resolves one and rewrites the address to say so, so the URL always names what
 * is on screen.
 */
export function DeliverySyncSurface() {
  const { channel: routeSegment } = useParams<{ channel: string }>()
  const navigate = useNavigate()
  const { pathname } = useLocation()

  const configs: Record<DeliveryChannel, AggregatorChannelConfig> = {
    zomato: useZomatoChannelConfig(),
    swiggy: useSwiggyChannelConfig(),
  }

  /*
   * Both channels' waiting work, per outlet, read here rather than inside the
   * mounted channel — this container is the only place that may know about both.
   * They are the same shared reads the tab badge makes, so arriving from the
   * shell costs no extra request.
   */
  const counts: Record<DeliveryChannel, readonly { outletId: string; needing: number }[] | null> = {
    zomato: useNeedsYouCounts(),
    swiggy: useSwiggyNeedsYouCounts(),
  }
  const known = DELIVERY_CHANNELS.every((channel) => counts[channel] !== null)

  /** One channel's waiting work at one outlet: a single cell of the grid. */
  const waitingAt = (channel: DeliveryChannel, outletId: string | null) =>
    (outletId && counts[channel]?.find((entry) => entry.outletId === outletId)?.needing) || 0

  /** One outlet's waiting work across every channel this surface reaches. */
  const waitingForOutlet = (outletId: string) =>
    DELIVERY_CHANNELS.reduce((sum, channel) => sum + waitingAt(channel, outletId), 0)

  /** One channel's waiting work everywhere, for the arrival rule alone. */
  const waitingForChannel = (channel: DeliveryChannel) =>
    counts[channel]?.reduce((sum, entry) => sum + entry.needing, 0) ?? 0

  /*
   * The outlet scope lives HERE rather than inside the channel, and that is what
   * makes the two controls one system instead of two.
   *
   * **They nest, outlet first.** The navigation badge counts every channel at
   * every outlet; each outlet chip carries that outlet's share of it across both
   * channels; and the channel switch below carries the SELECTED outlet's share
   * broken down per channel. So each row decomposes the row above it, and the
   * reader can follow one number down to the work.
   *
   * The alternative reading — chips scoped to the selected channel, segments
   * totalled across outlets — is equally consistent and was built first. It is
   * wrong for one reason: everything else beneath the chips is already scoped to
   * the chosen outlet, so a chip whose number changed when you switched channel
   * tabs was the one control on the page that did not mean what it looked like.
   */
  const { outletId, selector: outletSelector } = useOutletScope({
    badgeFor: (candidate, selected) => {
      const count = waitingForOutlet(candidate)
      return (
        <Badge
          data-testid={`delivery-outlet-needing-${candidate}`}
          count={count}
          // The chip already names the outlet, so the label does not repeat it.
          label={zomatoAttentionLabel(count)}
          // A selected chip is filled with `--primary`, which is the badge's own
          // colour, so an unswapped badge sits invisibly on top of it. Inverting
          // to the same asserted pair the other way round is what attendance's
          // chips already do, and it is the contrast the validator checks.
          className={selected ? 'bg-on-primary text-primary' : ''}
        />
      )
    },
  })

  const named = isDeliveryChannel(routeSegment) ? routeSegment : null

  /**
   * Where the surface opens when the address does not say.
   *
   * Exactly one channel with work waiting is an unambiguous answer and the
   * surface gives it. Two, or none, is not — the reader is landing on the
   * screen rather than on a problem, and the first channel is as good an answer
   * as any and a stable one.
   *
   * Held back until both channels have answered. Opening on a default and
   * moving a moment later would be a screen that changed what it was about
   * while somebody was reading it.
   */
  const selected: DeliveryChannel | null = (() => {
    if (named !== null) return named
    if (!known) return null
    const withWork = DELIVERY_CHANNELS.filter((channel) => waitingForChannel(channel) > 0)
    return withWork.length === 1 ? (withWork[0] ?? null) : DELIVERY_CHANNELS[0]
  })()

  /** `…/ledger/delivery`, whether the address named a channel or not. */
  const base = pathname.replace(/\/delivery(?:\/[^/]*)?\/*$/, '/delivery')
  const pathFor = (channel: DeliveryChannel) => `${base}/${channel}`

  // The address is rewritten rather than merely resolved, so that copying the
  // URL, reloading, or coming back through history all name the same channel
  // that is on screen. `replace`, because landing on the entry and being sent
  // to a channel is one arrival, not two — a back press should leave the
  // surface rather than bounce inside it.
  useEffect(() => {
    if (selected === null) return
    if (routeSegment === selected) return
    void navigate(`${base}/${selected}`, { replace: true })
  }, [base, navigate, routeSegment, selected])

  if (selected === null) {
    return (
      <div className="mx-auto max-w-2xl">
        <LoadingBlock label="Reading the sync" />
      </div>
    )
  }

  return (
    <AggregatorSyncSurface
      // Remounted per channel, deliberately. Health, events, a half-typed code
      // and an upload result all belong to the channel they were read from, and
      // carrying any of them across the switch would be showing one channel's
      // state under the other's name.
      key={selected}
      config={configs[selected]}
      heading="Delivery"
      outletId={outletId}
      outletSelector={outletSelector}
      channelSwitch={
        <ChannelSwitch
          selected={selected}
          configs={configs}
          waiting={(channel) => waitingAt(channel, outletId)}
          onChoose={(channel) => void navigate(pathFor(channel))}
        />
      }
    />
  )
}

/**
 * Which channel this screen is about.
 *
 * The ledger's One day / The month shape, because a reader should not have to
 * learn a second idiom for "switch what this screen is about" — and the outlet
 * chips' semantics, because this switches between two independent accounts
 * rather than two lenses on one dataset. So each segment carries its own count,
 * readable without selecting it (design D11).
 *
 * **The counts are the selected outlet's**, because this control sits beneath
 * the outlet chips and everything beneath them is scoped to the chosen outlet.
 * Together the two segments add up to the chip above that is filled in.
 */
function ChannelSwitch({
  selected,
  configs,
  waiting,
  onChoose,
}: {
  selected: DeliveryChannel
  configs: Record<DeliveryChannel, AggregatorChannelConfig>
  waiting: (channel: DeliveryChannel) => number
  onChoose: (channel: DeliveryChannel) => void
}) {
  return (
    <div
      role="group"
      aria-label="Which delivery channel"
      className="mb-3 grid grid-cols-2 gap-1 rounded-xl border border-border bg-surface p-1"
      data-testid="delivery-channel"
    >
      {DELIVERY_CHANNELS.map((channel) => {
        const on = channel === selected
        const count = waiting(channel)
        return (
          <button
            key={channel}
            type="button"
            aria-pressed={on}
            data-testid={`delivery-channel-${channel}`}
            onClick={() => onChoose(channel)}
            className={cn(
              'flex h-[var(--size-control-phone)] items-center justify-center gap-1.5 rounded-lg text-sm font-semibold focus-visible:focus-ring',
              on
                ? 'bg-primary text-on-primary'
                : 'text-content-muted hover:bg-surface-raised hover:text-content',
            )}
          >
            {configs[channel].label}
            <Badge
              data-testid={`delivery-needing-${channel}`}
              count={count}
              // The segment already names the channel, so the sentence does not
              // repeat it — except on the segment nobody has selected, which is
              // the whole reason this count is here.
              label={`${configs[channel].label}: ${zomatoAttentionLabel(count)}`}
              // A selected segment is filled with `--primary`, which is the
              // badge's own colour, so an unswapped badge would sit invisibly on
              // top of it. The same asserted pair the other way round, exactly
              // as the outlet chips below already do.
              className={on ? 'bg-on-primary text-primary' : ''}
            />
          </button>
        )
      })}
    </div>
  )
}
