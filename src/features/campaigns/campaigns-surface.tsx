import { ChevronRight, Megaphone, Plus } from 'lucide-react'
import { Link } from 'react-router'

import { EmptyState } from '@/components/layout/empty-state'
import { PageHeader } from '@/components/layout/page-header'
import { buttonVariants } from '@/components/ui/button-variants'
import { LoadingRegion, Shimmer } from '@/components/ui/loading'
import { useAdapters } from '@/data-access'
import type { CampaignSenderReading, CampaignSummary } from '@/data-access/campaigns'
import { formatDayTime } from '@/domain'
import { cn } from '@/lib/cn'

import { StateChip } from './pieces'
import { SenderLine } from './sender-line'
import { useCampaignRead } from './use-campaign-read'
import { campaignShownState, count } from './words'

/**
 * Campaigns: the list (a-campaign-goes-out-on-whatsapp, #85).
 *
 * A list, and a page of its own per campaign, as Team does it. Above the list
 * one line says where the sender is; under it one row leads to the customers
 * who said stop.
 *
 * **Nothing here sends, and there is no button that would.** The app writes a
 * campaign and its audience; a program on the owner's laptop sends it, a batch
 * at a time, each batch released on that laptop (design D7). So the page offers
 * Add, and every other verb is on a campaign's own page.
 *
 * Business-wide, so there are no outlet chips: a campaign belongs to the
 * business, and the outlet whose customers it goes to is part of its audience.
 */
export function CampaignsSurface() {
  const { campaigns } = useAdapters()
  const reading = useCampaignRead(
    'campaigns',
    () => campaigns.overview(),
    (value) => value.campaigns.some((campaign) => campaign.state === 'scheduled'),
    'Could not load the campaigns. They need the internet; try again in a moment.',
  )
  const overview = reading.value

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Campaigns"
        action={
          // A link, because adding one opens a page of its own to write it on.
          <Link
            to="new"
            relative="path"
            aria-label="Add a campaign"
            data-testid="add-campaign"
            className={cn(buttonVariants({ size: 'phone' }), 'whitespace-nowrap')}
          >
            <Plus aria-hidden size={18} />
            Add
          </Link>
        }
      />

      {reading.error && (
        <p role="alert" className="mb-3 text-sm font-semibold text-danger">
          {reading.error}
        </p>
      )}

      {overview === null ? (
        reading.error ? null : (
          <ListShimmer />
        )
      ) : (
        <>
          <SenderLine sender={overview.sender} campaigns={overview.campaigns} />

          {overview.campaigns.length === 0 ? (
            <EmptyState
              icon={Megaphone}
              title="No campaigns yet. Add one to write a message and choose who gets it."
            />
          ) : (
            <ul
              data-testid="campaign-list"
              className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface"
            >
              {overview.campaigns.map((campaign) => (
                <li key={campaign.id}>
                  <CampaignRow campaign={campaign} sender={overview.sender} />
                </li>
              ))}
            </ul>
          )}

          <Link
            to="stopped"
            relative="path"
            data-testid="open-stopped"
            className="mt-4 flex min-h-14 items-center justify-between gap-3 rounded-xl border border-border bg-surface px-3 py-2 hover:bg-surface-raised focus-visible:focus-ring"
          >
            {/* A count the reader cannot clear goes in parentheses, never a badge. */}
            <span className="font-semibold text-content">Stopped ({overview.stoppedCount})</span>
            <ChevronRight aria-hidden size={18} className="shrink-0 text-content-muted" />
          </Link>
        </>
      )}
    </div>
  )
}

function CampaignRow({
  campaign,
  sender,
}: {
  campaign: CampaignSummary
  sender: CampaignSenderReading
}) {
  const state = campaignShownState(campaign, sender)
  return (
    <Link
      to={campaign.id}
      relative="path"
      data-testid={`campaign-${campaign.id}`}
      className="flex min-h-14 items-center gap-3 px-3 py-2 hover:bg-surface-raised focus-visible:focus-ring"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate font-bold text-content">{campaign.name}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          <StateChip state={state} />
          {state === 'submitted' && campaign.notBefore && (
            <span className="text-xs text-content-muted">
              from {formatDayTime(campaign.notBefore, sender.serverNow)}
            </span>
          )}
        </span>
      </span>
      {campaign.recipients > 0 && (
        <span
          className="shrink-0 text-sm font-semibold tabular-nums text-content"
          data-testid="campaign-progress"
        >
          {count(campaign.sent)} / {count(campaign.recipients)}
          <span className="sr-only"> sent</span>
        </span>
      )}
      <ChevronRight aria-hidden size={18} className="shrink-0 text-content-muted" />
    </Link>
  )
}

/** The list's own shape: the sender line, three campaign rows, the stopped row. */
function ListShimmer() {
  return (
    <LoadingRegion label="the campaigns" data-testid="campaigns-loading">
      <Shimmer className="mb-4 h-5 w-2/3" />
      <div className="space-y-px">
        <Shimmer className="h-14" />
        <Shimmer className="h-14" />
        <Shimmer className="h-14" />
      </div>
      <Shimmer className="mt-4 h-14" />
    </LoadingRegion>
  )
}
