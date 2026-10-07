import { Link2, Percent, Star } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Card } from '@/components/ui/card'
import { LoadingRegion, Shimmer } from '@/components/ui/loading'
import { Switch } from '@/components/ui/switch'
import { useAdapters } from '@/data-access'
import { DataActionError } from '@/data-access/adapters'
import {
  REVIEW_ASK_PROBLEM_MESSAGES,
  REVIEW_URL_MAX_LENGTH,
  reviewAskProblem,
  type OutletReviewAsk,
} from '@/domain'
import { OutletSection } from '@/features/outlets/outlet-section'
import {
  Answer,
  NumberBox,
  SAVED_HOLD_MS,
  SaveBar,
  SETTLE_MS,
  SettingTile,
  type SavePhase,
} from '@/features/outlets/outlet-service-sections'
import { cn } from '@/lib/cn'
import { usePrefersReducedMotion } from '@/lib/use-prefers-reduced-motion'

/**
 * An outlet's **Google review** section (the-menu-asks-for-a-review), after
 * Loyalty on the outlet's page and built the same way: a switch, its options in
 * their own tiles, and one Save.
 *
 * ```
 * GOOGLE REVIEW
 * ┌ Ask on the table menu                              [ on ] ┐
 * │ ┌ Review link   [https://g.page/r/…/review              ] ┐│
 * │ ┌ Thank-you discount                            [5] %     ┐│
 * ```
 *
 * While it is on, the outlet's public menu opens with a popup asking the
 * customer to share a review on Google, naming the thank-you; within the menu's
 * one-minute cache, with no website deploy. The percentage is the promise the
 * menu makes — the biller gives it with the ordinary bill discount.
 *
 * The owner sets it for any outlet and a manager for the outlets they manage,
 * as Orders and Loyalty.
 */
export function OutletReviewSection({
  outletId,
  mayWrite,
}: {
  outletId: string
  /** Whether to offer the controls. The database is what refuses the write. */
  mayWrite: boolean
}) {
  const { outlets } = useAdapters()
  const [stored, setStored] = useState<OutletReviewAsk | null>(null)
  const [readFor, setReadFor] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    void outlets
      .getReviewAsk(outletId)
      .then((ask) => {
        if (!active) return
        setStored(ask)
        setReadFor(outletId)
        setFailed(false)
      })
      .catch(() => {
        if (active) setFailed(true)
      })
    return () => {
      active = false
    }
  }, [outlets, outletId])

  const shown = readFor === outletId ? stored : null

  if (failed && shown === null) {
    return (
      <p role="alert" className="text-sm font-semibold text-danger" data-testid="review-ask-failed">
        This outlet&rsquo;s Google review ask could not be read. Try again in a moment.
      </p>
    )
  }

  if (shown === null) {
    return (
      <LoadingRegion label="Google review" className="space-y-4" data-testid="review-ask-loading">
        <OutletReviewShimmer />
      </LoadingRegion>
    )
  }

  if (!mayWrite) return <ReadOnlyReviewAsk outletId={outletId} stored={shown} />

  return (
    <ReviewAskSection
      key={outletId}
      outletId={outletId}
      stored={shown}
      onSave={async (next) => {
        const saved = await outlets.updateReviewAsk(outletId, next)
        setStored(saved)
        return saved
      }}
    />
  )
}

/** The section as a newcomer's page draws it: a label over one one-switch tile. */
export function OutletReviewShimmer() {
  return (
    <div className="space-y-2">
      <Shimmer className="h-10 w-32" />
      <Shimmer className="h-[calc(4.5rem+2px)]" />
    </div>
  )
}

function ReviewAskSection({
  outletId,
  stored,
  onSave,
}: {
  outletId: string
  stored: OutletReviewAsk
  onSave: (next: OutletReviewAsk) => Promise<OutletReviewAsk>
}) {
  const [on, setOn] = useState(stored.enabled)
  const [url, setUrl] = useState(stored.url ?? '')
  const [percent, setPercent] = useState(String(stored.percent))
  const [error, setError] = useState<string | null>(null)
  const [phase, setPhase] = useState<SavePhase>('idle')
  const busy = phase === 'saving'
  const reduceMotion = usePrefersReducedMotion()

  useEffect(() => {
    if (phase === 'saved') {
      const timer = window.setTimeout(() => setPhase('settling'), SAVED_HOLD_MS)
      return () => window.clearTimeout(timer)
    }
    if (phase === 'settling') {
      const timer = window.setTimeout(() => setPhase('idle'), reduceMotion ? 0 : SETTLE_MS)
      return () => window.clearTimeout(timer)
    }
  }, [phase, reduceMotion])

  /*
    What would be stored. The link and the percentage are kept while the ask is
    off, so switching it back on starts where the outlet left it. A blank
    percentage is 0, which the rules refuse with a sentence.
  */
  const next: OutletReviewAsk = {
    enabled: on,
    url: url.trim() === '' ? null : url.trim(),
    percent: /^\d{1,2}$/.test(percent.trim()) ? Number(percent.trim()) : 0,
  }
  const dirty = JSON.stringify(next) !== JSON.stringify(stored)
  const id = `review-${outletId}`

  function resetTo(ask: OutletReviewAsk) {
    setOn(ask.enabled)
    setUrl(ask.url ?? '')
    setPercent(String(ask.percent))
  }

  async function submit() {
    const problem = reviewAskProblem(next)
    if (problem !== null) {
      setError(REVIEW_ASK_PROBLEM_MESSAGES[problem])
      return
    }
    setPhase('saving')
    setError(null)
    try {
      resetTo(await onSave(next))
      setPhase('saved')
    } catch (cause) {
      setError(cause instanceof DataActionError ? cause.message : 'That could not be saved.')
      setPhase('idle')
    }
  }

  return (
    <OutletSection id={id} title="Google review" data-testid="review-ask-section">
      <Card
        className={cn(
          'space-y-2 p-3',
          phase === 'saved' && 'motion-safe:animate-[saved-glow_1.6s_ease-out]',
        )}
        data-saved={phase === 'saved' || undefined}
      >
        <SettingTile
          depth={1}
          icon={Star}
          caption="Ask on the table menu"
          hint={on ? undefined : 'The menu opens by asking customers to share a Google review'}
          control={
            <Switch
              checked={on}
              label="Ask for a Google review on the table menu"
              testId="review-ask-switch"
              disabled={busy}
              onChange={(value) => {
                setOn(value)
                setError(null)
              }}
            />
          }
        >
          {on && (
            <>
              <SettingTile
                depth={2}
                icon={Link2}
                caption="Review link"
                hint="From the Google Business Profile: Ask for reviews"
                stacked
                control={
                  <input
                    id={`${id}-url`}
                    aria-label="Google review link"
                    type="url"
                    inputMode="url"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="https://g.page/r/…/review"
                    maxLength={REVIEW_URL_MAX_LENGTH}
                    value={url}
                    disabled={busy}
                    data-testid="review-ask-url"
                    onChange={(event) => {
                      setUrl(event.target.value)
                      setError(null)
                    }}
                    className={cn(
                      'h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm text-content',
                      'focus-visible:focus-ring disabled:opacity-50',
                    )}
                  />
                }
              />
              <SettingTile
                depth={2}
                icon={Percent}
                caption="Thank-you discount"
                hint="Named on the menu; given at the counter"
                control={
                  <NumberBox
                    id={`${id}-percent`}
                    label="Thank-you discount"
                    compact
                    suffix="%"
                    value={percent}
                    onChange={(value) => {
                      setPercent(value.slice(0, 2))
                      setError(null)
                    }}
                    testId="review-ask-percent"
                    disabled={busy}
                  />
                }
              />
            </>
          )}
        </SettingTile>
        <SaveBar
          dirty={dirty}
          phase={phase}
          error={error}
          name="Google review"
          testPrefix="review-ask"
          onSave={() => void submit()}
          onCancel={() => {
            resetTo(stored)
            setError(null)
          }}
        />
      </Card>
    </OutletSection>
  )
}

function ReadOnlyReviewAsk({ outletId, stored }: { outletId: string; stored: OutletReviewAsk }) {
  return (
    <OutletSection id={`review-${outletId}`} title="Google review" data-testid="review-ask-section">
      <Card className="space-y-2 p-3">
        <SettingTile
          depth={1}
          icon={Star}
          caption="Ask on the table menu"
          control={<Answer>{stored.enabled ? `${stored.percent}% thank-you` : 'Off'}</Answer>}
        />
      </Card>
    </OutletSection>
  )
}
