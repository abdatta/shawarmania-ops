import { ExternalLink } from 'lucide-react'

import { buttonVariants } from '@/components/ui/button-variants'
import { WhatsAppMark } from '@/components/ui/whatsapp-mark'
import { isDemoReceiptLink } from '@/lib/receipt-link'
import { receiptMessage, whatsappChatLink } from '@/lib/whatsapp-link'

import { normalizeIndianPhone } from '../../../shared/phone'

/**
 * A bill's one receipt action, chosen by whether the bill has a number
 * (a-receipt-goes-out-on-whatsapp).
 *
 *   - **Send receipt** where the bill's phone normalises to an Indian mobile: a
 *     WhatsApp chat with that number, the message typed. It sends nothing by
 *     itself; the owner taps Send in WhatsApp, having seen whose chat it is.
 *   - **Open receipt** otherwise: the receipt page, outside the app. On an
 *     installed app on Android that is a Chrome Custom Tab, whose own menu
 *     shares, copies and opens in full Chrome. Nothing an app can do reaches
 *     full Chrome directly (design D4).
 *
 * Never both: the owner shares with the customer, and the number already names
 * them. A value that does not normalise is treated as no number and never
 * "cleaned up" into one, because a guessed digit sends a stranger somebody's
 * bill.
 *
 * Both are anchors, not scripted opens: an anchor is a user gesture no popup
 * blocker refuses, and `noreferrer` keeps this app's address out of the request.
 *
 * It creates nothing. The database mints one link per bill on insert, so this
 * reads a URL that already exists and grants no visibility a role did not
 * already hold.
 *
 * **Demo mode behaves exactly as production** [owner, 2026-09-30]: Send opens
 * WhatsApp on the demo customer's number with the message typed, because the
 * link sends nothing and a person still has to tap Send in WhatsApp. The only
 * difference is a note saying the receipt link will not open, since a demo
 * token is built never to resolve. Whether this is a demonstration is read off
 * the receipt URL rather than the session, so it cannot disagree with what the
 * public reader will do with that token.
 *
 * It renders a fragment, so its control is a flex item of the bill's action row
 * directly and the demo note, `basis-full`, wraps onto its own line beneath.
 */
export function BillReceiptAction({
  receiptUrl,
  billNumber,
  totalPaise,
  customerPhone,
}: {
  receiptUrl: string
  billNumber: number
  totalPaise: number
  customerPhone: string | null
}) {
  const phone = normalizeIndianPhone(customerPhone)

  return (
    <>
      {phone ? (
        <a
          href={whatsappChatLink(phone, receiptMessage({ billNumber, totalPaise, receiptUrl }))}
          target="_blank"
          rel="noopener noreferrer"
          // The accessible name carries the channel the mark shows, and
          // contains the visible words so a voice user can say what they see.
          aria-label="Send receipt on WhatsApp"
          // Outlined like Cancel, in WhatsApp's green rather than red
          // [owner, 2026-09-30]: the channel reads without a filled button
          // outshouting everything else on the bill.
          className={`${buttonVariants({ variant: 'secondary', size: 'phone' })} text-whatsapp`}
        >
          <WhatsAppMark />
          Send receipt
        </a>
      ) : (
        <a
          href={receiptUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open receipt (opens outside the app)"
          className={buttonVariants({ variant: 'secondary', size: 'phone' })}
        >
          <ExternalLink aria-hidden size={18} />
          Open receipt
        </a>
      )}

      {isDemoReceiptLink(receiptUrl) && (
        <p
          data-testid="receipt-link-demo"
          className="order-last basis-full text-xs text-content-muted"
        >
          This is a demonstration link. It will not open a receipt, because the bill behind it is
          invented.
        </p>
      )}
    </>
  )
}
