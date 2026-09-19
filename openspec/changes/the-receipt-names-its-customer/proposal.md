# Proposal: the-receipt-names-its-customer

> **Model**: Opus · **Wave**: F · **Depends on**: #57, #54 · **Gate**: a customer opening their own receipt link sees their name as the bill recorded it and the last four digits of the number they gave, so the page reads as theirs rather than as an anonymous document, and a gold member's receipt says so; a bill rung before any of this still renders, naming nobody, because the page reports what its own bill snapshotted and never consults the directory; the PDF says exactly what the page says; the reversal of the clause that forbade this is argued in the spec rather than deleted from it; and the four-role demo walkthrough still walks.

## Why

A receipt with no name on it does not look like *your* receipt. The customer
cannot confirm at a glance that it is theirs, and the page reads as a document
about an order rather than a record of a purchase they made.

This becomes more pressing the moment receipts are actually sent to customers —
the work waiting in
[`openspec/todos/bill-receipt-delivery.md`](../../todos/bill-receipt-delivery.md).
A link handed over by hand can be explained. A message arriving on a phone cannot.

## This reverses a shipped clause, deliberately

**Read this before planning anything.** `public-bill-receipt` (#54, archived
2026-09-10) does not merely omit the customer. It bans it, and it pre-empted the
masked version by name:

> The receipt SHALL NOT show the customer's name, their phone number, or any part
> of either, whether whole, masked, abbreviated or encoded.

That is enforced in three places at once: the reader function's projection does
not select the columns, `supabase/tests/51_the_public_receipt_reader.sql` asserts
the omission as *"the function's own projection rather than a page choosing not to
render them"*, and the spec scenario says neither appears *"anywhere in the page
or the PDF, in any form"*.

**The reasoning was sound and should be quoted, not paraphrased away.** A receipt
link is a bearer token in a URL. Anyone who obtains it — forwarded, screenshotted,
in a group chat, over a shoulder — sees the bill. The bet #54 made was that a
leaked link should cost the customer **one order, never a person**.

The owner has decided to reopen that bet, on 2026-09-18. This change is that
reversal made explicitly, with its cost written down.

### The cost, stated honestly

**Masking the phone buys less than it appears to.** The name is what identifies
somebody; the last four digits of a number the holder already has tell them
almost nothing new. The real change is that a receipt link becomes a
**link → person** lookup for whoever holds it.

The spec must say that plainly. A masked number that implies more privacy than it
delivers would be worse than showing nothing, because it would let the next reader
believe the original bet still holds.

**Why mask at all, then?** Because the phone's job on a receipt is **confirmation,
not information** — its only purpose is to let the holder say *yes, mine*. The
last four digits do that. The full number is gratuitous.

**Last four, not first five.** An Indian mobile is ten digits opening 6–9; the
opening block identifies the operator and circle and is not what a person
recognises as their own number. The tail is.

## What already exists, and why this is not hard

The durable half is done and has been since the bills were designed.

- **`bills.customer_name` and `bills.customer_phone` are snapshot columns on the
  bill itself**, not a join to the directory, and the `bills_append_only` trigger
  refuses to change them afterwards.
- So: a customer renamed in the directory does not rewrite an old receipt; a
  number reassigned to a stranger next year does not follow the bill; and a bill
  can carry a name with no `customer_id` at all — which after #56 is exactly what
  a skipped order looks like.
- #57 adds the tier snapshot on the bill, which is where the ⭐ comes from. **The
  receipt must read the snapshot**, never the live membership, or a revoked
  member's old receipt would silently rewrite itself.

This change therefore alters **a projection and a page**, not a data model.

**A bill rung before #56 and #57 renders fine and names nobody** — its snapshot
columns are whatever they were, often null. That is a scenario to assert, not an
edge case to guard against.

## Scope

- Widen the public reader function's projection to include the bill's snapshotted
  customer name, a masked form of its snapshotted phone, and its tier.
- **Mask in the database, not on the page.** #54's own principle: the omission
  must be the function's projection rather than a page choosing what to render.
  The full number must not cross the boundary and then be hidden with CSS.
- Render name, masked phone and ⭐ on the receipt page and in the PDF, which must
  agree exactly.
- Amend the `public-bill-receipt` spec: replace *The public receipt names no
  customer* with what now holds, carrying the reasoning of the original and the
  reason it was reversed.
- Update `supabase/tests/51_the_public_receipt_reader.sql`, whose assertions
  currently encode the old rule.

## This is a two-repository change

The SQL reader, the spec and the pgTAP suite are here. **The Cloudflare Worker,
the themed page and the PDF are in the landing repository**, as the sibling change
`public-bill-receipt-page` (see #54's proposal for how the pair was split).

Both sides ship or the page receives fields it does not render. Plan the
coordination in `tasks.md` rather than discovering it at deploy: per
`no-pushes-while-the-counter-trades`, the owner picks the window, and two repos
mean two pushes to sequence.

## Non-goals

- **The biller's identity stays hidden.** #54 also refuses to name the biller, the
  approving manager and the till. None of that is reopened; only the customer is.
- **No change to link issuance, revocation, or the identical-refusal rule** for
  unknown, malformed, revoked and switched-off links.
- **No indexing.** Nothing is invited to index a receipt, and that stays.
- **No receipt delivery.** Sending it is still
  [`bill-receipt-delivery`](../../todos/bill-receipt-delivery.md).
- **The access log still cannot identify the customer.** #54 requires it; putting
  a name on the page does not license putting one in the log.

## Task ordering

This one is **not** UI-first with an owner checkpoint — the page is a handful of
lines of text in an existing layout, and the interesting work is the boundary and
the spec reversal. Order it:

1. The spec amendment, argued, **before** the code that depends on it. The point
   of reversing a clause in writing is that the next reader finds the reasoning
   rather than an absence.
2. The projection, the masking, and the pgTAP suite the old rule is written into.
3. The page and the PDF, in the other repository.

## How to run the gate

- Open a real receipt for: a bill with a name and a number, a bill with a label
  and no number (a #56 skip), a bill with neither (pre-#56 history), and a gold
  member's bill.
- Confirm the PDF matches the page in every one of those.
- Confirm the **full** number never appears in the function's response — inspect
  the payload, not the rendering.
- Confirm a revoked membership does not change an old receipt.
- Confirm an unknown, malformed, revoked and disabled link are still refused
  identically.
- On a cheap Android phone at the width #54 targets.

## User-only gate steps

- 🧍 The owner opens their own receipt link and confirms it reads as a customer's
  receipt rather than an ops document.
- 🧍 The owner confirms they accept the stated cost — that whoever holds a link
  now learns who the bill belongs to.

## Docs to update before archiving

- [`docs/SECURITY_AND_PRIVACY.md`](../../../docs/SECURITY_AND_PRIVACY.md) — the
  receipt is no longer anonymous; record what a leaked link now discloses.
- [`docs/SCREENS.md`](../../../docs/SCREENS.md) — the public receipt's contents.
- [`docs/LIMITATIONS.md`](../../../docs/LIMITATIONS.md) — anything asserting the
  receipt names nobody.
