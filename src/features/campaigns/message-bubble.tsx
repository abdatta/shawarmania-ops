import { WhatsAppMark } from '@/components/ui/whatsapp-mark'
import { cn } from '@/lib/cn'

import {
  previewCampaignMessage,
  renderCampaignMessage,
  type CampaignPreviewSpan,
} from '../../../shared/campaign-message'

/**
 * The message as the customer will see it in WhatsApp
 * (a-campaign-goes-out-on-whatsapp, design *UI notes*).
 *
 * Drawn from `shared/campaign-message`, the function the sender sends with, so
 * the bubble cannot show a message the customer would not get: the name filled
 * in, the stop line under it, WhatsApp's own formatting.
 *
 * It reads as a message received, the plain bubble on WhatsApp's chat ground,
 * in the app's own surface tokens so both themes are the ones the validator
 * gates. The only WhatsApp colour is the small mark above it, the token #63
 * added for a control that stands for WhatsApp.
 */
export function MessageBubble({
  body,
  name,
  imageUrl = null,
  caption,
}: {
  /** The message as written, `{name}` and all. */
  body: string
  /** The saved name to preview with, or null for a customer who has none. */
  name: string | null
  imageUrl?: string | null
  /** Who this preview is for, said above the bubble. */
  caption: string
}) {
  const { text } = renderCampaignMessage(body, name)
  const empty = body.trim() === ''
  // With nothing written the text opens on an empty line, which the
  // placeholder below stands in for.
  const lines = previewCampaignMessage(text).slice(empty ? 1 : 0)
  return (
    <figure data-testid="message-bubble" className="rounded-xl bg-surface-raised p-3">
      <figcaption className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-content-muted">
        <WhatsAppMark className="size-3.5 text-whatsapp" />
        {caption}
      </figcaption>
      {/*
        As wide as a message is on a phone, on a laptop too: a bubble the width
        of the page would show the picture several times the size a customer
        sees it.
      */}
      <div className="max-w-[min(88%,20rem)] overflow-hidden rounded-lg rounded-tl-none border border-border bg-surface shadow-sm">
        {imageUrl && (
          // The whole picture, never cropped [owner, 2026-11-18]. The first
          // version cut it to a strip, which is not what WhatsApp does to an
          // ordinary photo, and a preview that hides half the picture is worse
          // than none.
          <img
            src={imageUrl}
            alt="The campaign's image"
            data-testid="message-image"
            className="block h-auto w-full"
          />
        )}
        <div className="px-3 py-2 text-sm leading-relaxed text-content">
          {empty && (
            // Nothing written yet: the stop line alone would read as the message.
            <p className="text-content-muted">Your message</p>
          )}
          {lines.map((line, index) => (
            // A blank line keeps its height, as it does in a chat.
            <p key={index} className="min-h-[1.625em] whitespace-pre-wrap break-words">
              {line.map((span, at) => (
                <Run key={at} span={span} />
              ))}
            </p>
          ))}
        </div>
      </div>
    </figure>
  )
}

function Run({ span }: { span: CampaignPreviewSpan }) {
  return (
    <span
      className={cn(
        span.bold && 'font-bold',
        span.italic && 'italic',
        span.strike && 'line-through',
        span.mono && 'rounded bg-surface-raised px-1 font-mono text-[0.9em]',
      )}
    >
      {span.text}
    </span>
  )
}
