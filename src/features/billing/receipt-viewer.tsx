import { LoaderCircle, WifiOff } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { isDemoReceiptLink } from '@/lib/receipt-link'

/**
 * A bill's receipt, shown on the counter without leaving the app
 * (a-receipt-goes-out-on-whatsapp, design D12).
 *
 * The biller turns the tablet to a customer who asked to see their bill. So this
 * frames **the real receipt page** on `shawarmania.in`, in its counter view,
 * rather than redrawing the bill here: a second rendering of the same document is
 * a second place for it to disagree with the first.
 *
 * **The `sandbox` is the guard.** It permits scripts, which the counter view
 * needs to report its height, and nothing else: no same-origin access, form,
 * pop-up, download or navigation of the app, so no link on the page can walk the
 * tablet out of the counter mid-service. Nothing is copied, shared or sent from
 * here: #54 kept a *share* control off the tablet because it is shared hardware
 * in a shop, and this hands nothing out.
 *
 * **Offline is asked of the browser**, because a cross-origin frame cannot report
 * that its load failed: `navigator.onLine` on open, kept current by the `online`
 * and `offline` events, so the frame appears when the tablet comes back. A
 * captive portal that claims to be online still shows a blank frame; accepted.
 *
 * **The page is asked for its counter view** (`?view=counter`): the customer's
 * receipt trimmed for a pop-up, without Download PDF (a dead control in here),
 * "Paid by" or the tax-invoice sentence, and reporting its height, because this
 * pop-up cannot measure a page on another origin. The pop-up grows to that
 * height, up to 92% of the screen, and scrolls beyond it [owner, 2026-09-30].
 * Where no report comes, it keeps a fixed fallback height, so neither side's
 * deploy can break the other.
 *
 * **Its spinner is a deliberate exception to the shimmer rule** (see
 * `docs/DESIGN_SYSTEM.md`): the owner asked for one, and the page in the frame is
 * another site's, whose shape this app does not draw.
 */
export function ReceiptViewer({
  open,
  receiptUrl,
  billNumber,
  onClose,
}: {
  open: boolean
  receiptUrl: string
  billNumber: number
  onClose: () => void
}) {
  const online = useOnline()
  const title = `Receipt for bill ${billNumber}`

  return (
    <Modal
      open={open}
      onClose={onClose}
      aria-label={title}
      // Blurred behind, and only here: the tablet is turned to a customer, and
      // the counter under this pop-up carries other customers' names and totals.
      className="m-auto max-h-[92vh] w-[min(96vw,30rem)] overflow-hidden rounded-2xl p-0 backdrop:backdrop-blur-md"
    >
      {/*
        Sized by its content, never fixed: the column is capped at the dialog's
        own ceiling and the frame's wrapper is the one part allowed to shrink,
        so a long receipt scrolls there while the header and Close stay put.
      */}
      <div className="flex max-h-[92vh] flex-col">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
          <h2 className="font-black text-content">Bill {billNumber} receipt</h2>
          <Button size="phone" variant="secondary" onClick={onClose} data-autofocus>
            Close
          </Button>
        </div>

        {online ? (
          <ReceiptFrame src={counterView(receiptUrl)} title={title} />
        ) : (
          <div className="flex h-64 shrink-0 flex-col items-center justify-center gap-3 p-6 text-center">
            <WifiOff aria-hidden size={28} className="text-content-muted" />
            <p className="text-sm font-semibold text-content">
              The receipt needs the internet. This tablet is offline.
            </p>
          </div>
        )}

        {isDemoReceiptLink(receiptUrl) && (
          <p
            data-testid="receipt-viewer-demo"
            className="shrink-0 border-t border-border px-4 py-2 text-xs text-content-muted"
          >
            This is a demonstration link. It will not open a receipt, because the bill behind it is
            invented.
          </p>
        )}
      </div>
    </Modal>
  )
}

/** What the counter view of the receipt posts to its parent. */
const HEIGHT_MESSAGE = 'shawarmania-receipt-height'

/**
 * Before a report arrives, and wherever none ever does (a site that does not know
 * `?view=counter` yet), the frame keeps this height rather than collapsing.
 */
const FALLBACK_HEIGHT = '32rem'

/** A guard, not a layout: no receipt is this tall, so a larger report is refused. */
const MAX_REPORTED_HEIGHT = 20_000

/**
 * The frame, sized to the height its page reports, with a spinner over it until
 * the page has loaded.
 *
 * Its own component so the spinner and the fallback height come back whenever
 * the frame is mounted afresh: each time the pop-up opens, and when the tablet
 * comes back online. A frame's `load` fires across origins, so the spinner needs
 * nothing from the page. The height does: it is taken only from a message whose
 * source is this frame's own window, and only as a finite, positive number.
 */
function ReceiptFrame({ src, title }: { src: string; title: string }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [loaded, setLoaded] = useState(false)
  const [height, setHeight] = useState<number | null>(null)

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (!frame.current || event.source !== frame.current.contentWindow) return
      const data: unknown = event.data
      if (typeof data !== 'object' || data === null) return
      const { type, height: reported } = data as { type?: unknown; height?: unknown }
      if (type !== HEIGHT_MESSAGE || typeof reported !== 'number') return
      if (!Number.isFinite(reported) || reported <= 0 || reported > MAX_REPORTED_HEIGHT) return
      setHeight(Math.ceil(reported))
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  return (
    <div className="relative min-h-0 overflow-y-auto">
      <iframe
        ref={frame}
        src={src}
        title={title}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        onLoad={() => setLoaded(true)}
        style={{ height: height === null ? FALLBACK_HEIGHT : `${height}px` }}
        className="block w-full border-0 bg-surface"
      />
      {!loaded && (
        <div
          role="status"
          className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-surface"
        >
          <LoaderCircle
            aria-hidden
            size={28}
            className="animate-spin text-content-muted motion-reduce:animate-none"
          />
          {/* eslint-disable-next-line no-restricted-syntax -- the owner asked for a spinner here; the one exception to the shimmer rule, recorded in docs/DESIGN_SYSTEM.md */}
          <p className="text-sm font-semibold text-content-muted">Loading receipt…</p>
        </div>
      )}
    </div>
  )
}

/** The receipt URL, asking the page for the counter's view. */
function counterView(receiptUrl: string): string {
  const url = new URL(receiptUrl)
  url.searchParams.set('view', 'counter')
  return url.toString()
}

/** The browser's own answer, kept current while the viewer is open. */
function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine)

  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  return online
}
