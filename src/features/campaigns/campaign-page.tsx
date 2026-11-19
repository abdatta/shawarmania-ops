import { Megaphone } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router'

import { ConfirmDialog } from '@/components/layout/confirm-dialog'
import { EmptyState } from '@/components/layout/empty-state'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { Chip, ChipRow } from '@/components/ui/chip'
import { LoadingRegion, Shimmer } from '@/components/ui/loading'
import { Toast, useToast } from '@/components/ui/toast'
import { Explain } from '@/components/ui/why'
import { useAdapters } from '@/data-access'
import type { CampaignBatchReading, CampaignDetail, CampaignReading } from '@/data-access/campaigns'
import { formatDayTime } from '@/domain'
import { cn } from '@/lib/cn'

import { formatTestNumber } from '../../../shared/campaign-test-number'

import { Composer } from './composer'
import { MessageBubble } from './message-bubble'
import { Section, StateChip, Tile } from './pieces'
import { SenderLine } from './sender-line'
import { useCampaignRead } from './use-campaign-read'
import { useOutletName } from './use-outlet-name'
import { usePreviewName } from './use-preview-name'
import {
  audienceWords,
  batchWords,
  campaignShownState,
  count,
  messageOf,
  pausedReasonWords,
  testStateWords,
  windowTime,
} from './words'

/** How many batches that have not started get a row of their own. */
const QUIET_BATCHES_SHOWN = 2

/**
 * One campaign's own page (a-campaign-goes-out-on-whatsapp, #85).
 *
 * A draft opens as the composer: the message, the customers, and Submit.
 * Once submitted it is this page instead: how far it has got as tiles, a row
 * per batch, the message as it was sent, and Pause, Resume and Stop.
 *
 * **There is no Send and no release here.** A batch goes out when the owner
 * sends it from the laptop (design D7); the next batch's row says so and
 * offers nothing to press. Pause and Stop are here because either owner
 * may need them from any phone, and the sender asks before every message.
 *
 * `new` in place of an id is a campaign not yet saved.
 */
export function CampaignPage() {
  const { campaigns } = useAdapters()
  const { campaignId = '' } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const toast = useToast()
  const isNew = campaignId === 'new'

  const reading = useCampaignRead<CampaignReading | null>(
    campaignId,
    () => (isNew ? Promise.resolve(null) : campaigns.campaign(campaignId)),
    (value) => value?.campaign.state === 'scheduled',
    'Could not load this campaign. It needs the internet; try again in a moment.',
  )

  const back = useCallback(() => {
    if (location.key === 'default') void navigate('..', { relative: 'path', replace: true })
    else void navigate(-1)
  }, [location.key, navigate])

  /**
   * A campaign first saved on this page. Its first save gives it an address in
   * place of `new`, and the composer must outlive that: it holds what is being
   * typed, and may be half-way to asking whether to schedule.
   */
  const [adopted, setAdopted] = useState<string | null>(null)
  /** Submitted on this page, so a read that still says draft is a stale one. */
  const [scheduledHere, setScheduledHere] = useState<string | null>(null)
  // One key for as long as this page stays open, so that move does not remount it.
  const [composerKey] = useState(campaignId)

  const current = reading.value
  const stale = scheduledHere === campaignId && current?.campaign.state === 'draft'
  const campaign = stale ? null : (current?.campaign ?? null)
  const loading = (!isNew && !reading.settled && reading.error === null) || stale
  const composing =
    scheduledHere !== campaignId && (isNew || campaign?.state === 'draft' || adopted === campaignId)

  if (composing) {
    return (
      <div className="mx-auto max-w-2xl">
        <Composer
          key={composerKey}
          draft={campaign}
          onBack={back}
          onSaved={(saved) => {
            if (current) reading.replace({ ...current, campaign: saved })
            if (isNew) {
              setAdopted(saved.id)
              void navigate(`../${saved.id}`, { relative: 'path', replace: true })
            }
          }}
          onSay={(text) => toast.show({ text })}
          onSubmitted={(scheduled) => {
            toast.show({ text: 'Submitted' })
            // Read afresh rather than patched in: scheduling changes what the
            // sender line says and whether another campaign is ahead of this one.
            setScheduledHere(scheduled.id)
            reading.reload()
          }}
        />
        <Toast toast={toast.current} testId="campaign-toast" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl">
      {campaign && current ? (
        <Scheduled
          reading={current}
          onBack={back}
          onChanged={(next, said) => {
            reading.replace({ ...current, campaign: next })
            toast.show({ text: said })
          }}
        />
      ) : (
        <>
          <PageHeader onBack={back} title="Campaign" />
          {reading.error && (
            <p role="alert" className="mb-3 text-sm font-semibold text-danger">
              {reading.error}
            </p>
          )}
          {loading ? (
            <PageShimmer />
          ) : reading.error ? null : (
            <EmptyState icon={Megaphone} title="There is no campaign here. Go back to the list." />
          )}
        </>
      )}
      <Toast toast={toast.current} testId="campaign-toast" />
    </div>
  )
}

/** A campaign that has been submitted: its progress, its batches, and what can be done to it. */
function Scheduled({
  reading,
  onBack,
  onChanged,
}: {
  reading: CampaignReading
  onBack: () => void
  onChanged: (campaign: CampaignDetail, said: string) => void
}) {
  const { campaigns } = useAdapters()
  const { sender, campaign } = reading
  const [stopping, setStopping] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const state = campaignShownState(campaign, sender)
  const going = campaign.state === 'scheduled' || campaign.state === 'paused'

  async function act(run: () => Promise<CampaignDetail>, said: string) {
    setBusy(true)
    setError(null)
    try {
      onChanged(await run(), said)
    } catch (cause) {
      setError(messageOf(cause, 'That did not work. Try again in a moment.'))
    } finally {
      setBusy(false)
      setStopping(false)
    }
  }

  const { counts } = campaign
  // Every batch that has started, the next two, and the rest as one row: a
  // thousand customers is ten batches, and seven rows reading "waiting" are one fact.
  const started = campaign.batches.filter((batch) => batch.state !== 'waiting').length
  const tail = campaign.batches.length - (started + QUIET_BATCHES_SHOWN)
  const shown =
    tail >= 2 ? campaign.batches.slice(0, started + QUIET_BATCHES_SHOWN) : campaign.batches
  const rest = tail >= 2 ? campaign.batches.slice(started + QUIET_BATCHES_SHOWN) : []
  const pausedBySender = pausedReasonWords(campaign.pausedReason)
  const previewName = usePreviewName()
  const outletName = useOutletName(campaign.audience?.outletId ?? null)

  return (
    <>
      <PageHeader
        onBack={onBack}
        title={campaign.name}
        action={
          campaign.state === 'scheduled' ? (
            <Button
              size="phone"
              disabled={busy}
              data-testid="pause-campaign"
              onClick={() => void act(() => campaigns.pause(campaign.id), 'Paused')}
            >
              Pause
            </Button>
          ) : campaign.state === 'paused' ? (
            <Button
              size="phone"
              disabled={busy}
              data-testid="resume-campaign"
              onClick={() => void act(() => campaigns.resume(campaign.id), 'Resumed')}
            >
              Resume
            </Button>
          ) : undefined
        }
      />

      {going && (
        <SenderLine sender={sender} campaigns={[campaign]} behind={reading.behindCampaignName} />
      )}

      {error && (
        <p role="alert" className="mb-3 text-sm font-semibold text-danger">
          {error}
        </p>
      )}

      <div className="space-y-6">
        <div className="space-y-2">
          <ChipRow>
            <StateChip state={state} />
            {campaign.state === 'scheduled' && campaign.notBefore && counts.sent === 0 && (
              <Chip>from {formatDayTime(campaign.notBefore, sender.serverNow)}</Chip>
            )}
            {reading.behindCampaignName && (
              <Chip data-testid="campaign-behind">after {reading.behindCampaignName}</Chip>
            )}
            {campaign.finishedAt && (
              <Chip>{formatDayTime(campaign.finishedAt, sender.serverNow)}</Chip>
            )}
          </ChipRow>
          {pausedBySender && (
            <p role="status" className="text-sm font-semibold text-content">
              {pausedBySender}
            </p>
          )}

          <dl className="grid grid-cols-3 gap-2" data-testid="campaign-tiles">
            <Tile caption="Sent" testId="tile-sent">
              {count(counts.sent)}
            </Tile>
            <Tile caption={going ? 'To go' : 'Not sent'} testId="tile-to-go">
              {count(counts.toGo)}
            </Tile>
            <Tile caption="Stopped" testId="tile-stopped">
              {count(counts.stopped)}
            </Tile>
            {counts.sent > 0 && (
              <>
                {/*
                  Delivered is the figure to rely on, and it keeps rising after a
                  batch is done; read leaves out everybody with read receipts
                  off. Each caption says which it is, and the reason is a tap away.
                */}
                <Tile
                  testId="tile-delivered"
                  caption={
                    <Explain
                      label="why delivered keeps rising"
                      explanation="WhatsApp says a message is delivered when the customer's phone next comes online, which can be a day later. So this figure keeps rising after a batch is done. It is the one to rely on."
                    >
                      Delivered so far
                    </Explain>
                  }
                >
                  {count(counts.delivered)}
                </Tile>
                <Tile
                  testId="tile-read"
                  caption={
                    <Explain
                      label="why read is at least"
                      explanation="WhatsApp only says a message was read when both phones have read receipts on. Customers with them off are left out, so more people read it than this."
                    >
                      Read, at least
                    </Explain>
                  }
                >
                  {count(counts.read)}
                </Tile>
              </>
            )}
            {counts.notOnWhatsApp > 0 && (
              <Tile caption="Not on WhatsApp">{count(counts.notOnWhatsApp)}</Tile>
            )}
            {counts.unsure > 0 && (
              <Tile
                testId="tile-unsure"
                caption={
                  <Explain
                    label="what unsure means"
                    explanation="The laptop was cut off in the middle of this customer's message, so nobody can say whether it went. They are never sent it again in this campaign: one customer may miss an offer, and nobody gets it twice."
                  >
                    Unsure
                  </Explain>
                }
              >
                {count(counts.unsure)}
              </Tile>
            )}
            {counts.failed > 0 && <Tile caption="Failed">{count(counts.failed)}</Tile>}
          </dl>
        </div>

        <Section id="campaign-batches" title="Batches">
          <ul
            data-testid="batch-list"
            className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface"
          >
            {shown.map((batch) => (
              <BatchRow
                key={batch.batchNo}
                batch={batch}
                reading={reading}
                behind={reading.behindCampaignName !== null}
              />
            ))}
            {rest.length > 0 && (
              // The batches further back all say the same thing, so they say it once.
              <li
                data-testid="batches-rest"
                className="flex min-h-12 items-center gap-3 px-3 py-2 text-sm"
              >
                <span className="font-semibold text-content">
                  Batches {rest[0]?.batchNo} to {rest[rest.length - 1]?.batchNo}
                </span>
                <span className="text-content-muted">{going ? 'waiting' : 'not sent'}</span>
              </li>
            )}
          </ul>
        </Section>

        {campaign.tests.length > 0 && (
          <Section id="campaign-tests" title="Tests">
            <ul
              data-testid="test-list"
              className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface"
            >
              {campaign.tests.map((test) => (
                <li
                  key={test.id}
                  data-testid={`test-${test.id}`}
                  className="flex min-h-11 items-center justify-between gap-3 px-3 py-2 text-sm"
                >
                  <span className="font-semibold tabular-nums text-content">
                    {formatTestNumber(test.phone)}
                  </span>
                  <span
                    className={cn(
                      'text-right',
                      test.state === 'sent' ? 'text-content' : 'text-content-muted',
                    )}
                  >
                    {testStateWords(test, sender.serverNow)}
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        <Section id="campaign-message" title="Message">
          <MessageBubble
            body={campaign.body}
            name={previewName}
            imageUrl={campaign.imageUrl}
            caption="As the customer sees it"
          />
        </Section>

        {campaign.audience && (
          <Section id="campaign-audience" title="Who it goes to">
            <ChipRow data-testid="campaign-audience">
              <Chip>{count(counts.recipients)} customers</Chip>
              {campaign.batchSize !== null && <Chip>batches of {campaign.batchSize}</Chip>}
              {outletName && <Chip>{outletName}</Chip>}
              {audienceWords(campaign.audience).map((words) => (
                <Chip key={words}>{words}</Chip>
              ))}
              <Chip>
                {windowTime(sender.windowStart)} to {windowTime(sender.windowEnd)} in India
              </Chip>
            </ChipRow>
          </Section>
        )}

        {going && (
          // The one destructive action, centred at the foot, as Outlets has its own.
          <div className="flex justify-center pt-2">
            <Button
              variant="secondary"
              size="phone"
              disabled={busy}
              data-testid="stop-campaign"
              className="text-danger"
              onClick={() => setStopping(true)}
            >
              Stop
            </Button>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={stopping}
        danger
        busy={busy}
        title={`Stop ${campaign.name}?`}
        consequence={
          <>
            <strong>{count(counts.toGo)}</strong> customers still waiting are sent nothing, and a
            stopped campaign cannot be resumed. Use Pause to hold it for a while.
          </>
        }
        confirmLabel="Stop"
        cancelLabel="Not now"
        onClose={() => setStopping(false)}
        onConfirm={() => void act(() => campaigns.stop(campaign.id), 'Stopped')}
      />
    </>
  )
}

function BatchRow({
  batch,
  reading,
  behind,
}: {
  batch: CampaignBatchReading
  reading: CampaignReading
  behind: boolean
}) {
  const words = batchWords(batch, reading.campaign, reading.sender, behind)
  return (
    <li
      data-testid={`batch-${batch.batchNo}`}
      className="flex min-h-12 items-center gap-3 px-3 py-2"
    >
      <span className="w-16 shrink-0 text-sm font-semibold text-content">
        Batch {batch.batchNo}
      </span>
      <span
        className={cn(
          'w-16 shrink-0 text-sm',
          words.state === 'sending' ? 'font-semibold text-success' : 'text-content-muted',
        )}
      >
        {words.state}
      </span>
      <span className="min-w-0 flex-1 text-right text-sm tabular-nums text-content">
        {words.figures}
        {words.others && <span className="block text-xs text-content-muted">{words.others}</span>}
      </span>
    </li>
  )
}

/** The page's own shape: the sender line, three tiles, batch rows, the bubble. */
function PageShimmer() {
  return (
    <LoadingRegion label="this campaign" className="space-y-6" data-testid="campaign-loading">
      <div className="space-y-2">
        <Shimmer className="h-5 w-2/3" />
        <div className="grid grid-cols-3 gap-2">
          <Shimmer className="h-14" />
          <Shimmer className="h-14" />
          <Shimmer className="h-14" />
        </div>
      </div>
      <div className="space-y-2">
        <Shimmer className="h-10 w-1/3" />
        <Shimmer className="h-12" />
        <Shimmer className="h-12" />
        <Shimmer className="h-12" />
      </div>
      <div className="space-y-2">
        <Shimmer className="h-10 w-1/3" />
        <Shimmer className="h-32" />
      </div>
    </LoadingRegion>
  )
}
