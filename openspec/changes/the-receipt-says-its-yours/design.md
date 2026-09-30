# Design: the-receipt-says-its-yours

Read [`proposal.md`](proposal.md) first. It records what the owner decided on
2026-09-30 (the last four digits and gold, never a name) and why the name was
refused. This file is how.

**No RLS policy, no new table, no money arithmetic, no offline semantics.** One
function, `bill_public_receipt`, is replaced with a wider projection. It is still
`security definer`, still executable by `service_role` alone, and still takes one
token and nothing that could name another bill. It reads four columns every bill
already carries (`customer_id`, `customer_phone`, `customer_tier`,
`service_type`) and computes no figure. Nothing at the counter,
in the outbox or in the app changes; the app never calls this function.

## D1. Three new keys, named so the live Worker cannot trip on them

```jsonc
{
  // … everything the receipt already returns, unchanged …
  "phone_last4": "0042",        // or null
  "gold_at_outlet": true,       // false when not
  "service_type": "dine_in"     // "takeaway", or null
}
```

The landing Worker's `assertNamesNobody` refuses to serve a payload carrying any
key named `customer_name`, `customer_phone`, `customer_id`, `customer`,
`biller_name` or `biller_profile_id`, at any depth and whatever its value. None of
the four keys above is one of those, and the live Worker's content model reads
only the keys it knows. So:

- **The ops migration can release before the landing Worker**, and every receipt
  keeps rendering exactly as it does today: the new keys are ignored.
- **The landing Worker can release before the ops migration**, and every receipt
  keeps rendering: the new keys are absent, which the new Worker reads as none.

That removes the ordering hazard the proposal found. The proposal's *landing
first* was a way of surviving a payload the live Worker would refuse; the better
answer is a payload it does not refuse. What still orders the release is the
privacy page (D8), not the code.

**Rejected: a nested `customer` object.** It reads naturally and it is exactly the
key the live tripwire refuses, so the first ops release would have refused every
receipt and every counter pop-up until the Worker caught up. Two repositories, two
owner-picked windows and a gap between them is not a gap to bet the receipt on.

**Rejected: `holder`, `yours` or any other object wrapping the two facts.** An
object suggests a place where more of the customer belongs. Two flat keys whose
names say exactly what they are leave nowhere for a name to be added "while we
are here".

## D2. The facts appear only on a bill with a customer attached

```sql
'phone_last4', case
  when b.customer_id is not null
   and length(regexp_replace(coalesce(b.customer_phone, ''), '[^0-9]', '', 'g')) >= 4
  then right(regexp_replace(b.customer_phone, '[^0-9]', '', 'g'), 4)
end,
'gold_at_outlet', (b.customer_id is not null and b.customer_tier = 'gold'),
```

- **`customer_id`, not a date.** Every bill rung before #56 has a null
  `customer_id` (the #56 migration records that no row had ever been linked), and
  since #56 the server sets it exactly when the sale carried a number. A cut-off
  date would be a second way of saying the same thing that disagrees with it at
  the edges: a command queued offline before #56 and drained after it.
- **The one real pre-#56 bill with a phone** (production, 2026-09-30) has no
  `customer_id`, so it shows nothing. It is the case the pgTAP suite pins.
- **Digits are read from the bill's snapshot**, `bills.customer_phone`, never the
  directory. A number corrected or removed in the directory later does not rewrite
  a receipt, and the directory is not joined at all.
- **Non-digits are stripped before taking four.** Since #56 the snapshot is the
  canonical `+91XXXXXXXXXX`, so this is belt and braces; but `+` and spaces must
  never be counted as digits, and fewer than four digits returns null rather than
  a short or padded string.
- **`[^0-9]`, not `\D`.** The operations runbook records the trap: a `\d` written
  through a client's string escaping reaches the engine as a bare `d`. A character
  class has no escape to lose.

**Rejected: masking in the Worker.** #54's principle is that what the page may
not show, the function does not return. The full number crossing the boundary
and being trimmed by a renderer would put the only protection in the one place a
future edit is most likely to undo.

## D3. Gold is the bill's snapshot, named for what it means

`gold_at_outlet` is `bills.customer_tier = 'gold'`, and nothing else:

- **Snapshot, not live.** `customer_tier` is written at the moment of sale by
  `bills_snapshot_customer_tier` (#57, made per outlet by #62) and refused changes
  by the append-only trigger. A spell revoked or expired tonight leaves lunch's
  receipt saying gold, which is what lunch was.
- **At the bill's own outlet.** Since #62 the snapshot reads the membership at the
  sale's outlet. The page words it *⭐ Gold* and nothing more [owner, 2026-09-30]: the receipt's own
  `outlet.name`, so the mark and the outlet it names cannot disagree.
- **A boolean, not the enum.** The receipt needs one yes or no. Passing
  `customer_tier` through would name a column whose other values (none yet) a
  renderer would have to decide how to print.

## D4. How the bill was served

`service_type` is returned as the bill stored it (#60). A bill before #60, or at
an outlet that chose neither, returns null and the page says nothing. The wording
(*Dine-in*, *Takeaway*) is the renderer's, in the landing content model, like
every other label.

**Never the table number** [owner, 2026-09-30]. A table is a label for the length
of a meal, like the day's order number, and the receipt shows neither: it says
nothing a customer keeps a receipt for. It is not returned at all, rather than
returned and left unrendered. *(This change first returned `table_number` and
printed *Table 4*; the owner dropped it before release.)*

## D5. The spec keeps the requirement's name

`public-bill-receipt`'s *The public receipt names no customer* is **modified, not
renamed**. After this change it still names no customer: no name, no full number,
no biller, no till. What it now permits is stated inside it (the last four digits
and the gold mark, only for a bill with a customer), with #54's reasoning, the
spent second-factor option, and why the name was refused a second time.

**#62's points requirement needs no delta.** Its clause, *"the receipt SHALL
continue to name no customer"*, stays true under the modified requirement, because
the modified requirement defines what naming is. So this change does not wait on
#62's archive for its spec to merge. *(The proposal expected a delta against that
requirement, and an archive-order constraint to go with it. Neither is needed.)*

A new requirement, *The receipt says how the bill was served*, carries D4.

## D6. The access log, unchanged

`bill_public_link_views` records the token, the time, a salted digest and a user
agent, as before. Putting four digits on the page does not license putting them in
the log, and the column-list assertion in `51_the_public_receipt_reader.sql` still
fails by name if anybody tries.

## D7. The landing Worker (the sibling change)

Built in `C:\Users\iamro\Code\shawarmania` as `the-receipt-says-its-yours-page`,
the child half of this pair, as #54, #62 and #63 each had one. Summarised here
because the two halves must agree:

- **The content model** (`worker/src/content.ts`) gains a service line and a
  holder line: *Dine-in*; *+91 ••••• •0042*; *Gold*.
  The page and the PDF draw only what it says, and the agreement test holds them
  to it over new bill shapes.
- **The star is presentation.** Nunito Sans carries `•` and no `⭐`, and a PDF has
  no emoji fallback, so the content string is *Gold*: the page puts
  an emoji before it, the PDF draws a small vector star in the gold it already
  uses for giveaways. The same arrangement the agreement test already allows for
  the cancelled banner, which one renderer shouts with CSS.
- **All three renderings show them**: the customer's page, the counter view
  (`?view=counter`) and the PDF [owner, 2026-09-30].
- **The counter view and the link say the same thing** [owner, 2026-09-30]. #63's
  counter view had trimmed the page; the owner asked for the two to match. Both
  now take the counter's layout (bill number and time on one row, the tighter logo
  gap, no "not a tax invoice" sentence, also dropped from the PDF) and both show
  *Paid by*, because both specs require the payment split on the receipt and the
  link is the customer's record of how they paid. The counter view differs only
  in having no Download PDF, even spacing at the foot, and its height report.
  **Rejected: the counter's version exactly**, which would have dropped *Paid by*
  from the link too, against both specs.
- **A tidier foot on all three renderings** [owner, 2026-09-30]: *Paid by* as a
  plain line, not a box; the points a bill used said once, as its *Points (N)*
  discount row; *+14 pts earned* and *Balance: 96 pts* on one line (*pts* because
  *points* wrapped on a 320 px phone); and the small print signed with the bill's
  own outlet. #62's `public-bill-receipt` requirement (*show the points it used,
  earned and the balance*) still holds without a delta: the used points are the
  discount row.
- **One row at the top** [owner, 2026-09-30]: *Bill 46 · Takeaway* at the left,
  *30 Sep 2026 · 7:05 pm* at the right, in that 3-letter-month, 12-hour form to
  match the ops app. It fits one row from 360 px up (measured, to a five-digit
  bill); on a 320 px phone the date and time wrap whole to a second line, right
  aligned. *(An intermediate version dropped the time of sale and printed the
  table in the middle of the row; both were reversed before release, so #54's
  requirement naming the time is untouched.)*
- **The tripwire is widened, not removed.** It still refuses a name or a biller by
  key. It now also refuses any string value in the payload carrying a run of ten
  or more digits, which is the shape of the leak this change could actually
  introduce, and a `phone_last4` that is not exactly four digits.

**Rejected: replacing the key tripwire with the digit check.** The key list is
what would catch a name, and a name is the one thing this change refused. Both
stay.

**Accepted cost of the digit check:** a manager who types a phone number into a
void reason now gets that receipt refused rather than printed. That receipt would
otherwise publish a number on a bearer-token page, so refusal is the right
failure, and it is visible (the Worker logs `ReceiptNamesSomebody`).

## D8. The release

1. **Ops migration** — any time the owner picks. Nothing renders differently.
2. **Landing, in one push and one deploy the owner picks**: the privacy page's new
   words, then `npm run worker:deploy`. The privacy page must be live no later
   than the Worker that prints digits, because it is the page that currently
   promises *"not even the last four digits"*. `/messages/` is not touched.

Per `no-pushes-while-the-counter-trades`, nothing here is pushed or deployed by the
session that builds it.

## Rejected alternatives, in one place

- **The customer's name**, whole or first-name-only: refused by the owner; see the
  proposal's *Why no name*.
- **A nested `customer` object**: D1.
- **Masking in the Worker**: D2.
- **Gating on a date**: D2.
- **Passing `customer_tier` through**: D3.
- **A delta against #62's points requirement**: D5.
- **Dropping the key tripwire**: D7.
