import { TriangleAlert, Unplug } from 'lucide-react'

import type { CampaignSenderReading, CampaignSummary } from '@/data-access/campaigns'
import { cn } from '@/lib/cn'

import { senderLine } from './words'

/**
 * One line saying where the sender is: online, when it was last seen, and what
 * it is waiting on (a-campaign-goes-out-on-whatsapp, design *UI notes*).
 *
 * **The dot is for the live state alone.** Online gets the green dot; offline
 * and not linked get an unplugged mark, and halted a warning triangle in the
 * danger colour, so the three are told apart by shape as well as colour.
 *
 * It is a line of text and nothing else. Releasing a batch, restarting a halted
 * sender and linking a phone all happen on the laptop, and the line says so
 * instead of offering a control that could not do it (design D7, D9).
 */
export function SenderLine({
  sender,
  campaigns,
  behind = null,
}: {
  sender: CampaignSenderReading
  campaigns: readonly CampaignSummary[]
  /** On one campaign's page: the campaign whose batch is out ahead of it. */
  behind?: string | null
}) {
  const words = senderLine(sender, campaigns, behind)
  return (
    <p
      data-testid="sender-line"
      data-tone={words.tone}
      className="mb-4 flex items-start gap-2 text-sm text-content-muted"
    >
      {words.tone === 'live' ? (
        <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-success" />
      ) : words.tone === 'trouble' ? (
        <TriangleAlert aria-hidden size={16} className="mt-0.5 shrink-0 text-danger" />
      ) : (
        <Unplug aria-hidden size={16} className="mt-0.5 shrink-0" />
      )}
      <span className="min-w-0">
        <span
          className={cn('font-semibold', words.tone === 'trouble' ? 'text-danger' : 'text-content')}
        >
          {words.headline}
        </span>
        {words.detail && <span> · {words.detail}</span>}
      </span>
    </p>
  )
}
