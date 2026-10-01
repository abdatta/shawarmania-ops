# Proposal: a-demo-bill-has-a-receipt

> **Model**: Opus · **Wave**: F · **Depends on**: #54, #63 · **Gate**: in demo mode, on the deployed app and on a developer's machine alike, every demo bill's receipt opens a real receipt page on `shawarmania.in` that shows **that demo bill**, its items, discounts, round-up, total and tender as the demo shows them, in the customer's view and in the counter's view, and Send receipt, Open receipt and View receipt all lead to it; the page is unmistakably a demonstration on every screen and in its PDF, so it can never pass for a real Shawarmania receipt; no real bill's data and no secret is involved anywhere; the page refuses anything that does not parse as a demo bill, and no content in the link can inject markup; a real receipt link behaves exactly as before; a developer can also run the receipt site locally against the local database, from steps written down; and the four-role demo walkthrough still walks.

> **A seed**, written 2026-09-30 at the owner's request, after a day spent testing
> #63's counter **View receipt** against real production receipts loaded by hand
> into a throwaway local demo. Expand it with `/opsx:propose` when its turn comes.
> It is the parent of a pair: the receipt page is in the landing repository
> (`C:\Users\iamro\Code\shawarmania`), whose child change is created when this is
> proposed.

## Why

Every demo bill already has a receipt link, and it is built **never to resolve**:
`demoReceiptToken(n)` is `demo~n`, and the receipt site refuses any token outside
`/^[A-Za-z0-9_-]{8,64}$/`, so `~` can never reach a real bill (#54). That rule is
right, and it stays.

The cost is that **a demonstration cannot show a receipt.** Open receipt and
View receipt open the site's "This receipt is not available" page, and Send
receipt sends a link that does the same. #63 built three ways for a customer to
see their bill, and a demo of #63 shows none of them working.

There is also **no way to see a receipt during development** without production.
On 2026-09-30, checking the counter's pop-up meant reading real receipt links out
of the production database into a throwaway local copy of the demo, twice, and
deleting them afterwards. The permission system flagged it as a production read,
correctly. It worked, and it is not a workflow.

## What the owner asked for

On 2026-09-30, in order of preference:

1. **Demo receipts hosted on the live site**: "a query-paramed template that becomes
   any bill we want for demo". A demo bill's receipt link carries the bill, and
   `shawarmania.in` draws it. **This is the point of it: the demo works in
   production**, at `ops.shawarmania.in/demo`, for anyone shown it (a franchisee,
   a new manager), with nothing running locally. Local development gets it for
   free, because the local demo links to the same live site.
2. **Local receipt links** for development, "built properly".

## The shape, as far as a seed should go

**A demo receipt is the bill, carried in its own link.** The demo already holds
every demo bill's contents in its mock adapter. The demo's receipt link would carry
that bill as a compact, versioned payload, for example
`shawarmania.in/bill/demo?b=<base64url JSON>`, and the site would render it with
the same code that renders a real receipt: same rows, same totals, same customer
and counter views (#63), same PDF.

**It must be impossible to mistake for a real receipt.** This is the hard
requirement, and the reason the model is Opus. A template that draws any bill
from a URL on the brand's own domain is, left alone, **a free fake-receipt
generator**: anyone could make a Shawarmania receipt for any items and amount and
send it as proof of payment. So:

- **Every demo receipt is stamped as a demonstration**, on the page and in the PDF,
  in words a customer, a delivery partner and a Shawarmania employee would all read
  the same way (for example *DEMO — not a real bill*), in a place no crop or
  screenshot can lose without losing the bill. Settling that wording and placement
  is the proposal's first design question.
- **Everything in the payload is escaped**, validated against a strict schema, and
  bounded in size; anything else gets the identical refusal every bad link gets.
- **No secret is involved.** The demo is a public client-side app, so it cannot
  sign the payload, and the design must not pretend otherwise. The stamp is the
  control.
- Demo receipts are `noindex`, outside the access record, and never reach the
  database.

**The real-receipt path does not change.** Real tokens, the identical refusal, the
kill switch, the rate limits and the "names no customer" bound (with #58's last
four digits) all stay as they are.

**Local development gets the honest path too.** The pieces already exist and are
undocumented: the landing repo's `npm run worker:dev` serves receipts on
`http://127.0.0.1:8787`, its `.dev.vars.example` already points it at the **local**
Supabase stack, the local seed's bills already carry receipt links, and the ops
app's `VITE_RECEIPT_BASE_URL` (commented out in `.env.example`) sends links there.
Signed in locally, real-shaped receipts for seed bills then work end to end with
no production data. This change writes those steps down and makes the local
default obvious.

## Context for whoever expands this

Everything below was true on 2026-09-30. Re-read the files before relying on a
line number.

**How a demo bill gets its link today (ops repo).**

- `src/lib/receipt-link.ts`: `receiptLink(token)` builds
  `${RECEIPT_BASE_URL}/bill/${token}`; `RECEIPT_BASE_URL` is
  `https://shawarmania.in` unless `VITE_RECEIPT_BASE_URL` is set.
  `demoReceiptToken(n)` returns `demo~n`; `isDemoReceiptToken` and
  `isDemoReceiptLink` spot one. `src/lib/receipt-link.test.ts` asserts that a
  minted token (base64url, no `~`) can never equal a demo token. **Keep that
  test true.**
- `src/data-access/mock/billing.ts`: `billView(row)` (about line 444) turns a mock
  bill row into a `BillingBill`, and sets `receiptUrl:
  receiptLink(demoReceiptToken(row.bill_number))` (about line 519). This is the
  one place a demo receipt link is made. The mock already has everything a receipt
  shows: lines with snapshotted names and prices, discount rows, rounding,
  payments, the outlet. `BillingBill` is defined in `src/data-access/adapters.ts`.
- **Three surfaces consume the link**, all from #63:
  - `src/features/billing/bill-receipt-action.tsx`: Send receipt (a `wa.me` link
    whose message ends with the receipt URL, built by `src/lib/whatsapp-link.ts`)
    or Open receipt, on the owner/admin bill detail. It shows a demo note when
    `isDemoReceiptLink`.
  - `src/features/billing/receipt-viewer.tsx`: the counter's View receipt pop-up.
    It frames the URL with `?view=counter` appended, `sandbox="allow-scripts"`,
    and sizes itself to a `postMessage` of `{ type: 'shawarmania-receipt-height',
    height }` from its own frame (fallback 32rem). It shows the same demo note.
  - Both choose the note by reading the link, never the session (#63 D5): keep
    that rule if the demo link's shape changes.
- Demo mode itself: `docs/DEMO_MODE.md` (the adapter seam, "a demo never writes
  to real data"). It says nothing about receipts yet.

**How the receipt site draws a receipt (landing repo, `C:\Users\iamro\Code\shawarmania`).**

- `worker/src/index.ts`: the Cloudflare Worker behind `shawarmania.in/bill/*`.
  `TOKEN_SHAPE = /^[A-Za-z0-9_-]{8,64}$/` refuses `demo~n`. A valid token goes
  through per-client and global rate limits, then `readReceipt` calls the ops
  database's `bill_public_receipt(token)` with the service-role key
  (`OPS_SUPABASE_URL`, `OPS_SERVICE_ROLE_KEY`), which also writes an access record.
  The JSON is cached per token. Every failure gets one identical refusal page
  (`renderRefusal`). `?view=counter` is read by `receiptPageOptions`.
- `worker/src/receipt.ts`: **the `Receipt` payload type**: `outlet.name`,
  `bill_number`, `business_date`, `sold_at`, `status`, `totals` (`subtotal_paise`,
  `discount_paise`, `tax_paise`, `rounding_paise`, `total_paise`), `lines`
  (`item_name`, `quantity`, `unit_price_paise`, `line_total_paise`),
  `discount_rows` (`source`, `basis`, `value_bp`, `value_paise`, `categories`,
  `amount_paise`), `payments`, and optionally `points` (#62), `phone_last4` and
  `gold_at_outlet` (#58), and `service_type` (#60). `assertNamesNobody` is a
  tripwire against a name or phone in the payload. **A demo payload should be
  this type**, so one renderer serves both.
- `worker/src/content.ts` (`receiptContent`) turns a `Receipt` into rows and
  notes. `worker/src/page.ts` (`renderReceiptPage`, with `COUNTER_STYLES` and the
  `REPORT_HEIGHT` script for the counter view) and `worker/src/pdf.ts`
  (`renderReceiptPdf`) draw it. An agreement test keeps page and PDF saying the
  same thing.
- Tests: `worker/test/receipt.test.ts`, whose `aReceipt()` fixture is a ready-made
  example payload. Run with `npm run worker:test` and `npm run worker:typecheck`.
- Specs: the landing repo's `openspec/specs/public-receipt-page/spec.md`, with the
  identical-refusal requirement, the download requirement and #63's counter-view
  requirement (`the-counter-views-the-receipt`). The ops side's demo rule is #63's
  "A demonstration bill behaves as a real one", in `counter-billing`.

**The SQL side of the payload.** `bill_public_receipt` is redefined by each change
that alters the receipt; the latest is in
`supabase/migrations/20260930010000_a_cancelled_receipt_gives_no_reason.sql`. A
TypeScript mapper from a demo `BillingBill` to a `Receipt` would be a second
implementation of that function's shape. The proposal should decide how they are
kept from drifting: a shared table of cases asserted on both sides, as
`lint:totals` does for bill totals, is the repo's precedent.

**Running the receipt site locally** (the second half of the scope).

- In the landing repo, `.dev.vars.example` holds the local variables
  (`OPS_SUPABASE_URL=http://127.0.0.1:54321` and the local service-role key from
  `npx supabase status` in the ops repo). Copy it to `.dev.vars` (gitignored).
  **Never point it at production.** `npm run worker:dev` runs `wrangler dev`,
  which serves on `http://127.0.0.1:8787` by default.
- In the ops repo, `VITE_RECEIPT_BASE_URL=http://127.0.0.1:8787` (already
  described, commented out, in `.env.example`) sends every receipt link there.
  The local seed's bills carry links, minted by the trigger from
  `20260903010000_every_bill_is_linkable.sql`.
- The ops dev server binds to `127.0.0.1`, not `localhost`.

**How the two repos ship.**

- Ops: a push to `main` runs CI and, if green, deploys. The owner picks the window
  once a counter trades; Kalyani Cafe opens 2026-10-01. Rebase onto `origin/main`
  before every push (the owner's instruction); other sessions push to the same
  checkout's `main`.
- Landing: a push to `main` only rebuilds the GitHub Pages site. **The receipt
  Worker deploys only by hand**, `npm run worker:deploy` from the landing repo,
  on a machine logged in to Cloudflare. Deploying ships everything committed in
  `worker/`, including other changes' unreleased work, so check what is
  committed first.
- The landing repo has the `openspec` CLI (`openspec validate <change>`), and its
  `openspec/config.yaml` wants a "Manual QA checklist" in every proposal and a
  Manual QA task at the end of every task list. Its child change goes in
  `openspec/changes/<name>/` there, like `the-counter-views-the-receipt`.

**Things that moved while this was seeded.** #58 (`the-receipt-says-its-yours`)
changed the receipt on 2026-09-30: last four digits and *⭐ Gold* on the page, two
header rows, no cancellation reason. A demo receipt should show whatever #58 left
the real one showing. The counter view's trims (#63) apply to demo receipts too,
since they share the renderer.

**What was learned on 2026-09-30.** The counter's pop-up was tested against real
receipts by reading twelve production receipt links into a throwaway local copy
of the demo. It needed the production database password and a deliberate
override of the permission system, and was deleted afterwards. A demo receipt
that works from the deployed demo removes the reason for ever doing that again.

## Alternatives already weighed (2026-09-30)

- **Real production receipts in the local demo, permanently.** Refused: every
  developer would need the production database password to run the demo, and real
  customers' receipt links would flow through a development tool. Done twice by
  hand on 2026-09-30, behind a throwaway folder deleted afterwards, and that is
  the most it should ever be.
- **A local-only switch in the receipt Worker** that draws a canned sample for any
  `demo~n` while running under `wrangler dev`. Works, but only on a developer's
  machine, and the sample would not match the demo bill. The owner preferred the
  live template, which does both.
- **A copy of the demo's bills inside the Worker**, keyed by bill number. Two copies
  of the same fixtures in two repositories drift. Carrying the bill in the link
  has one source.
- **Opening the demo's own receipt as a page inside the ops app.** A second
  rendering of the receipt, which #63 D12 already refused for the counter.

## Open questions for the proposal

- The stamp: its words, where it sits, and whether the PDF carries it on every line
  or once, boldly. Whether a demo receipt offers a PDF at all.
- The payload: its schema (it should be the receipt payload the real reader
  returns, so one renderer serves both), versioning, size bound, and query string
  against path.
- Whether `demo~n` stays the token shape, with the payload alongside it, so the
  structural guarantee that no demo token names a real bill keeps its test.
- Whether Send receipt in demo should carry the demo receipt link (it opens
  WhatsApp on an invented number, #63 D5), and what the message then says.
- How #58's last-four-digits and gold line appear on a demo receipt.

## Non-goals

- **No change to real receipts**, their tokens, refusals, rate limits, kill switch
  or access record.
- **No real bill's data in the demo**, in either repository, at any time.
- **No secret in the client**, and no signing scheme that would need one.
- **No production database access from a development setup.**

## Docs to update before archiving

- `docs/DEMO_MODE.md`: demo receipts, and what makes them unmistakable.
- `docs/SCREENS.md`: the customer's receipt section, for the demo view.
- `docs/SECURITY_AND_PRIVACY.md`: why a URL-carried receipt on the brand domain is
  safe only because of its stamp, and what an attacker can and cannot make with it.
- `docs/TESTING.md`: running the receipt site locally against the local database.
- `.env.example`: `VITE_RECEIPT_BASE_URL` for local development.

## User-only gate steps

- 🧍 The owner opens a demo bill's receipt in the deployed demo, in the customer's
  view and the counter's, and judges whether anyone could mistake it for a real
  receipt.
