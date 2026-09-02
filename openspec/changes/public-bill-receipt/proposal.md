# Proposal: Public Bill Receipt

> **Model**: Opus · **Wave**: E · **Depends on**: #53, #35 · **Gate**: a customer opens a link on their phone and sees their own bill on `shawarmania.in` — items at their list prices, every discount as the line it was given as, the round-up, and how it was paid — Shawarmania-themed, readable on a cheap Android phone, and downloadable as a PDF built on demand and never stored anywhere; the page names no customer, so a stranger who opens one learns an order and nothing about a person; every bill is linkable the moment it reaches the server and stays linkable until somebody revokes that one link, which kills no other; a wrong, revoked or invented link is refused in exactly the same words; the owner and a franchise admin share or copy a bill's link from the bill they already see and never from another outlet's; a voided bill says so and a corrected tender reads corrected, because the page is built at the moment it is asked for; no search engine is ever invited to index one; and the four-role demo walkthrough still walks, sharing a link that deliberately does not resolve

## Why

A customer who pays at the counter gets nothing. No paper, no record, no way to
check later what they were charged. The business has wanted to hand them
something since billing went live on 2026-08-12, and 1,035 bills have been rung
since without one of them leaving a trace the customer can hold.

**The schema has been ready for this since the first billing migration.** Line
items snapshot `item_name` and `unit_price_paise`, so a receipt renders what was
actually charged rather than today's menu. `bill_number` is per-outlet sequential,
so a receipt has a human reference. `bill_payments` carries the exact split. None
of it needs a backfill; every bill already in production can be shared the day
this lands.

What was missing is the boundary. A receipt link is a public URL over a real
customer's order, and [`openspec/todos/bill-digital-share.md`](../../todos/bill-digital-share.md)
has named the one genuine risk since it was written: *"A sequential or enumerable
receipt URL would expose every customer's bill."* This change is that boundary,
settled, plus the page the boundary protects.

**Three decisions shape everything else**, each taken against a cheaper
alternative that was rejected for a reason recorded in `design.md`:

1. **Nothing is stored as a file.** The PDF is built when it is asked for and
   discarded. Storing receipts would rent space forever for a document opened
   once, and would go stale the moment a bill is voided or its tender corrected.
2. **Supabase never serves the receipt.** It answers with the bill's data, about
   2 KB, and a Cloudflare Worker renders both the page and the PDF. At today's
   volume that is roughly 3 MB of Supabase egress a month instead of the ~840 MB
   that serving PDFs from Supabase would cost, and the gap widens with every bill.
3. **The page names no customer.** Not a name, not a phone number, not four
   masked digits. This is the control that makes every other risk small: a link
   that leaks, is forwarded, is misdelivered to a mistyped number, or is guessed
   against all odds exposes an order and never a person.

## What Changes

- **Every bill becomes reachable at a public URL**, automatically, from the moment
  it reaches the server. `shawarmania.in/bill/<token>`, where the token is ten
  URL-safe characters of database-generated randomness. No share step gates it, no
  per-bill enabling, nothing new happens at the counter, and the 1,035 bills
  already in production are linkable on the day this lands.
- **The token is not the bill's identity.** It lives in its own table beside the
  bill, so `bills` keeps the append-only trigger that guards the money, and so
  `bills.id` stays safe to appear in a log, an export or a support message.
- **A link can be revoked**, immediately and permanently, killing that one bill's
  link and no other. A fresh one can be issued afterwards. There is no expiry:
  revocation is the off switch, and a receipt a customer keeps for a year keeps
  working.
- **The receipt is customer-facing, not an ops surface.** Shawarmania's logo,
  colours and type, laid out to read on a cheap phone without pinching, in light
  and dark. It shows the outlet, the bill number, the date and time, every line at
  the list price it snapshotted, **every discount as its own line saying what it
  was**, the round-up line, the total, and how it was paid across methods.
- **It is read fresh every time.** A bill voided after the link was sent says
  `Cancelled` rather than showing a valid-looking receipt, and a tender correction
  reads as the corrected split.
- **A Download button serves a real PDF from its own URL**, `…/bill/<token>.pdf`,
  A4, themed, named recognisably. Not a script-generated `blob:`, because a plain
  navigation is the only download path that behaves reliably inside WhatsApp's
  in-app browser, which is where these links will be opened.
- **The owner and a franchise admin get a Share button** on an expanded bill in
  Billing history, beside `Cancel this bill` and before it, so the destructive
  action stops being the first thing a thumb reaches. It opens the phone's native
  share sheet where the device has one, copies to the clipboard where it does not,
  and shows the link as selectable text where neither is available.
- **Nothing is invited to index a receipt.** The Worker answers with
  `X-Robots-Tag: noindex, nofollow`, and the link-preview card a chat app builds
  is deliberately generic — the logo and "Your receipt", with no amount, no items
  and no bill number, so forwarding a link does not spill its contents into a
  group chat before anybody opens it.
- **Abuse is bounded**: per-IP and global rate limits at the edge, one identical
  refusal for a wrong, revoked, or never-existent link, an access log that makes a
  harvesting attempt visible, and a kill switch that disables the whole public
  endpoint without a deploy.

## Capabilities

### New Capabilities

- `public-bill-receipt`: what a public receipt link is — how it comes to exist,
  what it names and deliberately does not name, what the page must say for a
  voided or corrected bill, how it is refused, how it is revoked, and the rules
  that keep it cheap and unindexed.

### Modified Capabilities

- `counter-billing`: the manager bill detail gains a Share affordance on a bill
  that is not void, with the three-step device fallback. It is a read of a link
  that already exists, not an act that creates one, and it grants no visibility
  a role did not already have.
- `outlet-tenancy`: a public, unauthenticated reader now exists. The delta states
  that it grants `anon` no new read access anywhere, that it reaches exactly one
  bill named by a valid token and nothing adjacent, and that the outlet boundary
  is unchanged because the reader never resolves an outlet at all.
- `demo-mode`: the Share button works in demo mode and produces a link that
  deliberately does not resolve, because a demo that hands out a live URL over
  fixture data is a demo that leaks.

## Impact

**In this repo.** One migration adds `bill_public_links` and an after-insert
trigger on `bills`, and backfills every existing bill in the same statement. A
`security definer` function returns one receipt by token, and is the only thing
the public reader may call. `BillingBill` grows the link, the mock and Supabase
adapters follow, demo fixtures gain a non-resolving token, and
`manager-bill-detail.tsx` grows one button in the action row it already has.

**In [`abdatta/shawarmania`](https://github.com/abdatta/shawarmania).** A companion
change, `public-bill-receipt-page`, owns the Cloudflare Worker, the themed page,
the PDF and the caching and abuse rules. It is a third deployable and the first
server-side code that repo has ever held; today it is a static bundle on GitHub
Pages, which cannot set a response header or return `application/pdf`. **This
change is the parent**, and its task list drives that one to completion; neither
is finished alone.

**Outside both repos, and only the owner can do it.** The `shawarmania.in` zone
moves its nameservers from Hostinger to Cloudflare, keeping the same apex records
so GitHub Pages continues to serve the landing site. Without it a Worker cannot
be routed on the apex path. `design.md` carries the runbook and the rollback.

**Nothing about billing, tender, ownership, numbering, readiness, the offline
queue or the counter changes.** No counter write is added, altered, or slowed.
The counter cannot tell this change happened.

## Non-goals

- **Sending the link to the customer.** No WhatsApp, RCS or SMS. That needs a
  Business API account or DLT registration, an opt-in and consent decision, and an
  answer to what happens when a number is mistyped at a busy counter. The link is
  publicly openable and shareable by hand, and delivery is a change of its own.
  This is the largest deliberate cut in the proposal.
- **Expiry.** Considered and dropped. The mechanism the owner first assumed —
  that links die when stale data is cleared — does not exist:
  [`data-retention-policy`](../../todos/data-retention-policy.md) records that
  nothing is deleted, ever, and bills are financial records that will not be. So
  the choice was a real expiry or none, and revocation was judged the better off
  switch because it kills a leaked link *now* rather than in a year, and it never
  breaks a receipt a customer legitimately kept.
- **Any second factor**, including the last four digits of the phone. It defends
  against none of the three realistic threats: it is useless against misdelivery
  (the wrong recipient knows the wrong number, because it is theirs), weak against
  forwarding, and marginal against a brute force that is already infeasible.
- **A customer-facing statement of what they saved.** The bill shows the discount
  lines it actually carries, in the same words the counter recorded them in. It
  does not editorialise a total saving, which
  [`a-discount-is-a-line-on-the-bill`](../a-discount-is-a-line-on-the-bill/proposal.md)
  also declined.
- **Showing the customer's name or phone number**, in any form, masked or whole.
- **A share affordance on the counter tablet.** The owner asked for the owner and
  franchise admin surfaces. The tablet is shared hardware standing in a shop.
- **A QR code on a printed receipt** and **a GST tax invoice**, which stay in
  [`bill-thermal-printing`](../../todos/bill-thermal-printing.md) and
  [`bill-gst-breakup`](../../todos/bill-gst-breakup.md). This page is a receipt and
  must not be mistakable for a tax invoice: no GSTIN, no tax breakup, consistent
  with every bill being recorded `no_tax`.
- **Making the phone number compulsory at the counter, or dropping the name
  field.** Today's names are placeholders typed to satisfy a UI-only
  name-or-phone rule, and the owner expects phone to become near-compulsory once
  links are delivered. That is a billing-UI change this one motivates and does not
  make.
- **Customer-visible order status, loyalty, reordering, or feedback.** The page is
  a receipt, not an account.

## Docs to update before archive

`docs/ARCHITECTURE.md` — a third deployable and the first server-side runtime,
plus why the apex is fronted by Cloudflare. `docs/DATA_MODEL.md` —
`bill_public_links` and the invariant that a bill's link is not its identity.
`docs/SECURITY_AND_PRIVACY.md` — the first unauthenticated public endpoint in the
system, what it deliberately does not carry, the access log, and the revocation
and kill-switch paths. `docs/OPERATIONS.md` — the DNS move, the Worker's secrets
and deploy, revoking a link, and the kill switch. `docs/SCREENS.md` — the Share
button, and the receipt page itself as the one surface a customer sees.
`docs/LIMITATIONS.md` — links are shared by hand until delivery is built, and a
link cannot be recalled from someone who already opened it, only revoked.
`openspec/todos/bill-digital-share.md` — **deleted on archive**, promoted into
this change and its follow-on delivery note.
