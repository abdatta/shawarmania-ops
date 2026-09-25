# Design: a-gold-member-is-a-label

## What this is, and what it is not

It is **a word beside a name**, granted by a person, readable at the counter.

It is not a programme. There is no points balance, no earning rule, no automatic
benefit and no expiry. Every one of those was considered and deferred, and the
reasons are below so the next person does not re-derive them.

## Global, not per outlet

The decision, and the argument, in the order it actually ran.

The business is **consolidating to a single outlet** for the next six to twelve
months before franchising is revisited. So for the whole life of v1, a per-outlet
membership would carry one outlet id on every row and the isolation it claimed
would be **unverifiable** — you cannot prove a boundary holds when the dimension
has one value.

Beyond that:

- `customers` is **already** global, keyed on canonical phone, with no
  `outlet_id`. An outlet-scoped membership hanging off a business-wide identity
  is two models arguing; global membership on a global customer is one.
- *"You are a Shawarmania gold member"* is a **brand** promise. Being a member at
  one shop and not another is an internal accounting concern surfacing on a
  customer-facing label.
- The franchise objection — *a franchisee will not want to honour a benefit they
  did not grant and are not paid for* — is real and **does not bite while
  membership is a label**. Nothing is automatic; the person serving decides what
  to give. By the time it bites, a franchise agreement is being drafted and there
  is information to decide with that does not exist today.

### The move that makes global safe

**The tier is snapshotted onto the order and the bill**, and a bill belongs to an
outlet. So *"how many member orders did this outlet serve, and what were they
worth"* is answerable from that outlet's own bills, under a global membership
model, with no per-outlet membership anywhere.

Per-outlet **reporting** without per-outlet **modelling**. The franchisee's real
question is the number, not the model.

### If this turns out wrong

`alter table … add column outlet_id`, plus one backfill decision — grandfather
everyone, or pin each membership to where it was granted — made with a year of
real information. The opposite mistake pays for a year of complexity first to
reach the same place. The asymmetry decided it.

## Records, not a flag

A membership table carrying `customer_id`, `granted_at`, `granted_by`,
`revoked_at`, `revoked_by`, and a reason column this change leaves unused. Current
state is derived.

**Why not a boolean on `customers`.** Because an automatic appointment rule is
anticipated, and a rule that flips a bit leaves nothing behind that says why
somebody is a member, when they became one, or who disagreed with the rule. A row
does. The reason column is written now and used later for exactly that.

**Revocation is a row, not a deletion.** When the automatic rule arrives it will
need to know that a human took this membership away, so that it does not hand it
straight back. Deleting the grant would destroy the only fact that could stop it.

**Re-granting is normal**, and the card reads *member since* the newest grant.
Earlier spells stay in the table and appear on no screen **in this change**.

**The history is kept so it can be shown later** (owner, 2026-09-24). The owner
expects a future view answering *was this person ever gold, and when* — and it
needs nothing more than this change already stores: every spell with its grant
and its end, never deleted, plus the tier snapshotted on every order and bill,
which says which visits were made as a member. Building that view is a later
change; losing the data it needs is the only mistake this one could make, and
the records-not-a-flag design is what prevents it.

## The tier snapshot

`customer_tier` on `orders` and `bills`, written at creation, in exactly the
spirit of `unit_price_paise` on a line and the basis on a discount.

This is not a cache. A live join would be wrong in four separate ways:

1. it would **flicker** if a membership were revoked mid-shift, changing cards
   that are already being worked;
2. it would **not work offline**, and the counter must not wait on a membership
   read to draw a ticket;
3. it would answer *is a member now* when the kitchen is acting on *was a member
   when they ordered*;
4. it would make a year-old receipt rewrite itself, which is what #58 depends on
   not happening.

The honest description is that membership at the moment of sale is **a fact about
that sale**, like the price charged.

## The owner's surface

### A modal, not a route

`/owner/customers/:id` would be **a pasteable URL naming a real person with their
phone number attached** — in browser history, in a chat message, in an address-bar
autocomplete on a shared laptop. Every other PII surface in this app is reached by
an action rather than an address, and this one should not be the exception.

Supporting reasons: the owner is on a phone, the interaction is about ten seconds
long, and a route would need a gate-registry entry, a navigation decision and a
back-button story for a screen nobody navigates *to*.

**Modal-over-modal is already solved.** `Modal` is built on the native `<dialog>`
element and its `onClose` deliberately stops propagation — the comment records the
real bug it fixes, where dismissing an explanation opened over the cash count
sheet closed the count sheet and lost everything typed. `ConfirmDialog` composes
it. The confirmation here is reuse.

### The card

```
  Rahul Sharma                       ✎
  +91 98765 43210
  ⭐ Gold member since 12 Aug 2026    ⊘
  ─────────────────────────────────
  Last 30 days
  14 visits              ₹9,240

  Last seen            14 Sep
  Customer since       12 Mar 2026
  ─────────────────────────────────
```

Three rules it is built on:

- **Status rows, not buttons.** Name and membership each read as a line of text
  with one small icon-only control beside it. There is no action button at the
  foot of the card, because the card is a thing to read with two things that can
  be changed in place.
- **The icon shows the action, not the state.** The pencil means *edit*, not
  *this is a name*; so the membership control shows a star to grant and a crossed
  star to revoke. The text row already carries the state, which is what frees the
  icon to carry the verb.
- **Both directions confirm, identically.** Asymmetric confirmation — one way
  asking and the other not — is where people mis-tap.

The `+91` prefix is shown so the number is unmistakably a phone number rather
than a reference.

### Searching by name or part of a number

Settled 2026-09-24. The first sketch was complete-phone only, carried over from
the counter's rule, and the owner asked the right question: why can they not
search their own customers by name? The counter's rule exists because a till
listing the business-wide directory is a leak across outlets. The owner is not
across any boundary — they read every bill at every outlet already — so a name
search discloses nothing new to them.

One box takes either. Anything with a letter in it matches anywhere in the saved
name, ignoring case. Digits (spaces, dashes and a pasted `+91` tolerated) match
anywhere in the ten-digit number, so the last few digits somebody remembers are
enough. **Three of either** starts a search (owner, 2026-09-24) — one minimum, so
nobody has to remember which kind needs how many. At most twenty results, most recently seen
first, with a count of the rest and no way to page past it: the way to the rest
is a longer query. While a search is on screen the two lists step aside, and the
part of each result that matched is bold.

**A loose fallback, for names only** (owner, 2026-09-24). When the exact name
matches leave room under twenty, the same letters **in order with gaps** fill it —
`mmta` finds `Moumta` — and always rank below every exact match, so a name typed
correctly is never pushed down by a near-miss. Not for numbers: three digits in
order occur somewhere in most ten-digit numbers, so a loose number match would
answer with nearly everybody. One module (`src/domain/customer-search.ts`) holds
the rule, and both the adapter's matching and the screen's bolding read it.

**The limit that stays:** names were typed at a counter, so some are misspelt and
some customers never gave one. The number search is what finds those.

### Finding somebody without their number

Settled 2026-09-23. Exact-phone search alone would leave the owner unable to find
the people this feature is for: they decide to make somebody gold because they
notice them coming back, and nobody knows a regular's number by heart. So the
surface opens on **two lists** that need no typing, as two tabs with Regulars
first (owner, 2026-09-24):

- **Regulars** — everybody seen in the last thirty days, however few their visits,
  each row carrying its visit count; most visits first, ties to the most recent
  visit, then the customer id so the order is total.
- **Gold** — everyone holding a membership now, newest grant first, then id.

**Paged, not bounded.** Each loads twenty rows and the next twenty as the reader
nears the bottom — the sentinel the Delivery run history already uses. The first
version capped regulars at twenty and drew every member above them; with the
thirty or forty members the owner expects, that pushed the regulars off the phone
screen. Neither tab carries a count (owner, 2026-09-24): Regulars is everybody seen
this month and Gold is everybody who is gold, so a number would only restate the
length of the list below it. A change on a card is laid over the rows
already on screen rather than reloading them, so the owner is not thrown back to
the top of a list forty names down. The thirty days are rolling, not the calendar
month, so the list does not empty on the first of the month.

Both are derived at read time under the owner's authority, like the card. They are a browse path, which is **the reason they exist only
at the owner's boundary**: the owner already reads every bill at every outlet, so
a ranking of customers by visit discloses nothing they could not already sum. No
counter gains a list, and the two functions stay two.

A row shows the name, the phone and — on the regulars list — the thirty-day visit
count, with the member mark where it applies. Spend is on the card only; a list
of people ranked by money is a different and less comfortable screen.

### Correcting a name

A name can be **corrected and never erased** (owner, 2026-09-23). The tick is
disabled while the input is blank. It is `#56`'s first-save rule seen from the
other side: a profile without a name is a number nobody can recognise on the
lists above.

### The statistics

**Thirty days, not lifetime.** A lifetime total makes a customer who stopped
coming in January look identical to one who came in yesterday, and the membership
question is *are they a regular now*. Only **Last seen** and **Customer since**
are all-time, because those two are about the relationship rather than its
current temperature.

**One bill is one visit** (owner, 2026-09-18). Counting distinct days was
considered and rejected as a complication the counter does not produce: a customer
who keeps ordering does not pay repeatedly — the biller unticks **Prepared**,
edits the open order with the extra items, prepares again, and the occasion settles
as **one bill**. Repeat ordering already collapses into one bill, so counting bills
is both simpler and closer to what a visit means here.

**Voided bills count for nothing**, in either figure. A void means it did not
happen.

**No outlet split.** It is the most interesting line on the card for an owner and
the most dangerous for anybody else. Dropping it means a Franchise Admin card, if
one is ever built, is the *same* card counting only their own outlets — rather
than a second, censored variant that has to be kept correct forever. The
simplification was the owner's call and it buys more than it costs.

**Where they come from, and the thing that had to be fixed first.** The figures
join bills to a customer. Until `#56`, `bills.customer_id` was **null on every
bill ever written** — the column, the foreign key and the payload field all
existed and every caller passed `null`. This card would have read `0 visits,
₹0` for everybody. `#56` makes the server resolve the link from the phone the
command carries; this change depends on that and should not attempt to work
around it.

Two consequences for this card:

- `#56` decided **not** to backfill existing bills (one historical bill carried a
  phone; lifting `bills_append_only` for it was out of proportion). So these
  figures begin at `#56`'s release on 2026-09-22 rather than at the beginning of
  trading. Thirty days is a short enough window that it stops mattering within a
  month, but it must be said before the card is believed.
- the join is on `customer_id`, not on the snapshotted phone. Both would work
  arithmetically; the id is right because it survives a corrected number and
  because a membership row keyed on a phone would put PII in a second table.

### The rule that keeps the statistics safe

**Derived at read time from bills, under the reader's own authority. Never stored
on the customer row.**

The reasoning matters and should not be compressed: outlet isolation protects
outlets from each other, **not the owner from their own business**. The owner
already reads every bill at every outlet. So showing them a customer's recent
visits leaks nothing new.

But the moment an aggregate becomes a **column on the global profile**, it is one
careless widening of the billing lookup away from a shared tablet. `#32` removed
`bill_count` and `total_spend_paise` from that table for precisely this reason.
They must not come back under a new name.

## The manager's view

Added 2026-09-24, when the owner chose to build it in this change rather than
later. It is the **same surface and the same card**, which is what dropping the
outlet split bought — scoped to the outlets the manager's assignments name:

- **Who they can find:** only customers their outlets have served — search, both
  lists and the card. A customer of another outlet answers exactly as a customer
  who does not exist.
- **What the card counts:** only their outlets' bills. *Customer since* becomes
  *First visit here*, because the business-wide date would say when somebody
  first bought at another shop.
- **What they can change** (owner, 2026-09-24): name and gold, **only while every
  outlet the customer has ever been served at is one of theirs.** A customer who
  also buys elsewhere is read-only to them, with one sentence saying why. The
  server decides it from the customer's whole history and decides again at the
  moment of the write, so a customer who visits a second outlet between the card
  opening and the tap is refused rather than changed. The owner can change
  anybody.

**The price, stated once:** a read-only card tells a manager one fact about
another outlet — *this customer also buys somewhere else*. Not where, not when,
not what. It is the unavoidable shadow of the rule, and the owner accepted it with
the rule.

**Latency and upkeep** (asked by the owner, 2026-09-24). The counter's path is
untouched by any of this. The manager's reads are the owner's reads with an outlet
filter, so they read fewer rows, not more. And the filter is written **once**: a
single "which bills may this reader see" rule sits under search, lists, figures,
last seen and first visit, so no read can forget it and there is no second copy to
drift.

**One known gap, from the consolidation.** The replacement outlet opens under a new
outlet id, so a manager assigned only to it sees nobody at first — the history sits
under the two closing outlets. The owner sees everybody throughout.

## RLS and the boundary

**The membership table is global, like `customers`, and is therefore the same
kind of exception** — which means it gets the same treatment rather than a
lighter one:

- revoked from `authenticated` and `anon`, RLS enabled with no policy, reachable
  only through security-definer functions. Two independent statements of one rule,
  which is what `01_schema_coverage.sql` requires of a table it cannot classify as
  outlet-scoped.
- **Two separate authority checks, as `#32` established**: the owner's grant and
  revoke path checks owner authority; the biller's read gets membership through
  the existing `customer_lookup_by_phone`, which checks
  `app_may_look_up_customer()`. Neither may be widened by widening the other. The
  separation is the whole reason `#32` wrote two functions instead of one with a
  role branch.
- the **rate bound is untouched**, and the attempt table still records who asked
  and when and never what was asked.

The snapshot columns on `orders` and `bills` are outlet-scoped rows and inherit
those tables' existing policies. They add no table and therefore no new isolation
surface — but the isolation suite should still be extended to prove a neighbouring
outlet cannot read a member's order through them.

### The widening, and its price

`global-customer-identity` said the billing response carries *"only customer ID,
canonical phone, and saved billing name"*. It now carries membership too.

**The price, accepted by the owner on 2026-09-18:** a biller at one outlet can
learn that a customer who has only ever shopped at another is a member. If
membership tracks spending, that is a weak signal about trade across the boundary.

It is small, it is worth it, and the spec says so out loud. A widening that
arrives without its cost written down is how the next one gets easier.

**The partial-number suggestion carries the same field.** `#56` shipped
`customer_suggest_at_outlet`, which answers four or more digits with the one
customer this outlet served most recently. It returns an identity too, so without
the mark a member found that way would arrive unmarked — and a biller who taps
the suggestion is the common case, not the edge. Its disclosure is strictly
smaller than the exact lookup's: it can only reach somebody this counter already
served.

`#56` also left the living `global-customer-identity` spec saying no outlet role
may have *any* prefix path, which its own suggestion contradicts. This change
rewrites that requirement anyway, so it states the outlet-scoped exception and
its reason there instead of leaving the contract behind the code.

## Money

**None, deliberately.** No total, discount, tender or rounding is computed from
membership. A member's bill and a stranger's identical bill come to the same
figure unless a biller applies a discount by hand.

**The accepted cost, stated once:** a discount given by hand to a member is
indistinguishable in the ledger from any other biller discount. *"What did
membership cost us in October"* is unanswerable for this period. A `membership`
discount source was proposed as a cheap hedge and **cut by the owner** — correct
for a label, and worth reviving the day membership becomes automatic, because
bills are append-only and attribution cannot be retrofitted onto settled ones.

## Offline

The counter reads membership from **what it already holds**:

- an identified customer's tier arrives with the lookup, including from the
  resume record's remembered customers;
- the mark on a pipeline card comes from the **order's own snapshot**, so it is
  correct offline by construction and needs no read at all;
- a customer never seen by this tablet cannot be resolved offline, so the order
  is drawn with no mark until the server's snapshot comes back. The biller carries
  on; identity is helpful and never a condition of sale.

### What the sale records: the membership at the moment of sale

Settled 2026-09-24, and it replaced the rule this section first carried.

**The server writes it, from the history, for the instant the sale was rung.** A
trigger on `orders` and `bills` calls `customer_tier_at(customer, instant)` with
the command's own `created_at`, which the server already bounds. A sale delivered
hours after it was rung offline records what was true while the customer stood at
the counter. A bill settling an order copies the order's. A revision keeps an
order's tier while it names the same customer. Nothing a tablet sends can set it —
the order guard refuses a write that names it — so there is no forgery to defend
against, and the command payload did not change.

**What was replaced, and why.** The first rule (owner, 2026-09-18) recorded no
membership for a sale rung offline for a member the tablet had never seen and
paid on the spot, on the reasoning that a bill states what the counter knew.
Implementing it needed the tablet to send what it knew, and the command boundary
checks an exact key set named by the version — so it meant a third payload
version with both shapes accepted, as #53 needed, on the money path. The owner
chose the moment-of-sale rule instead, knowing the one case it changes: a member
not among the tablet's remembered customers, paying immediately while the tablet
is offline, now has the star on that bill though the counter did not show it.

**The tablet's star before the server's.** A sale still in the queue is drawn with
what the tablet was last told about that customer, from the customers it resolved
itself; the server's snapshot replaces it on the next read.

**It also means the member mark is not a money fact and must never become one.**
Nothing is computed from it, which is what makes a label written this way safe.

## Alternatives rejected

**A boolean on `customers`.** Simplest possible, and rejected: it forgets how it
got there, which is exactly what an automatic rule will need to know.

**Per-outlet membership.** Argued above.

**Automatic appointment in this change.** Deferred. The table is shaped so a rule
writes rows with reasons rather than fighting a flag, and the open question a rule
must answer — what happens when a human grant and a rule disagree — is recorded in
the loyalty todo rather than guessed at here.

**An automatic discount, and a `membership` discount source to attribute it.**
Cut by the owner for v1. Recorded above with its cost.

**Keying membership on the phone instead of on `customer_id`.** It would work
arithmetically and would have removed some machinery from `#56`. Refused because
it puts a phone number into a second table, and the whole reason the id exists is
that customer phone numbers live in exactly one. The related idea of deriving the
id *from* the phone by hashing is refused at length in `#56`'s design — a
ten-digit space is enumerable in seconds, so it would be the phone number in every
table wearing a disguise.

**Granting from the biller's side.** Possible later; not now. The owner grants
from their phone, and a till that can create members is a different privacy and
authority question.

**Tiers beyond gold.** Nothing ships with a second tier. The model should not make
one hard, but inventing silver now would be inventing a rule nobody has asked for.

**A route for the customer card.** Argued above.

**A lifetime or a spend-ranked list.** The regulars list ranks by thirty-day
visits because the question is *who comes back*, and a ranking by money reads as
a league table of customers. Spend stays on the card, one person at a time.

**Showing the membership history on the card.** Rejected: the record exists for a
future rule to reason with, not for browsing. Showing it would invite corrections
to it, which is a flow nobody has designed.

**Delete and merge.** Out of scope, as they have been since `#32`. A reassigned or
shared number remains the known limitation it already is. Rename is added here
because `#56` lets billers create customers with names, which makes typos
permanent, and rename is the smallest correction that answers it — its question
*does history follow?* has a clean answer: **no**, bills snapshot.

## What the owner settled at the checkpoint, 2026-09-23 to 2026-09-24

Section 2's stop, and it moved more than the sketch did. Each point is argued in
its own section above; this is the list, so the database work reads what it is
building against rather than the first sketch.

- **Finding people.** The sketch had complete-phone search and "a recent list".
  It became **one box for a name or part of a number**, three characters of
  either, matching anywhere, with a loose in-order fallback for names only and
  the matched part in bold; and **two tabs, Regulars first** — everybody seen in
  the last thirty days, most visits first, and everybody who is gold — each
  loading twenty at a time, neither carrying a count. While a search is on
  screen the tabs step aside.
- **The card.** As sketched, plus *Spent* labelling the rupee figure. A name can
  be corrected and never erased.
- **The mark.** A drawn star icon on its own gold token rather than the ⭐ emoji,
  so it is one star on every device and theme. It sits beside the name on #56's
  composer row — the name gives way on a narrow panel and the star and number
  stay whole — and on the dialog's match **and its partial-number suggestion**,
  the open-order card, the pipeline card, the shift bill list, and Billing
  history's bill and order detail.
- **Managers.** The sketch had none. The same surface now serves a Franchise
  Admin over their own outlets, read-only for any customer another outlet also
  serves, and able to change name and gold only for a customer wholly theirs.
- **Membership history** is kept for a later screen; nothing about it is shown
  yet.
- **Two contract corrections** carried in from #56: the customer control's
  removed clear action, and the outlet-scoped partial-number path the living
  spec had not admitted.

## Task ordering

Section 1 builds the owner's search, card and confirmation **against the mock
adapter**, plus the mark on the counter surfaces, walkable at `/demo`. Section 2
is the owner's checkpoint and a hard stop. Only then does the database work begin.

Same instruction and same reason as `#56`. The mock must enforce the real boundary
the way `mock/customers.ts` already does — a mock laxer than the database teaches
a UI to expect access it will not be given.
