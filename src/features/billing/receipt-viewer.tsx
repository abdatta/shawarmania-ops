import { LoaderCircle, WifiOff } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { isDemoReceiptLink } from '@/lib/receipt-link'

/**
 * A bill's receipt, shown on the counter without leaving the app
 * (a-receipt-goes-out-on-whatsapp, design D12).
 *
 * The biller turns the tablet to a customer who asked to see their bill. So this
 * frames **the real receipt page** the customer's link opens, rather than
 * redrawing the bill here: a second rendering of the same document is a second
 * place for it to disagree with the first.
 *
 * **The empty `sandbox` is the guard.** It refuses the framed page every
 * permission: no script, form, pop-up, download or navigation of the app. The
 * receipt page runs no script and needs none of them, and without them its PDF
 * link and footer cannot walk the tablet out of the counter mid-service. Nothing
 * is copied, shared or sent from here: #54 kept a *share* control off the tablet
 * because it is shared hardware in a shop, and this hands nothing out.
 *
 * **Offline is asked of the browser**, because a cross-origin frame cannot report
 * that its load failed: `navigator.onLine` on open, kept current by the `online`
 * and `offline` events, so the frame appears when the tablet comes back. A
 * captive portal that claims to be online still shows a blank frame; accepted.
 *
 * **The page is asked for its counter view** (`?view=counter`), which leaves out
 * Download PDF: a dead control inside this sandbox, in front of a customer. The
 * site ignores the parameter until it knows it, so neither side breaks the other.
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
      className="m-auto h-[min(92vh,52rem)] w-[min(96vw,30rem)] overflow-hidden rounded-2xl p-0 backdrop:backdrop-blur-md"
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <h2 className="font-black text-content">Bill {billNumber} receipt</h2>
          <Button size="phone" variant="secondary" onClick={onClose} data-autofocus>
            Close
          </Button>
        </div>

        {online ? (
          <ReceiptFrame src={counterView(receiptUrl)} title={title} />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <WifiOff aria-hidden size={28} className="text-content-muted" />
            <p className="text-sm font-semibold text-content">
              The receipt needs the internet. This tablet is offline.
            </p>
          </div>
        )}

        {isDemoReceiptLink(receiptUrl) && (
          <p
            data-testid="receipt-viewer-demo"
            className="border-t border-border px-4 py-2 text-xs text-content-muted"
          >
            This is a demonstration link. It will not open a receipt, because the bill behind it is
            invented.
          </p>
        )}
      </div>
    </Modal>
  )
}

/**
 * The frame, and a spinner over it until the page has loaded.
 *
 * Its own component so the spinner comes back whenever the frame is mounted
 * afresh: each time the pop-up opens, and when the tablet comes back online.
 * A frame's `load` fires across origins, so this needs nothing from the page.
 * The pop-up's size is fixed, so the spinner holds the space the receipt will
 * fill and nothing moves when it arrives.
 */
function ReceiptFrame({ src, title }: { src: string; title: string }) {
  const [loaded, setLoaded] = useState(false)

  return (
    <div className="relative min-h-0 flex-1">
      <iframe
        src={src}
        title={title}
        sandbox=""
        referrerPolicy="no-referrer"
        onLoad={() => setLoaded(true)}
        className="size-full border-0 bg-surface"
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
