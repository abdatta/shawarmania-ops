# Design: a-customer-is-a-phone-number

## The idea in one line

The phone is who the customer **is**; the name is what this **order** is called.
Every decision below follows from separating those two.

## Why the current field fails

`bill-composer-footer.tsx` presents *Customer name* and *Phone number* side by
side and accepts either. The name is not only identity — it is printed on the
open-order card, the kitchen pipeline card and the shift bill list, so it is
**also the order's label**, and it is the only label there is.

A biller types whatever makes the button go green. In production that is `As`,
`Kk`, `Jj`, `A`, `S` — 95% of 1840 bills carry a name of one or two characters,
and about 40% of them repeat within the same biller's own hour, so they are not
distinguishing anything. The measurement is in the proposal; the conclusion is
that **most of this is evasion and some of it is labelling**.

Adding validation to the same field fixes neither. It would still be one box
asking two questions, and a stricter version of it pushes a biller from `Kk` to
`9999999999` — a junk global identity that can collide with a real person's number
and that nothing in the app can delete.

So the fix is two places for two facts, and a skip that is somewhere useful to go
rather than a hole to punch.

## Shape

### One row, three states

The two inputs become a single full-width control in the composer footer.

| State | Reads | Actions |
|---|---|---|
| empty | person-plus icon, `Customer` | tap → dialog |
| chosen | `Rahul · +91 98765 43210`, ⭐ when #57 lands | tap → dialog, ✕ → empty |
| skipped | `Rahul (label only)` | tap → dialog, ✕ → empty |

The red *"Add a customer name or phone to continue"* line is removed. A disabled
Paid button beside an untouched row is the message; a sentence under it is a
third way of saying the same thing.

### The dialog

Built as a `Modal`, sized and gridded like `PaymentDialog` and `DiscountDialog`,
which are the two controls a biller already uses without reading anything.

The pad is `1-9`, `00`, `0`, backspace — the same eleven keys as
`PaymentDialog`, minus the money semantics. **Ten digits is the only threshold in
the component.** Below ten, the resolution area renders nothing at all; it is not
a spinner, not a hint, not a greyed-out card. At ten, one of two things is true
and the area says which.

`shared/phone.ts` already canonicalises and validates against the same rule
`normalize_indian_phone()` uses in the database, and already refuses a leading
zero trunk prefix. **Nothing new is written here**; the dialog calls what exists.

A key detail: the Indian mobile rule accepts `[6-9]` then nine digits. A number
can therefore be ten digits and still invalid. The dialog treats that as *no
match, and no offer to save* — the same shape as an unknown number, because
offering to save an unsaveable number would produce a form that fails on submit.

### Skip

Skip swaps the dialog body for a single name input and a Done. The dialog does
not close and reopen; it changes what it is asking.

**Where skip lives is the load-bearing decision.** Inside the dialog it costs one
extra tap and reads as a choice. Beside the dialog, on the composer, it would sit
under the same thumb that taps Paid forty times an hour and would be muscle memory
inside a week — which is how `Kk` happened.

**Be honest about what this still does not fix.** One tap inside a dialog is
cheaper than the two keystrokes evading costs today, so nothing here makes the
number the easier path — it makes it the *less annoying* path, which is not the
same claim. The owner chose this knowingly on 2026-09-18, having ruled out every
enforcement mechanism on offer. What is expected to actually move capture is
`#57` giving the biller a reason to ask; see the proposal.

## What is written where

| Fact | Column | When |
|---|---|---|
| identity | `customer_id` | only when a customer was chosen or created |
| snapshot phone | `customer_phone` | the canonical `+91…`, when chosen or created |
| label | `customer_name` | always, when the biller typed one |

A **skipped** order is `customer_name` set (or null), `customer_id` null,
`customer_phone` null. That is a row the schema already accepts today.

**A chosen customer must write all three.** Writing `customer_id` alone would
leave `the-receipt-names-its-customer` (#58) with an id and nothing to print, and
would break the existing manager bill detail, which reads the snapshots.

### Who writes `customer_id`, and why it is not the client

**The server does, from the phone on the command.** The client keeps sending
`customerId: null` — not as a stopgap but as the design: a till cannot know a
customer's id for a number it has never seen, and a till that guessed one would
be guessing a primary key.

The billing functions call create-or-get with the command's `customerPhone` and
set `customer_id` from what comes back. The reasoning is in the proposal; the
implications for this design are three.

**Offline stops being a special case.** There is no offline branch to write. A
command carries a phone; whenever it drains, the link is made. A tablet that was
dark for a day settles into a correctly linked set of bills without the dialog
knowing anything about it.

**`saveCustomerIfComplete` stops being the persistence path.** It currently is
the only thing creating customers, over a bare network call with its failure
swallowed. After this change it is an **optimistic convenience at most** — it
warms the directory so the next lookup hits — and the sale's own command is what
actually persists the customer. If it is kept, it is kept for that reason and the
comment must say so. If it is dropped, nothing is lost.

**The bound must not sit in front of the money.** `customer_create_or_get`
checks `customer_lookup_exceeded` — 120 per caller per fifteen minutes. A drain
of several hundred queued commands would exhaust it and start refusing, and a
refusal inside a settle is a lost sale.

So the settle path resolves through an internal function carrying **no** bound,
while `customer_lookup_by_phone` — the interactive one, the one that is genuinely
an oracle over a ten-digit space — keeps its bound untouched. The asymmetry is
principled rather than pragmatic: resolving a number already written on the bill
in front of you discloses nothing you did not supply. **Write that reasoning into
the migration**, because the two functions will come to look alike and somebody
will want to merge them.

### Existing bills

Every bill already settled carries a name and a phone and a null `customer_id`.
Whether to backfill the link is a real question with a precedent: `#32` lifted
`bills_append_only` for exactly one narrow `customer_id` rewire, with the
narrowness argued at length in the migration, and put the trigger back
immediately.

That precedent permits a backfill; it does not require one. Decide it in the
implementation session with the production counts in hand, and record the
decision either way — an unbackfilled history means #57's figures begin from this
release rather than from the beginning, which is defensible but must not be a
surprise.

## The rule that must survive

`customer_create_or_get` **never rewrites a saved profile from a till**. A name
typed at the counter that differs from the saved one goes onto **this bill's
snapshot** and nowhere else. That is `global-customer-identity`'s rule, it is
enforced in the function and mirrored in the mock, and this change must not find
a convenient reason to relax it — the owner's rename path is #57's, from the
owner's own boundary.

## Offline semantics

The counter must not stop, and this dialog is directly in the path of a sale.

- **Lookup**: online, `customer_lookup_by_phone`. Offline, the adapter already
  falls back to `rememberedCustomers` on the resume record and marks the result
  `remembered: true`. The dialog keeps that distinction visible — the existing
  copy is *Remembered customer found* against *Returning customer found*, plus a
  line saying it will be checked again on sync. **Keep both, reworded to fit the
  dialog; do not collapse them into one.** A biller told a stale name confidently
  is worse than one told the read was old.
- **An unknown number offline** resolves to nothing, and the dialog must still
  let the biller **save and carry on**. `saveCustomerIfComplete` is already
  fire-and-forget beside the bill and must stay that way. Identity is helpful,
  never a condition of sale.
- **Rate limiting and refusals read the same as a miss** to the biller — *carry
  on with the bill*. `CustomerActionError` already distinguishes
  `rate_limited`, `not_permitted` and `failed`; the dialog must not leak which,
  because the difference is only useful to somebody probing the directory.
- The dialog issues **one lookup per complete number**, not one per keystroke.
  The existing effect already keys on the canonical phone; preserve that, because
  the per-caller bound is 120 in fifteen minutes and a per-keystroke lookup would
  spend it on one customer.

## Money

No total, discount, tender or rounding changes. If a task in `tasks.md` finds
itself editing `billTotals()`, the scope has drifted.

One money-adjacent rule does apply, and it is the sharpest constraint in the
change: **nothing about identifying a customer may refuse a sale.** The resolve
happens inside the settle path, so a failure there is a failure to take money. It
must not be reachable by a rate bound, by a malformed phone (which cannot arrive,
since the dialog canonicalises before it writes), or by a directory that is
briefly unavailable. A command whose customer cannot be resolved must still
settle, carrying its snapshots and a null `customer_id`.

## RLS

**No policy changes, and none are wanted.** One internal function is added — the
unbounded resolve described above — and it must be `security definer`, revoked
from `public`, `anon` and `authenticated`, and callable only from inside the
billing functions. It is not a client surface and must never become one.

Otherwise: `customers` is revoked from every
client role, RLS is on with zero policies, and the only way in is the two
security-definer functions. This change calls them; it does not widen them.

Specifically, and to be checked at review rather than assumed:

- no new grant on `public.customers`;
- no browse, prefix, fuzzy, list or count path is created anywhere, including in
  the mock, which enforces the same three rules the database does;
- the rate bound, the attempt table and its no-phone-columns rule are untouched.

## Alternatives rejected

**Keep one field and validate it harder.** Rejected: the field is overloaded, so
stricter validation makes the label harder to type without making identity more
likely. It would push billers from `aaa` to `9999999999`, which is strictly
worse — a junk global identity that can collide with a real person's number, and
there is no delete or merge path in the app by design.

**A per-outlet `require_customer_phone` setting.** Rejected by the owner. The
composer gate is enough, and a setting is a second thing to be wrong. Accepted
consequence: this ships to every counter at once rather than staged behind the
new outlet.

**Skip records a reason, from a dropdown.** Rejected by the owner. The first
option gets picked every time, and the data would be worse than nothing because
it would look like signal.

**Count and report the skip rate.** Rejected by the owner. Originally proposed as
the soft enforcement mechanism that replaces a hard rule; cut as unnecessary
ceremony for v1, and the decision was **reaffirmed on 2026-09-18 after the
production measurement showed evasion to be the dominant behaviour** — so it was
declined with the evidence in hand, not for want of it. Nothing here prevents
adding it later: the fact *"this bill identified nobody"* is already in the data
as a null `customer_id`.

**A `customer_id` derived from the phone, by hash or any other one-way
function.** Proposed 2026-09-18 and refused, for four reasons that compound.

*It is not one-way in practice.* An Indian mobile is ten digits opening 6–9 —
about nine billion possibilities, roughly 2³³. That whole space hashes in seconds
on ordinary hardware, once, into a lookup table, after which every id in the
database reverses to a phone number instantly. Passwords resist cracking because
their space is enormous; a phone number's is small, fully enumerable and of known
format.

*A salt cannot rescue it.* The id has to be derivable from the phone alone or the
server could not compute it during the resolve above, and derivable from the phone
alone means no per-row salt. A single secret pepper is stronger, but it has to
live where the database can reach it — and the threat model that matters here is
somebody holding the database. It is also unrotatable: change the pepper and every
id changes, so every foreign key breaks.

*It defeats one of the reasons the id exists.* A phone can be mistyped. A separate
id is what lets the number be corrected while every bill keeps the snapshot it
recorded. An id derived from the phone changes when the phone is corrected, and
every row referencing that customer is orphaned.

*It would put the phone back in every table, disguised.* The id is kept precisely
so phone numbers live in **one** table. A reversible derivation of the phone,
copied into membership rows and anywhere else that references a customer, is the
phone number in those tables — except now it looks safe, so people stop being
careful with it. PII that looks like it is not is worse than PII that obviously
is.

**This repo has refused this exact argument once already.** The
`customer_lookup_attempts` table stores who asked and when, and `#32`'s migration
says why it stores no phone: *"not raw, not hashed. A hash of a ten-digit number
is reversible in seconds, so 'we hashed it' would be a claim of privacy rather
than privacy."* The id is `gen_random_uuid()` and stays that way — genuinely
unlinkable to a person without the one table that is locked behind two
security-definer functions.

**Prefix or name search at the till.** Rejected, permanently, and not a matter of
configuration. `global-customer-identity` was built on the position that a
business-wide PII directory must not be browsable from a shared tablet, and the
absence of that path in the database is the guarantee. A till may only ever ask
about a complete number it was told.

**Extract a shared keypad component from `PaymentDialog`, `DiscountDialog` and
this one.** Not rejected, but deliberately not required. Three call sites with
different semantics (money, percent-or-rupees, digits) is the point at which an
abstraction becomes arguable rather than obvious. Whoever implements may extract
one if it falls out cleanly; they must not restructure the two live dialogs to
force it, because both are on the money path and this change is not.

**Make the dialog a route rather than a modal.** Rejected for the same reason
#57 rejects it for the owner's card: a URL naming a customer is a pasteable
piece of PII, and the counter has no use for deep-linking into a lookup.

## Task ordering, and why it is written into `tasks.md`

The owner has asked to **see the UI in demo and iterate on it before anything is
committed underneath it.** That is this repo's stated delivery model applied
inside one change rather than across a `ui-*` / `*-live` pair.

Section 1 therefore builds the dialog and the composer row against the **mock
adapter only**, walkable at `/demo` as a Biller, with no real adapter work, no
migration and no spec delta finalised. Section 2 is the owner's checkpoint and it
is a hard stop. Only then does the change wire the real path.

A session that starts at the database has ignored the one instruction the owner
gave about how this change is to be run.
