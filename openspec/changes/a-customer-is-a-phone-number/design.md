# Design: a-customer-is-a-phone-number

## The idea in one line

The phone is who the customer **is**, and their name is recorded with it. An
order taken without a number is called by its order number, as it already is.
Every decision below follows from that.

## Why the current field fails

`bill-composer-footer.tsx` presents *Customer name* and *Phone number* side by
side and accepts either, so one of the two must be filled before the bill can be
settled.

A biller types whatever makes the button go green. In production that is `As`,
`Kk`, `Jj`, `A`, `S` — 95% of 1840 bills carry a name of one or two characters,
and about 40% of them repeat within the same biller's own hour. The measurement is
in the proposal; the conclusion is that **the field is producing the junk that
`docs/BUSINESS_CONTEXT.md` warned a required name field would produce**, and that
none of it is a customer's name.

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
| skipped | `Skipped Customer Info`, or `Rahul · no number` for an order rung before this change | tap → dialog, ✕ → empty |

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
| snapshot name | `customer_name` | the customer's own name, when chosen or created |

A **skipped** order is `customer_id`, `customer_name` and `customer_phone` all
null. An order rung before this change keeps the name it was rung under, with
both other columns null. Both are rows the schema already accepts today.

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

## What the owner settled at the checkpoint, 2026-09-19

Section 2's stop, and it moved more than the sketch. Recorded here because #57
draws its ⭐ on this row and inherits whatever shape it ends up with, and because
two of these reverse decisions written above rather than filling gaps in them.

**The readout carries `+91` instead of a placeholder.** An empty readout reads
`+91`, which says a number goes here without a word of instruction, and it is the
one part of the number a biller never types.

**The match is a name over a number, with no heading.** `Returning customer` and
`Remembered customer` are gone: the biller is looking for a person, and a label
saying what kind of row this is pushes the one fact they want down the card. The
name is bold and the number sits small beneath it. The sync-age line survives,
because it is only shown when it is true, and a stale name given confidently is
worse than one given with its age.

**The row is the only control, and there is no clear action beside it.** A ✕ was
built and removed: it returned the row to *nothing chosen*, a state the biller
then had to leave again through the same dialog, so it was a tap that achieved
nothing. A decision is revised by making a different one.

**The dialog can be left without deciding.** A biller opens it expecting a
number and the customer starts changing their order instead; without a way out
the only exit is Skip, which records a decision nobody meant to make and would
have to remember to undo. Closing changes nothing — and nothing is lost by it,
because the undecided row keeps Order and Mark Paid disabled, so the bill cannot
be rung by accident. The disabled buttons are the reminder.

**A number saved for the first time must carry a name.** Enforced in the UI
only, columns still nullable. This is the moment the directory row is created and
it is the only moment: `customer_create_or_get` never rewrites a saved profile
from a till, so a row saved nameless stays nameless for good. It does **not**
apply to a customer who already exists without a name — they are identified by
their number, and completing somebody else's profile is not the counter's job.

**Enter saves.** The body is a real form, so a keyboard's Enter and a tablet
keypad's Go key both commit without reaching for the button; `enterKeyHint`
labels that key. Every key on the pad is a `type="button"`, so none of them can
submit it by accident.

**Skip is one tap and confirms nothing — and it stayed inside the dialog.** The
owner asked first for it to move out onto the composer, into the slot the clear
action occupies, and then reversed that within the hour on the reasoning this
design had already written down: a skip under the same thumb that taps Paid forty
times an hour is muscle memory inside a week. It lives in the dialog, reads
**Skip**, and takes effect immediately rather than swapping to a confirmation.
It is not called *No customer*: there is still a customer, and the thing being
declined is their number. The row reads `Skipped`. The row can be tapped again afterwards, so nothing about it is
final.

**A skipped order carries no customer facts.** The confirmation step that was
removed was also the only place a name could be typed without a number, so a
skipped order carries nothing at all, and the preparation card and the shift bill
list identify it by its order number.

**What the `As`/`Kk`/`Jj` strings are, settled by the owner on 2026-09-19:**
*"we don't rely on the labels today, they are ways to evade the customer info
blocker."* They are what a required field extracted from billers who had no
customer details to enter — exactly the outcome `docs/BUSINESS_CONTEXT.md`
predicted — and the business has never read them. An earlier draft of this
proposal built a feature to preserve them; it was dropped.

What survives is narrower and concrete: a `name` on the skipped variant, because
every order rung *before* this change carries a name and no number — all 1840 of
them — and reopening one to add an item must not wipe the name it was rung under.
The row says `Asha · no number` for those, which states which half is missing
without implying the name identifies anybody.

### A partial number, and why it is outlet-scoped

The proposal refused prefix search permanently, on the position that a
business-wide PII directory must not be browsable from a shared tablet. **The
owner's counter-proposal keeps that position and satisfies the requirement
anyway**, by splitting the question in two:

| Question | Scope | Answer |
|---|---|---|
| a partial number, four digits or more | **this outlet's own customers** | the one served most recently, plus a count of the others |
| a complete number | the whole business | `customer_lookup_by_phone`, unchanged |

This is better than what this design first proposed, and the reason is precise.
The objection to a global prefix search was never the tablet behind the counter —
a biller already sees every number they take. It was that `customers` is
business-wide **by design, for franchising**, so a prefix search at one
franchise's till would reach every other franchise's customers. An outlet scope
removes exactly that, and leaves behind only customers this counter has served
itself, which it already knew.

With the cross-outlet reach gone, the digit floor stops carrying the weight it
was carrying and can be set for the biller instead: **four**, which is about
where somebody expects a screen to react. A longer floor was buying protection
that the outlet scope now provides for free.

Three rules hold the shape, and a later change must not relax any of them:

- **one match or none, never a list** — a list is a directory;
- **the count of the others is a number and never a way to reach them.** It is
  text, not a control, and its whole job is to say *this is a guess, keep
  typing*;
- **the outlet comes from the caller's own authority**, never from an argument,
  so a till cannot ask about an outlet it does not work at.

**This depends on a link that does not exist yet.** "Customers this outlet has
served" is a join from the outlet's bills to `customers` through
`bills.customer_id` — the column no bill in production has ever carried, and the
repair this change makes in section 3. So the outlet-scoped function has nothing
to answer with until that link is populated, and the suggestion is silent rather
than wrong in the meantime. That is the correct order: the link first, the search
on top of it.

### IndexedDB is the offline fallback, not the source

The till's own `rememberedCustomers` cache answers a partial number **only when
the server cannot** [owner, 2026-09-19]. Online, the outlet-scoped function is
the source of truth; a cache read would go stale against a customer saved at the
neighbouring till ten minutes ago.

Falling back to it is safe rather than merely convenient: the cache holds numbers
this till already resolved, so it is a strict subset of what the outlet has
served — narrower than the server's answer, never wider. It cannot disclose
anything the tablet was not already told.

Two changes to how it is kept, both the owner's:

- **a rolling fifty, with no time limit**, replacing fifty-within-24-hours. The
  window was forgetting the weekly regular, who is precisely the customer worth
  remembering;
- **cleared when the tablet's enrolment is revoked**, because fifty names and
  numbers now sit on the device indefinitely and a tablet taken out of service
  should not still be carrying them.

### The pad settles before it asks

Every digit from the fourth to the tenth would otherwise be its own request —
seven per customer, on a path that carries a rate bound. The dialog waits a
quarter of a second after the last tap, which is under the gap between two
deliberate taps, so a number keyed straight through costs one request and a biller
who pauses mid-number still gets an answer as they do.

## Alternatives rejected

**Keep one field and validate it harder.** Rejected: the field is overloaded, so
stricter validation makes the junk harder to type without making identity more
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
