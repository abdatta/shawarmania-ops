import { useCallback, useState } from 'react'

/**
 * Sharing a public link, degrading to whatever the device offers.
 *
 * Three cases, in order — the lesson `account-handover.tsx` paid for first and
 * `BillReceiptShare` applied second, kept in one place now that a third reader
 * (the Menu screen's public menu) needs it:
 *
 *   1. the device's own share sheet, which on a manager's phone is the system
 *      sheet with WhatsApp in it — the intended path;
 *   2. the clipboard, with `copied` set so the control can say so;
 *   3. neither — `revealed` is set so the control shows the link as selectable
 *      text, and **nothing claims a copy**, because clipboard access is
 *      unavailable on an ordinary HTTP tablet and a false "Copied" is a lie the
 *      reader acts on.
 *
 * A dismissed share sheet is a decision, not a failure: it ends the interaction
 * and never falls through to the clipboard.
 */
export function useShareLink(url: string | null, payload: { title?: string; text?: string } = {}) {
  const [copied, setCopied] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const { title, text } = payload

  const share = useCallback(async () => {
    if (!url) return
    const nav = window.navigator

    if (typeof nav.share === 'function') {
      try {
        // Only what was given: the public menu shares its link and nothing else.
        await nav.share({ url, ...(title && { title }), ...(text && { text }) })
      } catch {
        // Dismissed. Nothing else happens.
      }
      return
    }

    if (nav.clipboard) {
      try {
        await nav.clipboard.writeText(url)
        setCopied(true)
        return
      } catch {
        // Falls through to case three deliberately.
      }
    }

    setCopied(false)
    setRevealed(true)
  }, [url, title, text])

  return { share, copied, revealed }
}
