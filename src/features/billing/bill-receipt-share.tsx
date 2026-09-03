import { Share2 } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { isDemoReceiptLink } from '@/lib/receipt-link'

/**
 * Sharing a bill's receipt link, degrading to whatever the device offers.
 *
 * The three cases, in order, are the same three
 * [`account-handover.tsx`](../accounts/account-handover.tsx) already paid for
 * the lesson on, and this is the second reader of that lesson rather than a
 * second implementation of a different one:
 *
 *   1. the device's own share sheet, which on the owner's phone is the system
 *      sheet with WhatsApp in it — the intended path, and the reason the link
 *      exists at all;
 *   2. the clipboard, with the button confirming `Copied`;
 *   3. neither — show the link as selectable text and **say nothing about
 *      copying**, because clipboard access is unavailable on an ordinary HTTP
 *      tablet and claiming success there is a lie the reader acts on.
 *
 * It creates nothing. The database mints one link per bill on insert, so this
 * is a read of a URL that already exists and grants no visibility a role did
 * not already hold: a role can share only a bill it can already see.
 *
 * **It renders a fragment, not a box**, so the action row can put this button
 * and `Cancel this bill` side by side. Its children become flex items of the
 * parent's row directly; the revealed link takes `basis-full` and therefore
 * wraps onto its own line beneath them, where a URL has room to break.
 *
 * **In demo mode it says the link will not open**, because it will not: a demo
 * token is built never to resolve, so that a demonstration over fabricated data
 * can never hand out a URL that reaches a real bill. The control still works
 * exactly as it does in the real app -- share sheet, clipboard, selectable text
 * -- it simply stops being a dead link nobody warned you about. Read off the
 * URL rather than the session, so the note cannot disagree with what the public
 * reader will actually do with that token.
 */
export function BillReceiptShare({
  receiptUrl,
  billNumber,
}: {
  receiptUrl: string
  billNumber: number
}) {
  const [copied, setCopied] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const demonstration = isDemoReceiptLink(receiptUrl)

  async function share() {
    const nav = window.navigator

    // Case one. A cancelled share is not a failure and must not fall through to
    // the clipboard, or dismissing the sheet would silently copy instead.
    if (typeof nav.share === 'function') {
      try {
        await nav.share({
          title: `Bill ${billNumber}`,
          text: 'Your Shawarmania receipt',
          url: receiptUrl,
        })
        return
      } catch {
        return
      }
    }

    // Case two.
    if (nav.clipboard) {
      try {
        await nav.clipboard.writeText(receiptUrl)
        setCopied(true)
        return
      } catch {
        // Falls through to case three deliberately.
      }
    }

    // Case three. The link becomes selectable text and no success is claimed.
    setCopied(false)
    setRevealed(true)
  }

  return (
    <>
      <Button variant="secondary" onClick={() => void share()}>
        <Share2 aria-hidden size={18} />
        {copied ? 'Copied' : 'Share receipt'}
      </Button>

      {/*
        Always in the DOM, because a live region has to exist before it changes
        for a screen reader to announce it. Visually hidden rather than a third
        thing on the row: the button's own label already turns to `Copied`, so
        the sighted confirmation is not missing, and two buttons plus a sentence
        do not fit a 375px row.
      */}
      <p aria-live="polite" className="sr-only">
        {copied ? 'Link copied.' : ''}
      </p>

      {demonstration && (
        <p
          data-testid="receipt-link-demo"
          className="order-last basis-full text-xs text-content-muted"
        >
          This is a demonstration link. It will not open a receipt, because the bill behind it is
          invented.
        </p>
      )}

      {/*
        `order-last` as well as `basis-full`: in the row this fragment feeds, the
        link sits between the Share button and Cancel in DOM order, so wrapping
        alone would push Cancel down to a third line. Ordering it last keeps the
        two buttons together and the URL beneath them — and leaves the DOM order
        as it is, so a screen reader still reads the link straight after the
        button that revealed it.
      */}
      {revealed && (
        <p
          data-testid="receipt-link"
          className="order-last basis-full rounded-lg border border-border bg-surface p-3 font-mono text-xs break-all text-content"
        >
          {receiptUrl}
        </p>
      )}
    </>
  )
}
