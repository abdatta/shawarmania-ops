# Design: a-regular-earns-points-and-gold

Decided with the owner on 2026-09-28, in one conversation, before any of it was
built. The reasons are recorded so the session that builds it does not re-derive
them or reopen what the owner already refused.

## Context

What this stands on, as of 2026-09-28:

- **#57** built `customer_memberships` (`customer_id`, `granted_at`,
  `granted_by`, `revoked_at`, `revoked_by`, `reason`), **global**, with RLS on and
  no policy, reached only through security-definer functions. Current state is
  derived by `customer_tier_at(customer, instant)`, and a trigger snapshots
  `customer_tier` onto `orders` and `bills` from it at the moment of sale. No
  client can name a tier.
- **#57** also built the owner's and manager's **Customers** surface
  (`customer_directory_*`), with one helper answering *which outlets may this
  caller read customers through*, the 30-day figures derived from bills by
  business date, and an index on `bills.customer_id`.
- **#56 / #32**: the till reads a customer only through
  `customer_lookup_by_phone`, `customer_suggest_at_outlet` and
  `customer_create_or_get`. They return id, phone, name and (since #57) a gold
  yes/no. `customers` carries **no aggregate**, and must not.
- **#53**: a bill-level discount is a row in `order_discounts` / `bill_discounts`
  (`basis` percent|amount, `value_bp` | `value_paise`, `amount_paise`). A deferred
  guard holds the parent's `discount_paise` equal to its lines plus its rows.
  There is no `source` column: a row there is, today, always the biller's.
- **#60** (active, payload v3): the outlet's **Orders** settings are columns on
  `outlets`, written by `set_outlet_service_settings` (owner, or the outlet's
  Franchise Admin), read by the counter with its outlet row, and carried with the
  menu and in the resume record. It added the one automatic gold benefit, the
  packaging waiver, which the **tablet** decides.
- **#45**: every post-settlement void stamps `bills.void_kind`
  (`manager_void`, `counter_unpay`, `cancelled_after_paid`).
- **Production, 2026-09-28** (read-only): **zero** rows in `customers` and
  `customer_memberships`; one phone on 2,230 bills; median bill ₹200, mean
  ₹215 to ₹246. Kanchrapara is closed; Kalyani stopped trading on 2026-09-27
  but is still active; **Kalyani Cafe opens 2026-10-01** with every #60 switch
  off. This change is switched on **only at Kalyani Cafe**.

## D0. One release, built in two layers

Everything ships before the 2026-09-30 trial (owner, 2026-09-28: the promise is
points and gold from day one). It is still **built in two layers**, so a short day
leaves a shippable tree rather than half of both:

1. **Points**: D5 to D12's points half, plus D14. It reads gold through #57's
   `customer_tier_at(customer, instant)` unchanged.
2. **Gold per outlet**: D1 to D4, the gold half of D10 and D12, and D13. It widens
   the tier function to take an outlet and changes nothing the first layer wrote.

The layers are independent in the schema: points never read
`customer_memberships` directly, only through the tier function whose signature
the second layer widens.

## D1. Gold belongs to an outlet

`customer_memberships` gains `outlet_id uuid not null references outlets`. The
current tier becomes `customer_tier_at(customer, outlet, instant)`, and the
snapshot trigger passes the order's or bill's own outlet.

**Why this reverses #57.** #57 chose business-wide gold for four reasons. Each is
answered below.

1. *"Per-outlet cannot be verified with one outlet."* That was true of the
   **production** data, and still is. But the isolation suite already runs two
   outlets and proves every other outlet-scoped table that way. The claim is
   testable where it is tested.
2. *"The customer row is already global."* Still true, and still global. Name
   and phone are the person's. Gold, points and spend are **a relationship
   between a person and a shop**, which is exactly what `bills` already models.
3. *"Gold is a brand promise."* Accepted as the real cost. Gold now means *a
   regular at this shop*. The owner offered the change knowing that
   (2026-09-28).
4. *"The franchise objection does not bite while gold is a label."* **It bites
   now.** Gold carries a 50% points cap, free packaging and a future price. A
   franchisee would be honouring and funding a benefit another shop granted.
   Per outlet, it never is.

#57 also argued the asymmetry: adding `outlet_id` later is cheap, starting with
it costs a year of complexity. That held while the table would fill up. It is
**empty in production**, and the complexity is now needed anyway. The spend
rule, the duration and the caps are all per outlet, and making them agree with
business-wide gold would need a rule for *whose* setting wins.

**The migration asserts the table is empty and aborts otherwise.** `seed.sql`
runs after migrations, so it is empty locally and in CI at that point too. A
membership whose outlet cannot be known is never invented.

`customer_memberships` is now **outlet-scoped**, so it gets a select policy (the
owner, and a Franchise Admin of that outlet) and its isolation test. Writes stay
behind security-definer functions, with no insert, update or delete policy.

## D2. Gold ends on a date the grant stored

`customer_memberships` gains `expires_at timestamptz not null` and
`granted_via` (`'management' | 'counter'`), plus `counter_device_id` for a
counter grant.

- `expires_at = granted_at + make_interval(months => outlets.gold_duration_months)`,
  computed **at the grant** from the granting outlet's setting. A later change to
  the setting moves no existing grant. The date is a stored fact, never a
  calculation.
- A spell is **current** while it is not revoked and
  `granted_at <= t < expires_at`. `customer_tier_at` uses the same test.
- **One current spell per customer per outlet.** A unique index cannot say this
  (it would need `now()`), so every grant function takes a row lock on the
  customer's spells at that outlet and refuses when one is current. This is the
  same serialisation the ledger uses (D5).
- A lapse writes nothing. It is a date passing, and the next read derives it.
- Revocation is unchanged: it fills `revoked_at` / `revoked_by` on the spell it
  ends.
- Duration is set by `outlets.gold_duration_months`, 1 to 60, **default 6**,
  **not null**. It applies to every grant, by hand or at the counter, so it lives
  outside the counter-grant switch.

## D3. Eligible, and never the number behind it

A customer is **eligible** at an outlet when all three hold:

- that outlet has gold on and lets billers grant it;
- they hold no current spell there;
- the `total_paise` of their **settled** bills at that outlet, with
  `business_date` inside the last **30** business dates counted back from the
  outlet's current business date, is **at least** `gold_threshold_paise`. The 30
  is a constant, not a setting (owner, 2026-09-29).

The owner first said *"more than 2000"*, then chose **at least** (2026-09-28): a
customer who has spent exactly ₹2,000 would find a strict rule arbitrary, and
*"spend ₹2,000 in a month"* is the sentence a biller can say.

- **What counts is what they paid**: `total_paise`, after every discount and after
  points. Voided bills count for nothing, exactly as #57's figures.
- **A bill counts from the moment the server has it.** An offline bill counts once
  it syncs.
- **Business date, not timestamp.** Same as #57's 30-day figures, for the same
  reason.
- It is derived at read time. Nothing is stored. An index on
  `bills (outlet_id, customer_id, business_date)` serves it. #57's single-column
  index remains for its own reads.

The till receives the **boolean** and nothing else. An eligible flag discloses
*"has spent at least the threshold here recently"*, which is the whole of its
purpose. The amount, the visit count and the dates are never returned.

## D4. The counter grant

`customer_gold_grant_at_counter(p_customer uuid)`:

- **Caller**: an eligible billing context, the same set the lookup accepts (an
  enrolled counter device or a live Biller). **The outlet comes from the
  caller's own authority**, never from an argument.
- **Re-derives eligibility inside the transaction** (D3) and refuses if it no
  longer holds. The tablet's cached flag is a hint, never a permission.
- Writes a spell with `granted_via = 'counter'`, `granted_by` = the operator on
  the device's live shift, and `counter_device_id`, with `expires_at` per D2.
- **Idempotent by outcome**: a second tap after success finds a current spell and
  returns the same state as success rather than a refusal.
- **Online only, and not queued.** It is not a sale, it moves no money, and the
  counter never waits on it to take money. Offline, the control says it needs the
  internet.
- **There is no counter revoke.** Revocation stays with the owner and the
  outlet's managers.
- **Shaped for a price later.** Gold may one day cost money or points. The grant
  is already a server-authorised action with a customer standing at the counter,
  so a price becomes a column on the spell and a charge in the same transaction.
  Nothing is added for it now.

**Management grants** (`customer_membership_grant` / `_revoke`) take the outlet as
an argument and authorise it by `app_is_owner()` or
`app_has_role_at('franchise_admin', outlet)`. A manager may change gold for **any
customer their outlet has served**. #57's "no other outlet has ever served them"
condition existed only because gold was global, and it now remains **only for
rename**. A management grant ignores eligibility: the owner and managers can
still make anybody gold by hand.

## D5. The points ledger

A new outlet-scoped, append-only table:

```
customer_points_entries
  id                 uuid pk
  outlet_id          uuid not null → outlets
  customer_id        uuid not null → customers
  bill_id            uuid not null → bills
  kind               points_entry_kind not null
                     ('earned','used','earned_reversed','used_returned')
  points             integer not null   -- signed: earned +, used −,
                                        --         earned_reversed −, used_returned +
  balance_after      integer not null   -- this customer's balance here after this row
  earn_basis_paise   bigint             -- earned only: what it was earned on
  earn_block_paise   integer            -- earned only: the rule in force
  earn_points_per_block integer         -- earned only
  created_at         timestamptz not null default now()
  unique (bill_id, kind)
```

- **The balance is the sum of `points` for (outlet, customer).** It is derived,
  never a column on `customers`, whose no-aggregate rule (#32, #57) stands.
- **`balance_after` is stored** so the receipt reports a stored figure rather than
  recomputing one (`public-bill-receipt`). Each write takes
  `pg_advisory_xact_lock` on (outlet, customer) before reading the balance, so two
  writes landing together cannot both compute from the same starting figure.
  *(Found while proving it, 2026-09-29: two sales at one outlet never race the
  ledger, because each bill holds the outlet's bill-number counter row until it
  commits. A manager's void takes no number, so a void racing a sale is the case
  the lock actually holds — proved in `zz-billing-command-races.test.ts`, which
  fails with the lock removed.)*
- **`unique (bill_id, kind)` is the idempotency.** A bill earns once, uses once,
  and is reversed once, however often the outbox retries.
- **Append-only**: a guard refuses update and delete, as `bills` does.
- **Attribution comes from the bill.** Its till, shift, operator and outlet are
  one join away, so the ledger does not copy them. Every entry names its bill.
- RLS: select for the owner and a Franchise Admin of that outlet. No write
  policy, because rows are written only by the triggers below. A counter reads a
  balance through the lookup (D10), never this table. **Isolation test.**
- Index on (`outlet_id`, `customer_id`).

## D6. Earning is the server's, at acceptance

A **deferred constraint trigger** on `bills`, firing at commit so the bill's
discount rows already exist (the same reason #53's total guard is deferred),
writes the `used` row (D7) and then the `earned` row when:

- the bill is settled and has a `customer_id`; and
- its outlet has points on **when the bill reaches the server**.

`earn_basis_paise = subtotal_paise − (discount_paise − points_paise)`, the bill
after every discount except points. Tax is always nought in v1. Rounding is not
earned on.

`points = floor(earn_basis_paise × per_block / block_paise)`, integer arithmetic
only. The gold rate applies when the bill's own `customer_tier` snapshot is gold
and the outlet has a gold rate set. A computation of nought writes no row.

**Settings at acceptance, not at the moment of sale.** Settings keep no history,
and an offline bill that arrives after a rate change earns at the new rate. That
is rare (points need a phone, settings change rarely, and the Cafe's tablet is
usually online), and `docs/LIMITATIONS.md` says so. The rule actually used is
stored on the row, so what a bill earned is always explained by the bill.

## D7. Using points is a bill discount from its own source

`order_discounts` and `bill_discounts` gain
`source discount_row_source not null default 'biller'`
(`'biller' | 'points'`). A points row:

- `basis = 'amount'`, `value_paise = amount_paise`, a **whole number of rupees**.
  One point is ₹1, so the points used are `amount_paise / 100`.
- **At most one** per order or bill, and **only when the order has a customer**.
- Carried from the order to the bill exactly as a biller's bill discount is, and
  counted by the existing parts-equal-the-whole guard.

**Where the biller applies it**: a button beside **Add discount** on the
composer that says what it will use, *Use 27 points*: the most allowed, which is
the balance unless the cap is lower (owner, 2026-09-29). It opens a pad of its
own, pre-filled with that number: the readout, then *Balance* and *Max this bill*
(with its share of the bill, *10% off*) as two plain figures, then **Back** and
**Use points**. The biller types any other number; more than the max replaces
the readout's *₹N off* with *At most N on this bill* and leaves **Use points**
off. Where the cap is what stops the max, the share shown is the cap itself: 10%
of ₹139 is ₹13.90, whole points make that 13, and 13 is 9.35% of the bill. The
points then read on the bill as their own row, *Points (27)*, which the biller
edits or removes from the row.

**The most allowed** is the least of:

- the balance the tablet was just given (D10);
- `floor((subtotal − other discounts) × cap_bp / 10000)`, in whole rupees, with
  `cap_bp` the gold cap when the tablet knows the customer is gold here and the
  regular cap otherwise;
- `subtotal − other discounts − ₹1`, so points never buy the ₹1 floor that the
  rounding line would put back.

The cap is taken **after other discounts**, the owner's choice. This is the one
place a discount is computed against something other than the gross of its own
scope (#53). It stays order-independent because the points amount is a fixed
number of rupees, and the tablet re-evaluates the most allowed on every change to
the order. **The biller's request is held, and the points row is the lesser of it
and the most allowed**, so it falls when the order shrinks and comes back up to
what was asked, and never past it, if the order grows again. *(Built this way in
section 1, 2026-09-28: the first draft said "never raised on its own", which would
have left a biller who removed and re-added an item short of the points the
customer asked for.)* Changing or skipping the customer removes it, because the
points belonged to that customer.

## D8. What the boundary checks, and what it deliberately does not

**Checked, and refused as `malformed`:** a points row's shape (amount basis,
whole rupees, `value_paise = amount_paise`), at most one, only with a customer,
and never more than the order after other discounts minus ₹1.

**Not checked: the balance and the cap.** A biller can already take any amount
off any bill by hand (#53). A points row that over-reaches therefore gives away
nothing the same biller could not give without points. Refusing it would refuse
a **paid** sale and strand the money, which is #60 D4's argument for the gold
waiver. So the ledger records what happened:

- a use beyond the balance leaves `balance_after` negative, visible to the owner
  and on the next lookup, where nothing more can be used until it recovers;
- a use beyond the cap is on the bill beside its subtotal, readable by anybody
  auditing.

The ledger is the control. The boundary guards its shape.

## D9. The payload, version 4

The bill-level discount entries in the order and payment content payloads gain
`source` (`'biller' | 'points'`). `BILLING_COMMAND_SCHEMA_VERSION` becomes 4. **The
boundary accepts 1 to 4**, reading an entry without `source` as `'biller'`,
exactly as #53 and #60 read the shapes before theirs. New shared vectors prove the
canonical JSON and hash across runtimes for v4, and the existing ones keep
passing. `lint:discount-rows` gains a points case.

## D10. What the till is told

`customer_lookup_by_phone`, `customer_suggest_at_outlet` and
`customer_create_or_get` each return, **for the caller's own outlet** (from the
caller's authority, never an argument):

- `is_member` (the column keeps #57's name): a current spell here, yes or no (replacing the business-wide yes or
  no);
- `points_balance`: the ledger balance here, **minus points on this customer's
  open orders here**, so two open orders cannot both use the same points. Null when
  the outlet has points off;
- `gold_eligible`: D3, yes or no.

Nothing else: no spend, no visits, no dates, no actor, no other outlet. The
exactness, the rate bound and the attempt table's rule against recording what was
asked are all unchanged.

**What the tablet does with them.** The customer dialog shows the balance large
on the right of the customer's card, where the card had nothing (owner,
2026-09-29); the composer's customer row shows no balance, and the *Use N points*
button carries the number that matters on this bill. An eligible customer's card
says *Eligible for gold* with an **Upgrade to Gold** button. The resume record
remembers all three, for display only. **Use points is
enabled only when the balance came from a server read made after this order's
customer was identified** (the dialog's own lookup, or a refresh it triggers).
A remembered balance is shown and labelled as remembered, and cannot be used.
That is what *"using points needs the server"* means in code.

## D11. A void reverses the ledger

When a bill becomes void (any `void_kind`), a trigger in the same transaction
writes `earned_reversed` (minus what it earned) and `used_returned` (plus what it
used), each under the same lock and uniqueness as D5. A re-rung bill then earns
and uses afresh. The balance may go negative (the owner's choice, 2026-09-28);
nothing can be used while it is not positive.

## D12. The settings

Columns on `outlets`, with checks stated on the table so a hand-crafted request
meets them:

```
points_enabled                    boolean not null default false
points_earn_per_block             integer null    -- > 0
points_earn_block_paise           integer null    -- > 0, whole rupees
points_use_cap_bp                 integer null    -- 1..10000
gold_enabled                      boolean not null default false
gold_earn_multiplier_x100         integer not null default 100   -- 100..1000
points_gold_use_cap_bp            integer null    -- use_cap..10000
gold_duration_months              integer not null default 6     -- 1..60
gold_counter_grant                boolean not null default false
gold_threshold_paise              integer null    -- > 0, whole rupees
```

As the owner reworked it on 2026-09-29, replacing a gold earn pair and a
threshold window in days:

- The earn pair and the cap are non-null exactly when `points_enabled`.
- **`gold_enabled` is its own switch.** With it off the outlet has no gold: the
  tier function answers none there, grants are refused, and the gold cap and the
  multiplier apply to nobody. Spells granted while it was on stay on the record,
  and count again if it comes back on before their own end.
- **The gold earn rate is a multiplier**, in hundredths so it stays an integer:
  100 is 1×, 150 is 1.5×, never below 100. A gold bill earns
  `floor(basis × points × multiplier / (block × 100))`.
- The gold cap is non-null exactly when points **and** gold are on, and is never
  below `points_use_cap_bp`.
- `gold_counter_grant` needs `gold_enabled`, and the threshold is non-null
  exactly when it is on. **The window is always 30 days** and is not a column.
- **Every existing outlet takes the defaults, all off**, and the migration asserts
  it.
- Turning points **off** stops earning and using at that outlet. Balances remain,
  the owner still reads them, and they resume if points come back on.
- Defaults when a switch is first turned on, in the UI: 5 points per ₹200, 1×,
  10% / 50%; billers may upgrade to Gold at ₹2,000 a month.
- Written by one narrow function, `set_outlet_loyalty_settings(outlet, …)`, with
  #60's authority rule (the owner, or that outlet's Franchise Admin, live
  account). **`outlets_update` is not widened.**
- Read with the outlet row, carried with the menu on #60's path and in the resume
  record, so the counter's caps and the Use points control follow the outlet
  offline.

## D13. The Customers page becomes outlet-scoped

- Every management read takes **one outlet**, authorised as in D4, and the page
  carries the remembered outlet chips every outlet-scoped screen uses. With one
  trading outlet it is a single chip.
- Search, both lists, the card's 30-day figures, *last seen* and *first visit
  here* all read that outlet's bills. #57's multi-outlet helper narrows to a
  single-outlet check. The rule is still written once.
- **The card** adds *Gold until 28 Mar 2027* (or *Gold ended 28 Mar*), the points
  balance here, and **how gold was given** (*at the counter by Priya* or *by you*),
  which is the audit trail the owner asked for (2026-09-28).
- **The gold list** shows each member's end date and gains a second order,
  **recent visits** (visits in the last 30 days, then most recent visit),
  alongside newest grant.
- The owner and the outlet's managers grant and revoke per D4. Rename keeps #57's
  whole-history condition.

## D14. The receipt

Beneath the discount rows, when the bill has ledger rows:

```
Points used          20        (already a discount row: Points (20))
Points earned         5
Points balance       42
```

Every figure is read from the bill's own ledger rows: `points`, and
`balance_after` from the bill's last row. Nothing is recomputed. It names nobody,
so `public-bill-receipt`'s *"names no customer"* holds. What a stranger holding
the link learns is one unnamed balance. A voided bill's receipt keeps its figures
under the existing *void* treatment.

**Two repositories.** Here: `bill_public_receipt` gains the three figures, and
`bill_public_discount_rows` returns a points row with `source = 'points'`, in the
bill's own discount rows, so the printed rows still add up to the stored discount
(the same shape #60 used for the packaging waiver). There: a sibling change in
the landing repository renders the row as *Points (20)* and the section above, on
the page and in the PDF, which must agree. Ops deploys first: an added field is
inert to the current Worker, whose `source: 'menu' | 'bill'` typing would draw a
points row as *Discount (₹20) · On this bill*, the right amount in the wrong words,
until the sibling lands. Both land before the trial.

## D16. The published privacy page moves first

`shawarmania.in/privacy/` is a published document, submitted as the privacy policy
of the RCS registration (#59). It promises that giving a number changes no price,
lists its uses as *"the whole list"* without points, and describes removal without
mentioning forfeiture. From 2026-10-01 the counter asks for numbers *for* points,
so the page is wrong from the first real bill unless it is amended first.

The amendment adds points and gold to the uses: per outlet, earned on bills,
never sold or shared. It replaces the *"costs more or less"* sentence with an
honest one: giving a number earns points, and the menu price is the same either
way. It says gold is given for spending at an outlet, a rule rather than a
score. And it says removal forfeits the balance and gold. It is the landing
repository's change, and it is live before the Cafe's first real bill.
**Published 2026-09-29** (landing `6a4729d`): the owner left the wording to the
agent, and the page gained a short *Points and gold* section besides. #59 inherits the same page when it separates *stop
messaging* from *leave the points programme*.

## D15. Deleting trial bills

The owner will delete the trial's bills by hand, with the procedure they already
use for production test data. The ledger adds one step and one trap:

- `customer_points_entries` references `bills` and is append-only, so its rows for
  those bills are deleted **first**, with its guard lifted the same way the bill
  guards are.
- **`balance_after` is a stored running figure.** Deleting a trial customer's
  rows after that customer has real bills leaves every later row's
  `balance_after` including points that no longer exist. So the trial uses phone
  numbers that will not be real customers, or its rows are deleted before the
  first real bill. The balance itself is a sum and stays right either way; only
  the receipt's stored balance would be stale.

## Money arithmetic

- Points are integers. One point = 100 paise, fixed. A points discount is
  `points × 100` paise, a whole number of rupees.
- Earning: `floor(basis_paise × per_block / block_paise)`, integer division on
  non-negative integers. Basis in paise, bigint.
- Cap: `floor(net_paise × cap_bp / 10000 / 100)` whole rupees, `net` being
  subtotal minus non-points discounts; also ≤ `net − 100` and ≤ balance.
- No new term in the totals identity. A points row is a bill-level discount and
  already inside `discount_paise`, the cap at the subtotal and the rounding.
  `lint:totals` needs no case; `lint:discount-rows` gains one.
- Every setting holding rupees is a whole number of rupees in paise.

## RLS

- **New outlet-scoped table** `customer_points_entries`: select for the owner and
  the outlet's Franchise Admins; no write policy; isolation test.
- **`customer_memberships` becomes outlet-scoped**: gains a select policy of the
  same shape and joins the isolation suite. `01_schema_coverage.sql`'s
  classification moves it from global to outlet-scoped.
- New columns on `outlets`, `order_discounts` and `bill_discounts` are covered by
  those tables' existing policies, and the isolation suite is **extended** to
  prove it.
- Every new function re-derives authority from the caller: management by
  `app_is_owner()` / `app_has_role_at('franchise_admin', outlet)`, the counter
  by the lookup's eligibility with the outlet from the device or shift. No
  function takes an outlet from a billing caller.

## Offline

- **Earning works offline**: the server computes it when the bill arrives (D6),
  exactly once (D5).
- **Using points does not**: the control needs a server read made during this
  order (D10). A tablet that goes offline after that read may still pay the
  order, because the counter never blocks. If another till spent the same points
  meanwhile, the balance goes negative, and D8 records it.
- **The counter grant does not**: it is an online action (D4).
- Settings, balances and gold state ride the resume record for display.
- v1 to v3 payloads queued before the release settle exactly once (D9).

## Rejected alternatives

- **Business-wide points.** The owner asked (2026-09-28) whether per outlet was
  simpler, and it is. A franchise funds only its own points, a manager's rules
  cost only their own outlet, and per-outlet rules need no *whose rule wins*.
  The cost, a customer holding separate balances at separate shops, is invisible
  with one outlet.
- **Business-wide gold, with per-outlet rules.** Proposed first. It needed
  *whose duration*, *whose spend* and *who honours whose grant*, each answered by
  a special case. D1.
- **Points expire.** Proposed; the owner chose to let them accumulate and add
  expiry later. The ledger dates every earn, so expiry needs no backfill.
- **Whole ₹200 blocks.** A ₹399 bill would earn what a ₹200 one does. Owner chose
  proportional.
- **Earning on what was paid after points.** The owner chose to earn before
  points: a customer spending points should not be penalised for it. Points
  earning points is under 3% of the used amount, and rounding eats it.
- **A configurable point value.** Changing it would silently revalue every
  balance already held. The earn rate reaches every economic outcome a value
  change could, without touching what customers hold.
- **Points as a tender method.** Points are not money received. A tender enters
  the drawer's reconciliation and the day's Cash and UPI. A discount is where a
  reduction belongs (#53).
- **Refusing a points row over the cap or the balance at the boundary.** It
  strands paid sales to protect a reduction the biller could make anyway. D8.
- **Holding points with a server reservation at Use points.** It needs an online
  round trip in the money path and an expiry story for abandoned holds.
  Subtracting open orders' points from the balance (D10) gets most of the safety
  for none of that.
- **A balance column, on `customers` or in a balance table.** The first breaks the
  no-aggregate rule. The second is a cache to keep true. The derived sum is cheap
  at this scale; revisit if it is not.
- **Automatic gold when the threshold is crossed.** The owner wants the customer
  told and asked (2026-09-28), and a future price makes consent necessary.
- **Revoking at the counter.** Not asked for; a revocation is a decision about a
  customer, not a sale.
- **Verifying the number with a code.** The owner is not concerned yet
  (2026-09-28); it costs money and slows the counter. Attributable rows instead.
- **Crediting bills rung before switch-on.** The owner chose zero. If the owner
  changes their mind, a one-time catch-up from 2026-10-01 is a migration over
  settled bills with customers, earning at the switched-on rate.

## Decisions

**2026-09-28, with the owner, before the proposal:**

- Earn 5 per ₹200, proportional, rounded down per bill; on the bill after other
  discounts and before points.
- Gold earns at the same rate by default; a setting gives gold its own rate.
  *(Reworked 2026-09-29: a multiplier of 1× or more, not a second rate.)*
- Use at most 10%, gold 50%, of the bill after other discounts; combine with other
  discounts; partial use allowed.
- The biller sees the balance and eligibility, never spend or visits.
- Receipt shows earned, used and balance; #59's SMS will too.
- Points per outlet, and gold per outlet (the owner's offer, accepted with its
  cost).
- The owner and the outlet's Franchise Admin set the rules.
- No expiry for points; gold lasts 6 months from each grant, set per outlet, shown
  on the owner's list.
- Voids reverse; a balance may go negative; start at zero.
- Using points is online only; earning is not.
- Eligibility counts paid bills at this outlet over the last 30 days; the counter
  grant needs the customer's agreement and has no revoke.
- Auditable from the database; the gold list sorts by recent visits.
- The Customers page gains the outlet chips.
- The Cafe asks every willing customer for their number from 2026-10-01, so the
  spend rule has data on launch day.
- Points **and** gold are live from the Cafe's first bill on 2026-10-01, all of it
  shipped before the trial on 2026-09-30. A split that deferred gold a week was
  proposed and refused: customers have been promised both.
- **Use points** sits beside **Discount** on the composer, not in the payment
  panel.
- The threshold is **at least** ₹2,000.
- Until #59 texts receipts, a customer learns their balance from the biller, who
  reads it off the screen. No receipt QR at the counter in this change.
- The owner deletes the 2026-09-30 trial bills themself. See D15.

**2026-09-29, at the owner's look at the settings in the demo:**

- Gold is its own switch per outlet. Off hides every gold option everywhere and
  makes nobody gold there.
- Gold members earn by a multiplier, never below 1×.
- *Use at most* becomes *Max points discount*, with gold members on their own line,
  never below everybody's.
- *Gold lasts* becomes *Valid for*; *Make gold at the counter* becomes *Allow
  billers to make gold*; *After spending* becomes *Min monthly spend for gold*,
  in rupees only, the 30 days fixed.
- The number boxes are sized to the words around them.
- *Spent enough here to be gold* on the counter's card is *Eligible for gold*, and
  every *Make gold* is **Upgrade to Gold**: gold should read as an upgrade.
- The Use points pad is a readout, two plain figures (*Balance*, *Max this bill*
  with its share of the bill) and Back / Use points. It opens on the max and the
  biller types anything else; over the max says so inside the readout. A
  clickable Max tile and a one-tap *Use max* button were both built and dropped
  as more than the counter needs.
- The monthly threshold is labelled *Gold eligibility*, its hint saying it is the
  minimum monthly spend, matching the counter's *Eligible for gold*.
