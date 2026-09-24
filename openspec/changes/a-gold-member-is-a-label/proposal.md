# Proposal: a-gold-member-is-a-label

> **Model**: Opus · **Wave**: F · **Depends on**: #56 · **Gate**: the owner finds a customer by their complete phone number from their own phone, opens a card over the search results, and makes them a gold member or takes it back behind one confirmation; the same card corrects a misspelt name, and reports what that customer has done in the last thirty days without a single stored aggregate; a biller sees ⭐ beside the customer they have just identified and on every card that order becomes, so the kitchen can treat it differently, and sees no date, no history and no spend; membership is **business-wide, and is a label only** — no automatic discount, no automatic appointment; and the four-role demo walkthrough still walks.

## Why

The owner wants to recognise regulars. The first version of that is not a points
engine — it is **a word beside a name**, granted by hand, visible at the counter,
so the biller can decide to do something about it with the discount tools they
already have.

Everything else about loyalty is deferred on purpose, and this change is
deliberately the smallest thing that is still genuinely useful.

This is the promotion of
[`openspec/todos/customer-loyalty-and-cross-outlet-insights.md`](../../todos/customer-loyalty-and-cross-outlet-insights.md),
whose stated trigger — *a real loyalty or repeat-customer decision* — fired on
2026-09-18. It promotes **only** the membership half. Cross-outlet spend
insights, automated appointment and consent remain in that note.

## It is also what gives `#56` a reason to work

Worth knowing before this is scheduled late.

`#56` replaces the counter's customer field with a keypad dialog and a one-tap
skip. Measured against production on 2026-09-18, the field it replaces is evaded
rather than used — no phone has ever been entered across 1840 bills, and the names
are one- and two-character strings that 40% of the time do not even distinguish
one order from another in the same hour.

`#56` removes the friction. It supplies no reason. Asking a stranger for their
phone number with no payoff for either person is a thing any sensible biller
skips, and skipping is now one tap.

**This change is the reason.** *"Can I get your number — you might be a gold
member"* is a sentence a biller can say and a customer can answer. So these two
should ship close together, and `#56`'s capture rate should not be judged before
this exists.

## The two decisions that shape everything else

### Membership is global, not per outlet

Settled 2026-09-18, with the franchise objection heard and answered.

- The customer row is **already** global. Hanging an outlet-scoped membership off
  a business-wide identity is two ideas fighting; global membership on a global
  customer is one idea.
- *"You are a Shawarmania gold member"* is a brand promise. Gold at one shop and
  not another is internal accounting leaking onto a customer-facing label.
- **Per-outlet cannot be verified right now.** The business is consolidating to a
  single outlet for the next six to twelve months before franchising is
  revisited, so every membership row would carry the same outlet id and the
  isolation it claimed would be untestable.
- The franchise objection — *a franchisee will not want to honour a benefit they
  did not grant and are not paid for* — **does not bite while gold is a label**.
  The biller decides what, if anything, to give. By the time it bites there is a
  franchise agreement being written and better information to decide with.
- **Per-outlet reporting comes free without per-outlet membership**, because the
  tier is snapshotted onto each order and bill, and a bill belongs to an outlet.
  *"How many gold orders did this outlet serve"* is a column, not a model change.
- Reversal, if ever needed, is `add column outlet_id` plus one backfill decision
  (grandfather everyone, or pin them to where they were granted) — made with real
  information. The opposite mistake costs a year of complexity first.

### Gold is a label, and nothing is automatic

- **No automatic discount.** A biller who sees ⭐ applies a discount by hand
  through the existing bill-discount path from
  `a-discount-is-a-line-on-the-bill` (#53). Zero new money machinery.
- **No automatic appointment.** Rule-based gold is anticipated and explicitly
  deferred. The membership table exists partly so that a future rule writes
  **rows with reasons** rather than flipping a bit that explains nothing.
- **Accepted cost, stated once so nobody is surprised later:** a gold discount
  given by hand is indistinguishable in the ledger from any other biller
  discount. *"What did gold cost us in October"* is unanswerable for this period.
  A `membership` discount source was considered as a hedge and **cut by the
  owner** — correct for v1, and worth reviving the day gold becomes automatic,
  because bills are append-only and attribution cannot be retrofitted.

## Scope

### Membership, in the database

A membership **table**, not a boolean on `customers`: `customer_id`, `granted_at`,
`granted_by`, `revoked_at`, `revoked_by`, and a reason column left unused by this
change. The current tier is derived from it.

Revoke is **its own row**, not a deletion. When an automatic rule arrives it must
be able to read why someone lost gold rather than fight a flag that has forgotten.

Re-granting after a revoke is normal: the card reads *Gold member since* the
**newest** grant. Earlier spells stay as history and are shown nowhere.

### The tier is snapshotted, never joined

`customer_tier` is written onto the **order and the bill** at creation, exactly as
lines snapshot `unit_price_paise` and discounts snapshot their basis.

This is not an optimisation. A live join would flicker if a membership is revoked
mid-shift, would not work offline, and would answer *is gold now* when the kitchen
is acting on *was gold when they ordered*. It is also what makes #58 able to badge
a year-old receipt, and what makes per-outlet reporting free under a global model.

### What the biller sees

⭐ and nothing else. On the composer's customer row, on the match inside the
keypad dialog — **including the partial-number suggestion `#56` added**, which
surfaces a customer too and would otherwise be the one place a member arrived
unmarked — on the open-order card, on the **kitchen pipeline card** (the owner's
explicit reason being that a gold order may be prepared sooner or treated
differently) and on the shift bill list.

Never the grant date, never who granted it, never the history, never spend.

### And in Billing history

The same ⭐, read from the same snapshot, on the owner's and the manager's bill
and order detail (owner, 2026-09-23). It costs nothing — the tier is already on
the row — and it is where *"how many gold orders did we serve this week"* gets
answered by looking rather than by querying. The mark is a fact about the sale,
so a manager reading their own outlet's bills learns nothing about any other
outlet by seeing it.

### What the owner gets

A surface that finds a customer **two ways**, and **a card that opens over it as a
modal — deliberately not a route.**

- **Search by name or by part of the number** (owner, 2026-09-24) — letters
  match anywhere in a saved name, digits match anywhere in the number, three of
  either to start, and at most twenty results with a count of the rest. This started as
  complete-phone only; the owner asked why they could not search their own
  customers by name, and the honest answer was that nothing forbids it at their
  boundary. Names were typed at a counter, so the number search stays for the
  customers whose name is misspelt or missing.
- **Two lists, with no search at all** (owner, 2026-09-23), shown as **two tabs,
  Regulars first**, each loading twenty at a time as the reader scrolls
  (owner, 2026-09-24):
  - **Regulars** — everybody seen in the last thirty days, however few visits,
    most visits first, each with their visit count. One-visit customers are
    there too; they simply rank at the bottom.
  - **Gold** — everyone who holds a membership now, newest grant first.

  Tabs rather than two stacked lists because thirty or forty gold members is
  expected, and a gold list drawn above the regulars would push them off a phone
  screen — the list the owner actually finds new members from. Tabs rather than
  two short scrolling boxes because a box that scrolls inside a page that scrolls
  catches a thumb.

The second list is the one that makes the feature usable. The owner decides to
make somebody gold because they *notice they keep coming*, and nobody knows a
regular's phone number by heart — a surface that could only be entered by typing
one would leave the owner unable to find the very people it exists for. The
ranking is derived at read time from bills, under the owner's own authority,
exactly like the card's figures; nothing is stored to produce it.

This is a browse path, and it is **permissible here and nowhere else**: the owner
already reads every bill at every outlet. The counter's boundary is untouched —
no till gains a list, a prefix over the directory, or a count.

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

or, when they are not a member:

```
  Not a gold member                  ⭐
```

- **Status rows, not buttons.** Name and membership each read as a line of text
  with one small **icon-only** button beside it. No large action button at the
  foot of the card.
- **The icon shows the action, not the state**, matching the pencil: not a member
  → a star (tap to grant); a member → a crossed-out star (tap to revoke). The
  text row already says the state.
- **Rename in place**: the pencil turns the name into an input and itself into a
  tick. **A name can be corrected, never erased** (owner, 2026-09-23) — the same
  rule `#56` enforces when a number is first saved, and for the same reason: a
  profile with no name is a number nobody can recognise on a list.
- **Toggling membership confirms**, both directions, through the existing
  `ConfirmDialog`. Asymmetric confirmation — one direction asking and the other
  not — is where people slip.
- The `+91` prefix is shown so the number is unmistakably a phone number.

### Why a modal and not a page

A `/owner/customers/:id` route is **a pasteable URL naming a real person with
their phone number on it** — in browser history, in a chat message, in an
address-bar autocomplete on a shared laptop. Every other PII surface in this app
is reached by an action, not an address. A modal has no URL.

Supporting reasons: the owner is on a phone, the interaction is ten seconds long,
and a route would need a gate-registry entry, a navigation decision and a
back-button story for a screen nobody navigates *to*.

**Modal-over-modal is already solved here.** [`Modal`](../../../src/components/ui/modal.tsx)
is built on the native `<dialog>` element and its `onClose` deliberately stops
propagation — the comment records the real bug it fixes, where dismissing an
explanation opened over the cash count sheet closed the count sheet and lost
everything typed. `ConfirmDialog` composes it. This is reuse, not new ground.

### The statistics, and the rule that keeps them safe

**Thirty days, not lifetime.** A lifetime total makes a customer who stopped
coming in January look identical to one who came in yesterday; the gold question
is *are they a regular now*. Only **Last seen** and **Customer since** are
all-time.

**Called visits and spend, not bills and revenue** — the owner is looking at a
person, not at accounting.

**One bill is one visit** (owner, 2026-09-18). Counting distinct days was
considered and rejected as a complication the counter does not actually produce:
a customer who keeps ordering does not pay repeatedly — the biller undoes
**Prepared**, edits the open order with the extra items, prepares again, and the
whole occasion settles as **one bill** when they finally pay. So repeat ordering
already collapses into one bill, and counting bills is both simpler and closer to
what a visit means here.

**Voided bills count for nothing** — excluded from visits and from spend. A void
means it did not happen.

**No outlet split.** Considered and cut: it is the most interesting line for an
owner but the most dangerous for anyone else, and dropping it means a future
Franchise Admin card is the *same* card counting only their own outlets, rather
than a second censored variant. That simplification was the owner's call and it
was the right one.

**The rule that must not be broken:** these figures are **computed at read time
from bills, under the owner's own authority, and are never stored on the customer
row.** The isolation rule protects outlets from each other, not the owner from
their own business — the owner already reads every bill at every outlet — but the
moment an aggregate becomes a column on the global profile it is one careless
widening away from riding along in the till's lookup response. `#32` removed
`bill_count` and `total_spend_paise` from that table for exactly this reason and
they must not come back.

### The boundary this change widens, on purpose

`global-customer-identity` currently requires that the billing lookup response
*"SHALL contain only customer ID, canonical phone, and saved billing name."*
Adding the tier makes it four columns, and that clause must be **amended with a
stated reason**, not quietly outgrown.

The cost, accepted by the owner on 2026-09-18: a biller at one outlet can learn
that a customer who has only ever shopped at another is gold. If gold tracks
spending, that is a weak signal about activity across the boundary. It is small,
it is worth the trade, and the spec should say so out loud rather than let it
arrive by accident.

The same field rides on the **outlet-scoped partial-number suggestion** `#56`
built (`customer_suggest_at_outlet`). That function only ever reaches a customer
this counter has already served, so the mark on it discloses less than the mark
on the exact lookup does.

Everything else about that boundary is unchanged and must stay so: complete exact
phone across the business, a partial number only within the caller's own outlet
and one match at most, no browse or list, the same rate bound, no phone numbers in
the attempt log, and a customer id still conferring no access to any bill.

**Correcting the living spec while it is open.** `global-customer-identity` still
says no outlet role may have *any* prefix path, which stopped being true when
`#56` shipped the outlet-scoped suggestion without amending it. This change
rewrites that exact requirement, so it writes the exception in with its reason
rather than leave the contract contradicting the code. Likewise the
`counter-billing` requirement for the customer control still describes a
*"single action that clears it back to nothing chosen"* — the ✕ the owner had
removed at `#56`'s checkpoint. Its text and its scenario are removed here.

### The manager's view

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

### Where it lives

**Setup group, labelled `Customers`, after People** (owner, 2026-09-18) — for the
Super Admin and, over their own outlets, the Franchise Admin, as two entries in
[`src/gates/registry.ts`](../../../src/gates/registry.ts) sharing one label so a
person holding both roles gets the owner's one door.

### Two supporting pieces

- **An index on `bills.customer_id`.** There is none — nothing has ever queried
  bills by customer. The thirty-day figures need it, across outlets.
- **Owner search needs its own path.** `customer_directory()` returns the *entire*
  directory ordered by `created_at`, unpaginated, written when the table had zero
  rows. It needs a bounded search by name or partial number, and the two bounded
  lists above. The owner's boundary is separate from billing's, which is what
  makes name and partial-number search permissible here and nowhere else.

## Non-goals

- **No automatic or rule-based appointment.** Anticipated; deferred.
- **No automatic discount, and no `membership` discount source.**
- **No biller-side granting.** Possible later; the owner grants from their phone.
- **No tiers beyond gold.** The model should not make a second tier hard, but
  nothing ships with one.
- **No customer delete or merge.** A reassigned or shared number remains the
  known limitation it already is.
- **No bill list in the card**, and no link from it into billing history. The
  owner noted a fuller statistics view may deserve its own page later; that is
  the trigger for a separate change, not scope creep here.
- **No receipt badge.** That is #58.

## Task ordering — UI first, and stop for the owner

Same instruction as #56, and for the same reason. `tasks.md` is ordered:

1. **The owner's search, card and confirmation against the mock adapter**, plus
   the ⭐ on the counter surfaces, walkable at `/demo`. No migration.
2. **🧍 Owner checkpoint — stop here** and iterate until the owner is happy.
3. Membership table, snapshot columns, the index, the lookup widening, the spec
   amendment, tests, docs.

The mock must enforce the real boundary as
[`mock/customers.ts`](../../../src/data-access/mock/customers.ts) already does —
a mock that is laxer than the database teaches a UI to expect access it will not
get.

## How to run the gate

- As Super Admin at `/demo` and then for real: search a number, open the card,
  grant, confirm, reopen, revoke, re-grant, rename. Open a customer from each of
  the two lists without typing anything, and confirm a grant moves them onto the
  gold list.
- Confirm a Biller, an Employee and a counter device are refused the whole
  management path, and a Franchise Admin is refused any customer another outlet
  has served — reading one they have never served, and changing one another
  outlet also serves — by **hand-crafted request with a valid session**, not by an
  absent button.
- Confirm the till's lookup returns the tier and still returns nothing else, and
  that no browse, prefix or list path has appeared anywhere.
- Confirm the thirty-day figures match bills across both outlets and that nothing
  aggregate was written to `customers`.
- Ring an order for a gold member and confirm ⭐ reaches the composer row, the
  dialog's match and its partial-number suggestion, the open-order card, the
  kitchen pipeline card, the shift bill list and Billing history's detail — and
  that the snapshot holds when membership is revoked mid-shift.
- Light and dark, on a phone-width viewport for the owner surface.

## User-only gate steps

- 🧍 The owner walks the demo UI at the checkpoint and settles it before any
  database work starts.
- 🧍 The owner grants a real membership to a real regular and a biller sees the
  ⭐ at the counter, before archive.

## Docs to update before archiving

- [`docs/DATA_MODEL.md`](../../../docs/DATA_MODEL.md) — the membership table and
  the snapshot columns, and why no aggregate lives on `customers`.
- [`docs/ROLES_AND_PERMISSIONS.md`](../../../docs/ROLES_AND_PERMISSIONS.md) — who
  grants, who sees ⭐, who sees the statistics.
- [`docs/SECURITY_AND_PRIVACY.md`](../../../docs/SECURITY_AND_PRIVACY.md) — the
  widened lookup response and the derived-not-stored rule.
- [`docs/SCREENS.md`](../../../docs/SCREENS.md) — the owner's customer surface and
  the counter's ⭐.
- [`docs/LIMITATIONS.md`](../../../docs/LIMITATIONS.md) — *"No screen edits a
  customer"* is no longer true; rename exists, and bills do not follow it.
- [`openspec/todos/customer-loyalty-and-cross-outlet-insights.md`](../../todos/customer-loyalty-and-cross-outlet-insights.md)
  — narrow it to what this change leaves behind.
