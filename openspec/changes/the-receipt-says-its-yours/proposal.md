# Proposal: the-receipt-says-its-yours

> **Model**: Opus · **Wave**: F · **Depends on**: #57, #54, **#62**, #60, #63 · **Gate**: a customer opening their own receipt link sees the last four digits of the number they gave and, if they were gold at that outlet when they paid, *⭐ Gold*, so the page reads as theirs rather than as an anonymous document; it never shows their name, their full number, or anything else that identifies a person; the full number never leaves the database, proved by reading the function's payload rather than the page; a bill with no customer attached, including every bill rung before customer identification, shows neither; the page, its counter view and its PDF agree on all of it; a bill says whether it was dine-in or takeaway, and never its table; the reversal of the clause that forbade masked digits is argued in the spec rather than deleted from it; no receipt link or counter pop-up breaks at any point in the two-repository release; and the four-role demo walkthrough still walks.

> **Rewritten 2026-09-30** from the seed `the-receipt-names-its-customer`. The owner
> decided the receipt shows **the last four digits and gold, never a name**, and
> that gold reads *⭐ Gold*: the receipt already names its outlet, loudly. The first seed put the customer's name on
> the page; why that was dropped is below, so it is not re-proposed.

## Why

A receipt with nothing of the customer's on it does not look like *your* receipt.
The customer cannot confirm at a glance that it is theirs, and the page reads as a
document about an order rather than a record of a purchase they made.

This is no longer hypothetical: receipts reach customers today. #63
`a-receipt-goes-out-on-whatsapp` (released 2026-09-30) lets the owner send a
bill's link to the customer's WhatsApp, and lets a biller show a customer their
receipt on the counter tablet in a pop-up. #59 `bill-receipt-delivery` will send it
automatically by SMS once DLT approves. A message arriving on a phone cannot be
explained the way a link handed over by hand can.

## What the receipt shows, and what it never shows

**Shown**, and only on a bill that has a customer attached (`bills.customer_id`
is set):

- **The last four digits of the number the customer gave**, as the bill
  snapshotted it, in a masked form (e.g. `•••• 4821`).
- **⭐ Gold**, when the bill's snapshotted `customer_tier` is gold.
  Gold is per outlet since #62, so the mark names the outlet it belongs to, which
  is the bill's own.

**Never shown**, on any bill, in any rendering:

- **The customer's name.** Not whole, not a first name, not an initial.
- **The full number, or any part of it beyond the last four digits.**
- The biller, the approving manager and the till, exactly as #54 decided.

### Why no name [owner, 2026-09-30]

The first seed printed the name, and accepted the cost in writing: a receipt link
became a **link → person** lookup for whoever holds it. Two things since then made
that cost worse:

- **Receipts are now sent to typed numbers.** #63 sends by hand today; #59 will send
  automatically. One wrong digit at a busy counter delivers the link to a stranger.
  With a name on it, that stranger learns who ate what, where and when.
- **#59 and #58 together would have undone #54's bound**, and #59's seed said so:
  whichever shipped second inherited the argument. Showing no name dissolves it. A
  stranger holding a misdelivered link learns one order, four digits of a number,
  and that its owner is gold at one outlet. That is not a person.

The name also carried a hazard of its own: about 1,900 production bills from
before #56 carry strings like `As` and `Kk` that billers typed to get past a
required field. None of that needs guarding now.

**Do not re-propose the name as a small addition.** It is the one fact on the page
that turns a misdelivered link into a disclosure.

## This reverses a shipped clause, deliberately

**Read this before planning anything.** `public-bill-receipt` (#54, archived
2026-09-10) bans the customer from the receipt, and it rejected the masked number
by name:

> The receipt SHALL NOT show the customer's name, their phone number, or any part
> of either, whether whole, masked, abbreviated or encoded.

That is enforced in four places: the reader's projection does not select the
columns; `supabase/tests/51_the_public_receipt_reader.sql` asserts the omission as
the function's own projection; the spec scenario says neither appears *"anywhere
in the page or the PDF, in any form"*; and the landing Worker refuses to serve any
payload carrying a customer key (see *The release order* below).

#62 wrote the rule down a second time. Its `public-bill-receipt` delta adds
*The receipt states the points a bill earned, used and left*, which says the
receipt *"SHALL continue to name no customer."* That clause stays true: the
amended requirement still names no customer, and defines what naming is. So no
delta against it is needed (design D5).

**#54's reasoning should be quoted, not paraphrased away.** A receipt link is a
bearer token in a URL. Anyone who obtains it (forwarded, screenshotted, in a group
chat, over a shoulder) sees the bill. The bet was that a leaked link should cost
the customer **one order, never a person**. **That bet still holds after this
change**, and the spec should say so plainly: the name stays banned, which is what
keeps it true.

### What is actually being reversed, and what it costs

Only the ban on masked digits. `docs/SECURITY_AND_PRIVACY.md` records why #54
declined them, and it was not privacy:

> Printing four masked digits was declined too, so that the option of using them as
> a second factor is not spent.

That option is spent by this change, knowingly. The second factor was never built
and would defend against none of the realistic threats #54 itself listed:
misdelivery (the wrong recipient knows the wrong number, because it is theirs),
forwarding, or brute force. The spec must record that the option is gone, so
nobody later designs a "confirm the last four digits" check on top of a receipt
that already prints them.

**The digits' job is confirmation, not information.** They let the holder say
*yes, mine*. **Last four, not first five**: an Indian mobile opens with a block that
identifies the operator and circle, which is not what a person recognises as their
own number. The tail is.

**The gold mark discloses a little**: that the number's owner is gold at that
outlet. That is a label (#57), not spend or history, and the spec should name it
as a disclosure rather than pretend it is none.

## What already exists

- **`bills.customer_phone` and `bills.customer_tier` are snapshots on the bill**,
  refused changes afterwards by `bills_append_only`. So a number reassigned to a
  stranger next year does not follow the bill, and a revoked or expired gold spell
  does not rewrite an old receipt. **The receipt must read the snapshot**, never
  the live membership.
- **`bills.customer_tier` is the membership at the bill's own outlet** (#62's
  `bills_snapshot_customer_tier`), so *⭐ Gold* on a receipt means gold at the outlet it names, exactly what
  it records.
- **`bills.customer_id` is null on every bill rung before #56** (2026-09-21):
  `20260920000000_the_server_links_the_sale_to_the_customer.sql` records that no
  row had ever been linked. Showing the digits and the mark **only when
  `customer_id` is set** gives every older bill nothing, with no date rule. One
  pre-#56 production bill carries a phone and no `customer_id`; it must show no
  digits, and is the real case to test against.
- **`bills.service_type`** (#60) exists on every bill. The reader does not return
  it yet. `bills.table_number` does too, and the receipt never shows it: a table
  is a label for the length of a meal, like the order number [owner, 2026-09-30].

This change therefore alters **a projection and three renderings**, not a data
model.

## What production looked like on 2026-09-30

Read-only, from production:

- 2,230 bills. **None has a `customer_id`**, and the customer directory is
  empty: in the 304 bills since #56 went live, no customer gave a number.
- No bill carries `customer_tier = gold`, and none carries a `service_type`.

So on the day it ships, this change shows digits on no real receipt. It starts to
matter when Kalyani Cafe opens (2026-10-01) with points (#62), which gives a
customer a reason to give their number. **The gate runs on seeded bills locally**;
the real-bill steps below wait for real use, like #62's own.

## Scope

- **Widen `bill_public_receipt`'s projection** with:
  - `phone_last4`: the last four digits of the bill's snapshotted
    `customer_phone`, **only when `customer_id` is set**, else null.
  - `gold_here`: true when the snapshotted `customer_tier` is gold, under the same
    condition.
  - `service_type`, as the bill stored it. Not the table number.
  - No key is one the landing tripwire refuses (design D1).
- **Mask in the database, not on the page.** #54's principle stands: what the page
  may not show, the function does not return. The full number must never cross the
  boundary and then be trimmed by the page.
- **Render, in the landing repository**, the digits, the gold mark and the service
  line on all three renderings: the customer's page, its counter view
  (`?view=counter`, from #63), and the PDF.
  - Service: *Dine-in* or *Takeaway* beside the bill number, or nothing for a
    bill that is neither (every bill before #60, and every bill at an outlet that
    chose neither).
- **Amend the `public-bill-receipt` spec**:
  - *The public receipt names no customer* becomes what now holds: never the name,
    the full number, the biller, the approving manager or the till; the last four
    digits and the gold mark only for a bill with a customer. It carries #54's
    reasoning, the spent second-factor option, and why the name was refused a
    second time.
  - A requirement for how the bill was served.
- **Update `supabase/tests/51_the_public_receipt_reader.sql`**: the full number,
  the name and the customer id still appear nowhere in the serialised receipt at
  any depth; the four digits appear only with a `customer_id`; a bill with a phone
  and no `customer_id` returns none.

### The counter view shows the same facts [owner, 2026-09-30]

The landing's `the-counter-views-the-receipt` trims the page for the counter's
pop-up (no Download PDF, no *Paid by*, no tax sentence), but promises the same
items, discounts and total, so the counter and the customer's link never disagree.
The digits and gold mark follow that promise: **all three renderings show them**.
The customer is the one looking at the tablet, and the biller already sees ⭐ on
the order card (#57).

## This is a two-repository change, and the release order matters

The SQL reader, the spec and the pgTAP suite are here. The Cloudflare Worker, the
page, its counter view, the PDF and `privacy/` are in the landing repository
(`C:\Users\iamro\Code\shawarmania`), as a sibling change there, as #54, #62 and #63
each had.

**The landing Worker currently refuses to serve a receipt that carries customer
data.** `worker/src/receipt.ts`'s `assertNamesNobody` walks the payload and throws
on any key named `customer_name`, `customer_phone`, `customer_id`, `customer`,
`biller_name` or `biller_profile_id`, **whatever its value**, so even
`"customer": null` trips it. If the ops migration shipped such a key first,
**every receipt link and every counter pop-up would be refused**, mid-service,
including the ones #63's Send receipt is already sending.

**Resolved in design D1: the new keys are not keys the live tripwire refuses**
(`phone_last4`, `gold_at_outlet`, `service_type`), so either repo
can release first and every receipt keeps rendering. The tripwire is widened, not
deleted: it still refuses a name or a biller by key, and now also refuses a run of
ten digits anywhere in the payload, which is the leak this change could actually
introduce.

What still orders the release is the privacy page: it must be live no later than
the Worker that prints digits (design D8). Per `no-pushes-while-the-counter-trades`,
the owner picks both windows.

## The published pages

- **`shawarmania.in/privacy/`** says the page *"names nobody — not your name, not
  your number, not even the last four digits of it."* The last clause becomes
  false. It changes **before** the receipt does, and the owner approves the new
  words. #62 already amended this page once, for points.
- **`shawarmania.in/messages/`** says the page *"names nobody, so it is safe to keep
  or forward."* **That stays true and does not change**: four digits and a gold
  mark name nobody. This matters because `/messages/` is the opt-in page filed
  with the messaging registration, and the DLT registration was in review on
  2026-09-29. If this change ever finds itself needing to reword `/messages/`, its
  scope has grown back toward a name, which is the thing refused above.

## Non-goals

- **No customer name, anywhere.** See *Why no name*.
- **The biller's identity stays hidden.** Not reopened.
- **No change to the WhatsApp message (#63).** It carries no name and no digits,
  and still should not.
- **No change to link issuance, revocation, or the identical-refusal rule** for
  unknown, malformed, revoked and switched-off links.
- **No indexing.** Nothing is invited to index a receipt, and that stays.
- **No receipt delivery.** Sending it is still
  [`bill-receipt-delivery`](../bill-receipt-delivery/proposal.md) (#59).
- **The access log still cannot identify the customer.** #54 requires it; putting
  digits on the page does not license putting them in the log.
- **No second-factor check.** The option is spent; do not build one on the digits.
- **The gold packaging waiver's wording.** It already renders by name, as *Free
  packaging · Gold member*, from the landing's `the-receipt-shows-points`. *(The
  first seed asked for it; it shipped with #62's sibling.)*
- **Points.** #62 put *Points (…)* and *Points used / earned / balance* on the
  receipt. This change adds beside them and must not move or re-derive them.

## Task ordering

Not UI-first with an owner checkpoint. The page gains a line or two in an existing
layout; the interesting work is the boundary, the release order and the spec
reversal.

1. **The spec amendment, argued, before the code.** The point of reversing a clause
   in writing is that the next reader finds the reasoning rather than an absence.
2. **The projection, the masking and the pgTAP suite**, here, not released.
3. **The landing Worker, tripwire, page, counter view and PDF**, in the other
   repository, not released.
4. **The release**, in the owner's windows: the ops migration at any time; the
   privacy page and the Worker together, the page no later than the Worker.
5. **Archive after real use** (`archive-only-after-production-use`). No archive
   order against #62 is needed (design D5).

## How to run the gate

On seeded bills locally, and against a local Worker:

- A bill with a customer, not gold: the digits, no mark.
- A gold member's bill: the digits and *⭐ Gold*.
- A gold member whose gold has since been revoked or expired: the old receipt still
  shows the mark.
- A skipped bill (no customer facts): neither.
- A bill with a phone and no `customer_id` (the pre-#56 shape): neither.
- Dine-in (with a table or without), takeaway, and neither: the service reads
  right in each, and no table ever appears.
- The page, `?view=counter` and the PDF agree in every case above.
- The function's **payload**, inspected rather than the rendering: the full number,
  the name and the customer id appear nowhere, at any depth.
- The landing Worker still refuses a payload carrying a name or a whole phone
  number, proved by a test.
- **The release order**: the new Worker serves an old-shape payload unchanged, a
  new-shape payload renders the new lines, and the **live** Worker's tripwire
  passes a new-shape payload.
- An unknown, malformed, revoked and disabled link are still refused identically.
- On a cheap Android phone at the width #54 targets.

## User-only gate steps

- 🧍 The owner opens a real receipt for a bill where a customer gave their number and
  confirms it reads as that customer's receipt. Waits for real use at Kalyani Cafe.
- 🧍 The owner shows a customer the receipt from the counter's View receipt and
  confirms the pop-up says the same.
- 🧍 The owner approves the privacy page's new wording, and it is live no later
  than the landing Worker that prints digits.

## Docs to update before archiving

Every first-read surface that says the receipt names nobody or shows no digits
(`corrections-go-to-every-first-read-surface`):

- [`docs/SECURITY_AND_PRIVACY.md`](../../../docs/SECURITY_AND_PRIVACY.md):
  *The control that makes every other risk small* (the name still, the digits no
  longer, the spent second factor); the points row in the data table (*"names
  nobody"*); the misdelivery note under #63.
- [`docs/SCREENS.md`](../../../docs/SCREENS.md): the public receipt's contents
  (*"not four masked digits"*), and the counter view.
- [`docs/LIMITATIONS.md`](../../../docs/LIMITATIONS.md): *A receipt link cannot be
  recalled*, and *The receipt page does not say how a bill was served*, which this
  change resolves.
- [`docs/OPERATIONS.md`](../../../docs/OPERATIONS.md): *"which is why the page names
  no customer"*.
- #63's `design.md` misdelivery note.
- In the landing repository: `privacy/`, `worker/README.md`, and the comment above
  `assertNamesNobody` in `worker/src/receipt.ts`.
