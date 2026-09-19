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
Earlier spells stay in the table and appear on no screen — which is a deliberate
asymmetry: the record is for the system's future reasoning, not for the owner to
browse.

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

- if `#56` decides **not** to backfill existing bills, these figures begin at
  that release rather than at the beginning of trading. Thirty days is a short
  enough window that it stops mattering within a month, but it must be true
  before the card is believed.
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
  is rung with no mark. The biller carries on; identity is helpful and never a
  condition of sale.

### The one case where the snapshot is filled in later

That last bullet leaves a real gap: a member the tablet had never seen is served
as an ordinary customer, and if nothing more happened, the record would say they
were never recognised at all.

**The resolution is the order/bill boundary, which this repo already draws.**
Orders are mutable until they are paid; bills are append-only. So:

- an offline sale that arrives **still an open order** has its membership
  resolved by the server, and the mark appears on its card. The food has not gone
  out yet, so the kitchen can still act on it — which was the owner's reason for
  putting the mark on that card in the first place.
- an offline sale that arrives **already paid** is recorded without membership,
  permanently. A bill states what the counter knew and did, and "we did not know"
  is a true thing that happened.

This was the owner's call on 2026-09-18, and it is better than either absolute.
Always backfilling would badge a receipt (`#58`) for an order that was served as
an ordinary one. Never backfilling would throw away a recognition that is still
actionable while the food is being made.

**It also means the member mark is not a money fact and must never become one.**
A snapshot that can still change while an order is open would be intolerable on a
price; it is fine here precisely because nothing is computed from it.

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

**Showing the membership history on the card.** Rejected: the record exists for a
future rule to reason with, not for browsing. Showing it would invite corrections
to it, which is a flow nobody has designed.

**Delete and merge.** Out of scope, as they have been since `#32`. A reassigned or
shared number remains the known limitation it already is. Rename is added here
because `#56` lets billers create customers with names, which makes typos
permanent, and rename is the smallest correction that answers it — its question
*does history follow?* has a clean answer: **no**, bills snapshot.

## Task ordering

Section 1 builds the owner's search, card and confirmation **against the mock
adapter**, plus the mark on the counter surfaces, walkable at `/demo`. Section 2
is the owner's checkpoint and a hard stop. Only then does the database work begin.

Same instruction and same reason as `#56`. The mock must enforce the real boundary
the way `mock/customers.ts` already does — a mock laxer than the database teaches
a UI to expect access it will not be given.
