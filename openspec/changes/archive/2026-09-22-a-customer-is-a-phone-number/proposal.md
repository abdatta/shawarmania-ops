# Proposal: a-customer-is-a-phone-number

> **Model**: Opus · **Wave**: F · **Depends on**: #55 · **Gate**: a biller identifies the customer in front of them from one tap and an on-screen keypad — four digits suggest the one customer this outlet has served, a complete number resolves against the whole business, an unknown one insists on a name before saving, and neither path leaves the bill screen; a biller who is not given a number taps **Skip** once, inside the dialog and never beside it, and creates nothing in the directory; Order and Paid stay disabled until the biller has either identified or skipped; the server links every sale to its customer from the phone the command carried, including every sale rung offline, and no failure to resolve one ever refuses a sale; and the four-role demo walkthrough still walks.

## Why

**Nobody types phone numbers at the counter, and the field is not the reason.**

The composer asks for a customer name **or** a phone, and accepts either
([`docs/LIMITATIONS.md`](../../../docs/LIMITATIONS.md) records this as a
deliberate, reversible UI trial — both bill snapshot columns stay nullable so it
can be relaxed without a migration). In production the names that come back are
algebraic — `aaa` and its relatives — and the phone is almost always empty.

The obvious reading is that billers are bypassing the requirement. Measured
against production it is **mostly right**, and the part it misses is small but
real — and the part it misses is what makes the fix something other than a
stricter field.

**The name field is quietly doing two different jobs.** The customer name is
printed on the open-order card
([`open-order-card-body.tsx:51`](../../../src/features/billing/open-order-card-body.tsx)),
on the kitchen pipeline card
([`pipeline-card.tsx:246`](../../../src/features/billing/pipeline-card.tsx)) and
on every row of Bills this shift
([`shift-bill-list.tsx:159`](../../../src/features/billing/shift-bill-list.tsx)).
So a biller with no customer details to enter is handed a **customer profile
field** they must put something in. What comes out of it is measured below.

This change asks for the customer's details at the one moment they exist, and
asks for nothing when they do not.

- **The phone is the identity.** It goes to the directory, it is what a returning
  customer is recognised by, and later it is what carries a membership.
- **The name is the customer's own name**, given along with their number. It is
  snapshotted onto the bill as it stood at the sale, and it is asked for at the
  one moment it means something: saving a number nobody has seen before.

And then **Skip is not a hole punched through the form** — it is a useful place to
go. An order for a customer who gave no number is called by its order number, the
way the kitchen already works, and nothing reaches the customer directory. That is
the version a biller will use honestly, which is the only kind of rule worth
shipping.

## What production actually says

Read read-only on **2026-09-18**, across both trading outlets:

```
bills ................................... 1840
  carrying a customer_id ................    0
  carrying a phone ......................    0
  carrying a name .......................  1840
orders .................................. 1941
  carrying a customer_id ................    0
  carrying a phone ......................    0
customers ...............................    0
```

**Not one phone number has ever been entered, and the customer directory is
empty.** `global-customer-identity` (#32) shipped on 2026-08-02 against a table
with zero rows; six weeks and 1840 bills later it still has zero rows.

The name field is more eloquent still. Of 1840 bills, **1754 carry a name of one
or two characters** — 562 of one, 1192 of two — and 225 distinct values cover the
lot. The most used are `As` (264 bills), `Kk` (166), `Jj` (143), `A` (93), `S`
(63). Nothing in the top of that list is a person.

### Is any of this the customer's name? Almost none of it.

The owner settled this on 2026-09-18 — *the order already has a number* — and it
was measured rather than argued.

A string that told anybody anything would have to distinguish. If one biller types
the same string on two orders in the same hour, it is telling nobody anything
apart. Same biller, same hour, same string:

```
name unique within that biller-hour ......... 1110 bills
shared with one other ........................ 340
shared with two .............................. 177
shared with three ............................  76
shared with four ..............................  70
shared with five or more .....................  67   (up to nine on one string)
```

So **about 40% of these strings distinguished nothing** at the moment they were
typed. And the per-biller vocabularies differ
sharply — one biller used 78 distinct strings across 816 bills, another 160
across 441 — which is two different behaviours, not one practice.

**The honest reading: the behaviour is typing the shortest thing that turns the
button green.** These strings are what a required field extracts from people who
have nothing to put in it — which is what `docs/BUSINESS_CONTEXT.md` predicted
when it said a required customer name "would get filled with "a" a hundred times
a day and destroy the customer data it was meant to create."

What follows for the design is that **the field should stop being required at
all**, rather than being made easier to satisfy. A customer's name is worth
recording when it comes with their number; on its own it is the cost of the
blocker and nothing more.

**And skip must be understood as cheaper than what it replaces.** Today, evading
costs two keystrokes. After this change it costs **one tap**. This change removes
the *friction* excuse — a keypad and instant recognition against a system keyboard
and ten digits — but it supplies no *reason* to prefer the number. The owner
considered this on 2026-09-18 and **kept skip at one tap deliberately**, having
already ruled out the per-outlet setting, the skip-rate statistics and any manager
override. This change therefore ships with a real possibility that capture stays
near zero, and that is an accepted outcome rather than an oversight.

**What would actually move the number is `a-gold-member-is-a-label` (#57)**, which
gives a biller a sentence to say: *"can I get your number, you might be a gold
member."* Asking for a phone with no payoff for either person is a thing any
sensible biller skips. So the two changes should ship close together, and #56's
capture rate should not be judged before #57 exists.

**There was nothing to backfill when this was written, and by implementation
there was exactly one row.** Re-read on 2026-09-21: one bill and one order now
carry a phone, and one customer row exists — somebody typed a real number into
the old composer at Kalyani on 2026-09-19. The link is reconstructable, and the
decision taken was still **not to backfill**: lifting `bills_append_only` on the
money table is not a proportionate price for one historical row. The counts and
the reasoning are recorded in `tasks.md` § 3.10.

**Both figures start from zero whatever we do.** `a-gold-member-is-a-label` (#57)
reports a customer's last thirty days; on this data every customer's card would
read nothing until the new flow has been running for a month. That is not a defect
to design around — it is what a directory with no rows means — but it should not
surprise anybody at the demo.

**This lands as the new outlet opens.** Kanchrapara stopped trading on 2026-09-15,
Kalyani closes at the end of September, and `Kalyani Cafe` — created in production
on 2026-09-10 and carrying one test bill — starts trading at the turn of the
month. So this change is very likely to ship into a counter with no habits yet,
which is the best possible moment to replace the field that made the habits.

### The rollout, as the owner expects it [owner, 2026-09-19]

There is no per-outlet setting — that was rejected — so **a push puts this on
every trading till at once**, and `counter-billing` is `live`. The owner's
expectation is that **Kalyani and Kanchrapara capture nothing**; real capture
starts with `Kalyani Cafe`, with a possible test run at Kalyani beforehand.
Kanchrapara stopped trading on 2026-09-15 and is not affected. Four things
follow, and the first is a sequencing constraint rather than a preference.

**Section 1 must not ship without section 3.** Today production is clean: zero
bills carry a phone, zero carry a `customer_id`, and `customers` is empty. Ship
the dialog alone and the first number anybody enters — a test run, or a biller
simply trying it — writes a phone onto a bill whose `customer_id` is still null,
while `saveCustomerIfComplete` creates the customer row beside it, unlinked.
That is precisely the orphan state section 3 exists to repair, and it turns task
3.10's "no backfill, and confirm that before relying on it" from a formality
into a live decision about real rows. **Keep the two together, and let the test
run be the first thing that happens after the link lands, not before.**

**The decision gate reaches Kalyani on the day of the push.** Order and Mark Paid
stay disabled until the biller has used the customer row, on every till,
including the one not meant to be capturing anything. That is the enforcement
working as designed, but it means two extra taps on every bill at Kalyani for the
weeks before the Cafe opens, with no benefit to that counter.

**And the same push stops those strings being typed.** The preparation card and
Bills this shift currently print whatever the biller typed; after this change an
order for a customer who gave no number carries nothing, and those cards identify
it by its order number — which is what the kitchen already calls it by. The
counter loses nothing it was actually using.

**The Cafe starts blind, including for customers the business already knows.**
Partial matching is scoped to customers *this outlet* has served, so a regular
captured during a Kalyani test run will not come up on four digits at the Cafe
until the Cafe has served them once — even though it is the same neighbourhood
and, very likely, the same people. Nothing is lost: the complete ten digits still
finds them, because that lookup is business-wide. But it is worth telling whoever
is on the till, so an empty suggestion on opening week is not reported as a
fault.

## What already exists, and is not this change's work

A fresh session should read this before planning anything. **The identity layer
is already built and already global**, from `global-customer-identity` (#32),
[`20260802000002_global_customer_identity.sql`](../../../supabase/migrations/20260802000002_global_customer_identity.sql):

- `public.customers` is **business-wide** and keyed on a canonical `+91XXXXXXXXXX`
  phone, unique across the business. No `outlet_id`. Name optional and free text.
  No spend or visit aggregates — they were deliberately dropped, because an
  aggregate on the global row is one outlet's trade readable at another.
- `customer_lookup_by_phone(p_phone)` — exact, complete phone only. Returns
  `id, phone, name` and nothing else. No prefix, no wildcard, no list, no count.
  Callable only by an unrevoked enrolled counter device or an account holding a
  live Biller assignment. Rate-bounded at 120 per caller and 2000 globally per
  fifteen minutes, and the attempt table records **who asked and when, never what
  was asked**.
- `customer_create_or_get(p_phone, p_name)` — creates on first use, and **never
  overwrites an existing saved profile** from a till.
- `customer_directory()` — Super Admin only, through a **separate** authority
  check so widening one path cannot widen the other. No UI calls it yet; that is
  #57's work, not this one's.
- Both adapters exist and are typed:
  [`supabase-adapters/customers.ts`](../../../src/data-access/supabase-adapters/customers.ts)
  and [`mock/customers.ts`](../../../src/data-access/mock/customers.ts). The mock
  enforces the same three rules the database does, clause for clause.
- The counter **already autofills today**: type a complete number into the phone
  box and a *Returning customer found* card appears with **Use saved details**
  ([`billing-counter.tsx:868`](../../../src/features/billing/billing-counter.tsx)).
  Offline it falls back to `rememberedCustomers` on the resume record.

So this change is **not** building customer identity. It is building the surface
that makes the existing one worth using — and repairing the one join that was
never made.

## The link between a bill and a customer has never been made

Found while writing this proposal, on 2026-09-18, and it changes the shape of the
change.

`bills.customer_id` exists, its foreign key exists, and the billing command
payload carries a `customerId` field end to end. **Every caller passes `null`**
([`billing-counter.tsx:563` and `:586`](../../../src/features/billing/billing-counter.tsx)),
and the settle function stores the null it is handed —
`v_customer := nullif(p_payload ->> 'customerId', '')::uuid`. So **no bill in
production points at a customer.**

The customer record is created instead by a separate, fire-and-forget call
beside the sale:

```ts
void saveCustomerIfComplete().catch(() => undefined)
```

Two consequences, and the second is worse than the first:

1. **The directory and the bills are two unconnected sets of facts.** A customer
   row exists; bills carry a name and a phone; nothing joins them. Any question
   of the form *what has this customer done* is unanswerable today — which would
   have made `a-gold-member-is-a-label` (#57) ship a card reading `0 visits, ₹0`
   for everybody.
2. **Offline, the customer is lost rather than delayed.** That call is a bare
   network request with its failure swallowed. There is no outbox behind it. A
   day's offline trade creates no customer records at all, and the bills that
   would have identified them carry text nobody can join to anything.

### The repair: the server resolves the customer from the phone

The command already carries `customerPhone`. The billing functions SHALL resolve
the customer themselves — calling create-or-get with the phone on the command and
setting `customer_id` from the result — rather than trusting a client-supplied id
that has always been null.

Everything the offline story needs falls out of that:

- a tablet rings a sale with a phone and no id, and whenever the command drains
  — ten minutes or ten hours later — the link is made;
- two tills first using one number in the same second already resolve to one row,
  by the unique constraint the create path was built on;
- **skip needs no special case**: no phone on the command means nothing is
  created and `customer_id` stays null, which is exactly right;
- and the same repair fixes the online case, because it is the same bug.

**The alternative was considered and is a dead end.** A tablet minting a customer
UUID offline gives two tablets two ids for one phone; one loses the unique
constraint and its bill references a row that does not exist. Bills are
append-only, so it could not be corrected afterwards.

**This lands in `billing-command-contract`, not `counter-billing`.** What it
governs is the boundary — that the server resolves at the moment a command is
recorded, from the phone the command carried rather than from a client-supplied
identifier, and that the resolution can never refuse the sale. That is the same
register as *Settlement readiness is checked at the database boundary* and
*Content payloads carry their discounts and their rounding*. So this change
carries two delta specs, and the customer link is in the second one.

### The rate bound must not be able to fail a sale

`customer_create_or_get` checks `customer_lookup_exceeded` — 120 per caller per
fifteen minutes. A tablet offline all day drains hundreds of queued commands at
once; the 121st would be refused, and a privacy guardrail would have destroyed a
sale.

The bound exists to stop **enumeration**. Resolving a phone that is already
written on the bill being settled discloses nothing the caller did not supply. So
the settle path resolves through an internal function **without** the bound,
while the biller's interactive lookup keeps it exactly as it is.

Those two paths must stay separate and must say why in the migration, or a later
reader will helpfully unify them and put the bound back in front of the money.

### So this change does carry a migration

Contrary to what this proposal first assumed. The composer and the dialog remain
the bulk of the work, and `bills.customer_id`, `customer_name` and
`customer_phone` remain independent nullable columns — a row carrying a name and
no number is still one the schema accepts today. But the resolve, the internal function and
the decision about existing rows are database work, and they belong here rather
than in #57, because #57 is the change that would otherwise discover it.

## Scope

### The customer row on the composer

The two side-by-side inputs in
[`bill-composer-footer.tsx`](../../../src/features/billing/bill-composer-footer.tsx)
are replaced by **one full-width row with three states**:

```
empty      [ 👤+  Customer ]
chosen     [ 👤   Rahul · +91 98765 43210   ⭐  ✕ ]
skipped    [ 👤   Skipped Customer Info            ✕ ]
```

- Tapping the row opens the dialog. Tapping ✕ clears back to empty.
- The ⭐ appears only once #57 exists; this change leaves room for it and draws
  nothing.
- The red *"Add a customer name or phone to continue"* line is **deleted**. A
  disabled Paid button beside an untouched Customer row says it without prose.

### The dialog

```
          98765 43210          ← the only large text on the screen
   ┌────┬────┬────┐
   │ 1  │ 2  │ 3  │
   │ 4  │ 5  │ 6  │
   │ 7  │ 8  │ 9  │
   │ 00 │ 0  │ ⌫  │
   └────┴────┴────┘
   [    Skip    ]   [     Use     ]
```

Same keypad grid and tap-first idiom as
[`payment-dialog.tsx`](../../../src/features/billing/payment-dialog.tsx) and
[`discount-dialog.tsx`](../../../src/features/billing/discount-dialog.tsx).
There is no shared keypad component today; whether to extract one is an
implementation judgement, not a requirement.

**The area above the pad resolves itself on the tenth digit.** No search button,
no spinner, no explanatory copy:

- **match** → the saved name appears. The action button reads **Use**.
- **no match** → one optional Name field slides in. The action button reads **Save**.
- **fewer than ten digits** → nothing is there. Silence is the correct message.

**Skip** swaps the dialog to a single name box and a Done.

### The name/phone split

- Choosing a customer writes **`customer_id`, `customer_name` and
  `customer_phone` onto the order and the bill snapshot** — not the id alone.
  A receipt with an id and no name is #58's failure and this change's fault.
- Skipping writes no customer facts at all: `customer_id`, `customer_name` and
  `customer_phone` are all null, and the order is called by its order number.
- The saved directory profile is **never** rewritten from the till. A different
  name typed at the counter snapshots onto that bill only. This is an existing
  rule in `global-customer-identity`; it must survive.

### The gate on Order and Paid

Replaces `hasCustomerIdentity`. Order and Paid enable once the biller has
**either identified or skipped** — a rule about having decided, not about
phones. That gate is the entire enforcement mechanism in this change, and it is
deliberately the only one.

## Decisions already taken — do not relitigate

These were settled with the owner on 2026-09-18. A session that reopens them is
spending the owner's time twice.

- **No per-outlet "phone required" setting.** Considered and rejected: the
  composer gate above is enough, and a setting is a second thing to get wrong.
  Consequence to accept: this ships to every counter at once, not staged behind
  the new outlet.
- **No skip reason, no dropdown, no manager override, no skip-rate statistics,
  and no owner-side reporting on skipping.** Explicitly cut by the owner. A
  reason dropdown gets its first option picked every time.
- **Skip lives inside the dialog, never beside it on the composer.** A one-tap
  bypass under the thumb becomes muscle memory within a week and reinvents `aaa`.
  One extra tap is a choice; it is nowhere near a nuisance.
- **No browse, no prefix search, no name search, no customer list at the till.**
  Not a permission to configure — the path does not exist in the database and
  must not be created. The till may only ever ask about a complete number it was
  told.
- **A fake number is worse than a fake name.** It mints a junk global identity,
  can collide with a real person's number, and there is no delete or merge path
  in the app by design. That is why skip exists at all.

## Non-goals

- **No gold membership, no ⭐, no owner surface.** That is #57.
- **No customer rename or delete.** #57 introduces the first write path to a
  saved profile, from the owner's side. Until then the directory stays
  append-only from the app's point of view.
- **No change to the rate bound, the attempt table, or who may look up.**
- **No new columns on `customers`.** In particular no visit count and no spend:
  those were removed on purpose and are #57's owner-only derived read at most.
- **No receipt change.** That is #58.

## Task ordering — UI first, and stop for the owner

**The owner has asked to see and iterate on the UI before anything is committed
to underneath it.** This is the repo's stated delivery model
([`AGENTS.md` → Delivery model](../../../AGENTS.md)) applied inside one change
rather than across two, so `tasks.md` must be ordered:

1. **The dialog and the composer row, against the mock adapter only**, walkable
   at `/demo` as a Biller. No migration, no real adapter, no spec deltas
   finalised.
2. **🧍 Owner checkpoint — stop here.** The owner walks it in demo and iterates.
   Expect several rounds. Nothing below starts until they say the UI is settled.
3. Real adapter wiring, offline behaviour, tests, spec deltas, docs.

A session that builds the database side first has ignored the one instruction the
owner gave about how this change is to be run.

## Offline

The counter trades through a dead connection and this dialog must not be the
thing that stops it.

- Lookup already falls back to `rememberedCustomers` from the resume record, and
  the existing UI distinguishes *Remembered customer found* from *Returning
  customer found*. Keep that distinction in the new dialog.
- A number never seen before cannot be resolved offline. The dialog must let the
  biller **save it and carry on** — `customer_create_or_get` is already
  fire-and-forget beside the bill
  ([`billing-counter.tsx` `saveCustomerIfComplete`](../../../src/features/billing/billing-counter.tsx)),
  and the bill snapshots the name and number regardless. Identity is helpful,
  never a condition of sale.

## How to run the gate

- Walk it at `/demo` as a Biller: match, no-match-then-save, skip, reopening an
  order rung before this change, ✕ and re-choose, and a mistyped nine-digit number.
- On a real tablet-width viewport, one-handed. The pad is for a thumb.
- Light and dark both.
- Offline: aeroplane mode, a remembered number and an unknown one.
- Confirm a skipped bill reaches the kitchen card and Bills this shift identified
  by its order number, and creates no directory row.
- Confirm a chosen customer lands `customer_name` **and** `customer_phone` on the
  bill, not just the id.

## User-only gate steps

- 🧍 The owner walks the demo UI at the checkpoint above and says it is settled
  before any database work begins.
- 🧍 A real biller rings a few live orders with it at the counter before archive.
  Tasks complete is not the archive trigger; real use at the counter is.

## Docs to update before archiving

- [`docs/SCREENS.md`](../../../docs/SCREENS.md) — the composer's customer rules;
  the *"either name or phone"* paragraph and the phone-validation bullet both
  describe behaviour this change replaces.
- [`docs/LIMITATIONS.md`](../../../docs/LIMITATIONS.md) — the *"operating trial"*
  paragraph about name-or-phone, and the *"One customer identity, and
  deliberately nothing built on it"* section.
- [`docs/DEMO_MODE.md`](../../../docs/DEMO_MODE.md) — the walkthrough script
  names typing `9000000101` for autofill and `12345` for a refused number; both
  move into the new dialog.
