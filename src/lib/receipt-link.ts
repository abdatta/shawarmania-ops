/**
 * The link a customer opens to read their own bill.
 *
 * It does not point at this app. The receipt is served by a Cloudflare Worker
 * on the brand site, `shawarmania.in/bill/<token>`, because that is where the
 * customer-facing look belongs and because Supabase never ships a rendered
 * receipt — it answers with about two kilobytes of JSON and Cloudflare ships
 * every byte the customer actually downloads.
 *
 * So unlike {@link activationLink}, this cannot be built from the running
 * deployment's own origin. The base comes from configuration, which is also how
 * the Worker gets exercised against its `workers.dev` URL before the apex route
 * exists at all.
 */

/**
 * Where receipts are served.
 *
 * Configurable because the receipt lives on another origin and that origin is
 * not the same one in every situation a person needs to look at a bill:
 *
 *   - production: `https://shawarmania.in`, the default;
 *   - the Worker running locally under `wrangler dev`, which is how the page and
 *     the PDF are looked at before the apex route exists at all;
 *   - a `workers.dev` URL, once the Worker is deployed but the zone has not
 *     moved.
 *
 * Set `VITE_RECEIPT_BASE_URL` to point Share at any of them. Nothing secret goes
 * in it -- it is a public URL, and the same one the customer sees.
 */
export const PRODUCTION_RECEIPT_BASE_URL = 'https://shawarmania.in'

/**
 * The fallback, as a function rather than an expression, so it is testable
 * without the ambient environment deciding the answer.
 *
 * A test that reads `import.meta.env` is a test whose result depends on whoever
 * last edited `.env` — which is exactly how the default-base assertion here
 * started failing the moment a local Worker URL was configured for browsing.
 */
export function resolveReceiptBaseUrl(configured?: string | undefined): string {
  return configured?.trim() || PRODUCTION_RECEIPT_BASE_URL
}

export const RECEIPT_BASE_URL = resolveReceiptBaseUrl(import.meta.env.VITE_RECEIPT_BASE_URL)

/**
 * A token no public reader will ever serve, for demo mode.
 *
 * A demonstration walks the whole receipt story, share sheet included, over
 * fixture data — and a demo that hands out a live URL over fixture data is a
 * demo that leaks. So the token is made **structurally** unable to name a real
 * bill rather than merely unlikely to: minted tokens are base64url, which has
 * no `~`, so no minted token can ever equal one of these. `demoReceiptToken` is
 * the only place that shape is decided, and `receipt-link.test.ts` asserts the
 * two alphabets cannot meet.
 */
export function demoReceiptToken(billNumber: number): string {
  return `demo~${billNumber}`
}

/** True for a token deliberately built never to resolve. */
export function isDemoReceiptToken(token: string): boolean {
  return token.startsWith('demo~')
}

/**
 * True for a receipt URL that will not open, because it names a demo token.
 *
 * Read off the URL rather than passed down from the session, for one reason:
 * the `demo~` shape is what actually decides whether the public reader will
 * serve it, so asking the URL cannot disagree with reality the way a separately
 * plumbed `mode === 'demo'` flag eventually would.
 */
export function isDemoReceiptLink(url: string): boolean {
  const token = url.split('/bill/')[1]
  return token !== undefined && isDemoReceiptToken(decodeURIComponent(token))
}

/**
 * The receipt URL for a stored token.
 *
 * Returns null for a bill with no token, which is a real state rather than an
 * error: the link is minted when the bill row reaches Postgres, so a bill still
 * sitting in a tablet's outbox has none yet. Nobody can hand out a link to a
 * bill the server has not accepted, and a surface renders nothing rather than a
 * URL that would refuse.
 */
export function receiptLink(
  token: string | null | undefined,
  base: string = RECEIPT_BASE_URL,
): string | null {
  if (!token) return null
  return `${base.replace(/\/+$/, '')}/bill/${encodeURIComponent(token)}`
}
