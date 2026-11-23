import { ChevronRight, ImagePlus, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useBlocker } from 'react-router'

import { ConfirmDialog } from '@/components/layout/confirm-dialog'
import { PageHeader } from '@/components/layout/page-header'
import { AttentionField } from '@/components/ui/attention-field'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useFieldAttention } from '@/components/ui/use-field-attention'
import { useAdapters } from '@/data-access'
import type { CampaignAudience, CampaignDetail } from '@/data-access/campaigns'
import { cn } from '@/lib/cn'
import { newUuid } from '@/lib/uuid'

import {
  campaignBodyProblem,
  campaignBodyRoom,
  usesCampaignName,
} from '../../../shared/campaign-message'

import { checkTestNumber, testNumberProblem } from '../../../shared/campaign-test-number'

import { AudienceSheet } from './audience-sheet'
import { MessageBubble } from './message-bubble'
import { TestNumbers } from './test-numbers'
import { useOutletName } from './use-outlet-name'
import { usePreviewName } from './use-preview-name'
import { useTestNumberSuggestions } from './use-test-number-suggestions'
import { audienceWords, batchesWord, customersWord, messageOf, windowTime } from './words'

type Field = 'name' | 'body' | 'audience' | 'tests'

/**
 * Writing a campaign (a-campaign-goes-out-on-whatsapp, #85): its name, the
 * message, one optional image and the customers it goes to.
 *
 * **The bubble under the text box is the message**, drawn as it is typed by the
 * function the sender will send with, so the partner sees the name filled in
 * and the formatting before anybody else does. The name it is
 * filled in with is the reader's own first name. Where the message greets by
 * name, the bubble can be flipped to a customer who never gave one.
 *
 * **It is submitted, not sent and not scheduled** [owner, 2026-11-18]. The
 * first version asked when: as soon as possible, or not before a date and
 * time. That was a promise the app cannot keep. When a message goes depends on
 * the laptop being open, on the owner sending each batch, and on an hour or
 * more of sending per batch. So there is no time to choose: Submit fixes the
 * customers and cuts them into batches, and the owner sends each batch from
 * the laptop. One line under the button and the confirmation say so.
 *
 * The app suggests no audience [owner, proposal decision 6]: Send to starts
 * empty and stays empty until somebody chooses.
 *
 * **Save and Submit sit side by side at the bottom** [owner, 2026-11-18], where
 * a phone's thumb is when the message is finished; Save was at the top, by the
 * title, and was missed. **Leaving with unsaved typing asks first**, with the
 * browser's own question: the page's back arrow, the phone's back, a link in
 * the navigation, a refresh, closing the tab. The test numbers and the picture
 * are saved the moment they are added, so they never count as unsaved.
 */
export function Composer({
  draft,
  onBack,
  onSaved,
  onSubmitted,
  onSay,
}: {
  /** The saved draft, or null for a campaign not saved yet. */
  draft: CampaignDetail | null
  onBack: () => void
  onSaved: (campaign: CampaignDetail) => void
  onSubmitted: (campaign: CampaignDetail) => void
  /** Say what just happened, in the page's toast. */
  onSay: (text: string) => void
}) {
  const { campaigns } = useAdapters()
  const previewName = usePreviewName()
  // Made here, so a save retried on a bad connection writes one campaign.
  const [id] = useState(() => draft?.id ?? newUuid())
  const [name, setName] = useState(draft?.name ?? '')
  const [body, setBody] = useState(draft?.body ?? '')
  const [audience, setAudience] = useState<CampaignAudience | null>(draft?.audience ?? null)
  const [imageUrl, setImageUrl] = useState<string | null>(draft?.imageUrl ?? null)
  const [previewNamed, setPreviewNamed] = useState(true)
  const [choosing, setChoosing] = useState(false)
  const [confirming, setConfirming] = useState<{
    count: number
    batchSize: number
    window: string
  } | null>(null)
  const [busy, setBusy] = useState<'save' | 'submit' | 'image' | 'tests' | 'test' | null>(null)
  const [testPhones, setTestPhones] = useState<string[]>(draft?.testPhones ?? [])
  const [testWaiting, setTestWaiting] = useState(
    () => draft?.tests.some((test) => test.state === 'waiting') ?? false,
  )
  const suggestions = useTestNumberSuggestions()
  const [error, setError] = useState<string | null>(null)
  /** The name it was last saved under, which is what the page is titled by. */
  const [savedName, setSavedName] = useState<string | null>(draft?.name ?? null)
  /** What was last saved, to tell whether leaving now would lose anything. */
  const [savedAs, setSavedAs] = useState(() =>
    snapshotOf(draft?.name ?? '', draft?.body ?? '', draft?.audience ?? null),
  )
  const unsaved = snapshotOf(name, body, audience) !== savedAs
  // Read when a navigation happens, which can be in the same moment as a save
  // (a new campaign moves to its own address straight after its first one).
  const unsavedNow = useRef(unsaved)
  useEffect(() => {
    unsavedNow.current = unsaved
  }, [unsaved])
  useLeaveWarning(unsaved, unsavedNow)
  const attention = useFieldAttention<Field>()
  const fileInput = useRef<HTMLInputElement>(null)

  const audienceCount = useAudienceCount(audience)
  const outletName = useOutletName(audience?.outletId ?? null)
  const room = campaignBodyRoom(body)
  const greets = usesCampaignName(body)

  /** Save what is typed. Returns the saved draft, or null where it was refused. */
  async function save(): Promise<CampaignDetail | null> {
    if (name.trim() === '') {
      attention.flag('name', 'Give the campaign a name. Customers never see it.')
      return null
    }
    try {
      const result = await campaigns.saveDraft({ id, name: name.trim(), body, audience })
      setSavedName(result.name)
      setSavedAs(snapshotOf(name, body, audience))
      unsavedNow.current = false
      return result
    } catch (cause) {
      setError(messageOf(cause, 'That was not saved. Try again in a moment.'))
      return null
    }
  }

  async function saveOnly() {
    setBusy('save')
    setError(null)
    const result = await save()
    setBusy(null)
    if (result) onSaved(result)
  }

  /** Check everything, save, and ask before anything is fixed. */
  async function askToSubmit() {
    setError(null)
    if (name.trim() === '') {
      return attention.flag('name', 'Give the campaign a name. Customers never see it.')
    }
    const problem = campaignBodyProblem(body)
    if (problem === 'empty') return attention.flag('body', 'Write the message first.')
    if (problem === 'too_long') {
      return attention.flag('body', `The message is ${-room} characters too long. Shorten it.`)
    }
    if (audience === null) return attention.flag('audience', 'Choose the customers it goes to.')
    setBusy('submit')
    try {
      const result = await save()
      if (!result) return
      onSaved(result)
      const [matched, overview] = await Promise.all([
        campaigns.audienceCount(audience),
        campaigns.overview(),
      ])
      if (matched === 0) {
        attention.flag('audience', 'Nobody is picked. Choose customers again.')
        return
      }
      setConfirming({
        count: matched,
        batchSize: overview.sender.batchSize,
        window: `${windowTime(overview.sender.windowStart)} and ${windowTime(overview.sender.windowEnd)}`,
      })
    } catch (cause) {
      setError(messageOf(cause, 'That did not work. Try again in a moment.'))
    } finally {
      setBusy(null)
    }
  }

  async function submit() {
    setBusy('submit')
    setError(null)
    try {
      // No start time: when a batch goes is the owner's, on the laptop.
      onSubmitted(await campaigns.schedule(id, null))
    } catch (cause) {
      setError(messageOf(cause, 'That was not submitted. Try again in a moment.'))
      setConfirming(null)
    } finally {
      setBusy(null)
    }
  }

  /** Test numbers belong to a saved draft, so the first one saves the draft too. */
  async function storeTestNumbers(next: string[]): Promise<boolean> {
    setBusy('tests')
    setError(null)
    try {
      if (savedName === null) {
        const result = await save()
        if (!result) return false
        onSaved(result)
      }
      setTestPhones(await campaigns.setTestNumbers(id, next))
      return true
    } catch (cause) {
      attention.flag('tests', messageOf(cause, 'That number was not saved. Try again in a moment.'))
      return false
    } finally {
      setBusy(null)
    }
  }

  async function addTestNumber(typed: string): Promise<boolean> {
    const checked = checkTestNumber(typed)
    if (checked.phone === null) {
      attention.flag('tests', testNumberProblem(checked.error))
      return false
    }
    attention.clear('tests')
    if (testPhones.includes(checked.phone)) return true
    return storeTestNumbers([...testPhones, checked.phone])
  }

  /** The message as it stands, saved and then sent to every test number by the laptop. */
  async function sendTest() {
    setError(null)
    attention.clear('tests')
    const problem = campaignBodyProblem(body)
    if (problem === 'empty') return attention.flag('body', 'Write the message first.')
    if (problem === 'too_long') {
      return attention.flag('body', `The message is ${-room} characters too long. Shorten it.`)
    }
    setBusy('test')
    try {
      const result = await save()
      if (!result) return
      onSaved(result)
      const queued = await campaigns.sendTest(id)
      setTestWaiting(true)
      onSay(
        `Test for ${queued} ${queued === 1 ? 'number' : 'numbers'}. It goes out when the laptop is on.`,
      )
    } catch (cause) {
      attention.flag('tests', messageOf(cause, 'That test was not sent. Try again in a moment.'))
    } finally {
      setBusy(null)
    }
  }

  /** An image belongs to a saved draft, so the first one saves the draft too. */
  async function chooseImage(file: File | null) {
    setBusy('image')
    setError(null)
    try {
      if (savedName === null) {
        const result = await save()
        if (!result) return
        onSaved(result)
      }
      const result = await campaigns.setImage(id, file)
      setImageUrl(result.imageUrl)
    } catch (cause) {
      setError(messageOf(cause, 'That image was not added. Try again in a moment.'))
    } finally {
      setBusy(null)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  return (
    <>
      <PageHeader onBack={onBack} title={savedName ?? 'New campaign'} />

      {error && (
        <p role="alert" className="mb-3 text-sm font-semibold text-danger">
          {error}
        </p>
      )}

      <form
        noValidate
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault()
          void askToSubmit()
        }}
      >
        <AttentionField
          attentionRef={attention.register('name')}
          message={attention.messageFor('name')}
        >
          <Labelled label="Name" htmlFor="campaign-name">
            <Input
              id="campaign-name"
              required
              value={name}
              maxLength={60}
              placeholder="e.g. Diwali offer"
              data-testid="campaign-name"
              onChange={(event) => {
                setName(event.target.value)
                attention.clear('name')
              }}
            />
          </Labelled>
        </AttentionField>

        <AttentionField
          attentionRef={attention.register('body')}
          message={attention.messageFor('body')}
        >
          <Labelled label="Message" htmlFor="campaign-body">
            <textarea
              id="campaign-body"
              required
              rows={6}
              value={body}
              data-testid="campaign-body"
              placeholder="e.g. Hi {name}, 20% off this weekend."
              onChange={(event) => {
                setBody(event.target.value)
                attention.clear('body')
              }}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-content placeholder:text-content-muted focus-visible:focus-ring"
            />
          </Labelled>
          <p className="mt-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs text-content-muted">
            <span>
              <code>{'{name}'}</code> is their name · <code>*bold*</code> <code>_italic_</code>{' '}
              <code>~strike~</code>
            </span>
            <span
              data-testid="campaign-body-room"
              className={cn('tabular-nums', room < 0 && 'font-semibold text-danger')}
            >
              {room < 0 ? `${-room} too long` : `${room} left`}
            </span>
          </p>
        </AttentionField>

        <div className="space-y-2">
          {greets && previewName !== null && (
            // The same pressed pair Customers uses for its two lists.
            <div
              role="group"
              aria-label="Preview for"
              className="grid grid-cols-2 gap-1 rounded-xl border border-border bg-surface p-1"
            >
              {(
                [
                  [true, previewName],
                  [false, 'No saved name'],
                ] as const
              ).map(([named, label]) => (
                <button
                  key={label}
                  type="button"
                  aria-pressed={previewNamed === named}
                  data-testid={named ? 'preview-named' : 'preview-unnamed'}
                  onClick={() => setPreviewNamed(named)}
                  className={cn(
                    'h-[var(--size-control-phone)] rounded-lg text-sm font-semibold focus-visible:focus-ring',
                    previewNamed === named
                      ? 'bg-primary text-on-primary'
                      : 'text-content-muted hover:bg-surface-raised hover:text-content',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <MessageBubble
            body={body}
            name={greets && previewNamed ? previewName : null}
            imageUrl={imageUrl}
            caption="As the customer sees it"
          />
        </div>

        <TestNumbers
          phones={testPhones}
          suggestions={suggestions}
          busy={busy === 'tests' || busy === 'test' ? busy : busy !== null}
          attentionRef={attention.register('tests')}
          message={attention.messageFor('tests')}
          canSend={body.trim() !== ''}
          waiting={testWaiting}
          onAdd={addTestNumber}
          onRemove={(phone) => void storeTestNumbers(testPhones.filter((held) => held !== phone))}
          onSend={() => void sendTest()}
          onTyping={() => attention.clear('tests')}
        />

        <div>
          <span className="mb-1 block text-sm font-semibold text-content">Image</span>
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            aria-label="Choose an image"
            data-testid="campaign-image-input"
            className="sr-only"
            onChange={(event) => void chooseImage(event.target.files?.[0] ?? null)}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="phone"
              disabled={busy !== null}
              data-testid="campaign-image"
              onClick={() => fileInput.current?.click()}
            >
              <ImagePlus aria-hidden size={18} />
              {busy === 'image' ? 'Adding…' : imageUrl ? 'Change' : 'Add'}
            </Button>
            {imageUrl && (
              <Button
                variant="ghost"
                size="phone"
                disabled={busy !== null}
                aria-label="Remove the image"
                data-testid="campaign-image-remove"
                onClick={() => void chooseImage(null)}
              >
                <X aria-hidden size={18} />
                Remove
              </Button>
            )}
          </div>
        </div>

        <AttentionField
          attentionRef={attention.register('audience')}
          message={attention.messageFor('audience')}
        >
          <span className="mb-1 block text-sm font-semibold text-content">Send to</span>
          <button
            type="button"
            data-testid="choose-audience"
            onClick={() => {
              attention.clear('audience')
              setChoosing(true)
            }}
            className="flex min-h-14 w-full items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2 text-left hover:bg-surface-raised focus-visible:focus-ring"
          >
            <span className="min-w-0 flex-1">
              {audience === null ? (
                <span className="font-semibold text-content">Choose customers</span>
              ) : (
                <>
                  <span
                    className="block font-bold tabular-nums text-content"
                    data-testid="audience-count"
                  >
                    {audienceCount === null ? '…' : customersWord(audienceCount)}
                  </span>
                  <span className="block text-xs text-content-muted">
                    {[...(outletName ? [outletName] : []), ...audienceWords(audience)].join(' · ')}
                  </span>
                </>
              )}
            </span>
            <ChevronRight aria-hidden size={18} className="shrink-0 text-content-muted" />
          </button>
        </AttentionField>

        <div className="grid grid-cols-2 gap-3">
          <Button
            type="button"
            variant="secondary"
            size="phone"
            disabled={busy !== null}
            data-testid="save-campaign"
            onClick={() => void saveOnly()}
          >
            {busy === 'save' ? 'Saving…' : 'Save'}
          </Button>
          <Button type="submit" size="phone" disabled={busy !== null} data-testid="submit-campaign">
            {busy === 'submit' && !confirming ? 'Checking…' : 'Submit'}
          </Button>
        </div>
        <p className="-mt-3 text-center text-xs text-content-muted" data-testid="submit-means">
          Sent later from the laptop, a batch at a time.
        </p>
      </form>

      {choosing && (
        <AudienceSheet
          value={audience}
          onClose={() => setChoosing(false)}
          onDone={(chosen) => {
            setAudience(chosen)
            setChoosing(false)
          }}
        />
      )}

      <ConfirmDialog
        open={confirming !== null}
        busy={busy === 'submit'}
        title={`Submit ${name.trim()}?`}
        consequence={
          confirming ? (
            <>
              {testPhones.length > 0 && <>The test numbers get it first. </>}
              <strong>{customersWord(confirming.count)}</strong> in{' '}
              <strong>{batchesWord(Math.ceil(confirming.count / confirming.batchSize))}</strong>.
              Nothing goes out yet: each batch is sent from the laptop, between {confirming.window}{' '}
              in India. The message and the customers cannot be changed after this.
            </>
          ) : (
            ''
          )
        }
        confirmLabel="Submit"
        onClose={() => setConfirming(null)}
        onConfirm={() => void submit()}
      />
    </>
  )
}

/** What a save would keep, as one comparable value. */
function snapshotOf(name: string, body: string, audience: CampaignAudience | null): string {
  return JSON.stringify([name.trim(), body, audience])
}

/** The browser's own wording is shown for a refresh or a closed tab; this, for a move inside the app. */
export const LEAVE_UNSAVED =
  'Leave without saving? What you typed since the last save will be lost.'

/**
 * Asks before the page is left with unsaved typing. A move inside the app is
 * held and the browser's own confirm decides it; a refresh or a closed tab
 * gets the browser's own "Leave site?" question, which is all a page may ask.
 */
function useLeaveWarning(unsaved: boolean, unsavedNow: { readonly current: boolean }) {
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      unsavedNow.current && currentLocation.pathname !== nextLocation.pathname,
  )
  useEffect(() => {
    if (blocker.state !== 'blocked') return
    if (window.confirm(LEAVE_UNSAVED)) blocker.proceed()
    else blocker.reset()
  }, [blocker])

  useEffect(() => {
    if (!unsaved) return
    const ask = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      // Older browsers ask only when a value is set.
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', ask)
    return () => window.removeEventListener('beforeunload', ask)
  }, [unsaved])
}

function Labelled({
  label,
  htmlFor,
  children,
}: {
  label: string
  htmlFor: string
  children: ReactNode
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1 block text-sm font-semibold text-content">
        {label}
      </label>
      {children}
    </div>
  )
}

/** How many customers an audience holds now; null while it is being asked. */
function useAudienceCount(audience: CampaignAudience | null): number | null {
  const { campaigns } = useAdapters()
  const [answer, setAnswer] = useState<{ audience: CampaignAudience; count: number } | null>(null)
  useEffect(() => {
    if (audience === null) return
    let current = true
    campaigns
      .audienceCount(audience)
      .then((count) => {
        if (current) setAnswer({ audience, count })
      })
      .catch(() => {
        // The count is a convenience here; submitting asks again and says why.
      })
    return () => {
      current = false
    }
  }, [campaigns, audience])
  return answer !== null && answer.audience === audience ? answer.count : null
}
