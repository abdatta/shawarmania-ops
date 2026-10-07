# Proposal: a-regular-earns-points-and-gold

> **Model**: Opus · **Wave**: F · **Depends on**: #60, #57, #56, #54 · **Gate**: a customer who gives their number at an outlet that has switched points on earns points on every bill they pay there, in proportion to what they paid before any points were used, and sees what they earned, what they used and what they hold on their own receipt; a biller sees that customer's balance at this outlet, uses some or all of it on the bill in front of them up to the outlet's cap (a higher cap for gold members), and cannot use points the tablet has not just read from the server; a biller sees that a customer is eligible for gold here, without seeing how much they spent, and upgrades them to Gold at the counter once the customer agrees; gold belongs to one outlet and ends on the date its grant stored; a voided bill takes back what it earned and returns what it used; every earn, use, reversal and grant is a stored row naming the bill, the till and the person; the owner and the outlet's own managers set every number on the outlet's own page, and a new outlet starts with all of it off and bills exactly as today; every such bill rung offline settles exactly once; the owner settled the counter and the settings in the demo first; and the four-role demo walkthrough still walks.

## Why

The owner wants regulars rewarded automatically, not by a biller remembering
to give a discount. #57 made gold **a label**, granted by hand and changing no
total. #60 made one exception (free packaging). This change is the programme
#57 deferred: **points on every bill, and gold earned by spending**.

It is also what finally gives the counter a reason to ask for a number. On
production, 2026-09-28: **one** of 2,230 bills ever carried a phone, and there
are **zero** saved customers and **zero** gold members. *"Can I have your
number? You'll earn points"* is a sentence a customer says yes to. The owner
confirmed the Cafe will ask every customer willing to give one from its
opening on 2026-10-01, before this ships, so the gold rule has real spend to
read on launch day.

## The rules, as the owner set them (2026-09-28)

Worked at the default numbers. **Every number here is a setting**, and an outlet
starts with all of it off.

- **Earning.** ₹200 earns 5 points, **in proportion, rounded down per bill**:
  a ₹399 bill earns 9, not 5. One point is worth ₹1 off.
- **What it earns on.** The bill **after every other discount, and before points
  were used**. A ₹200 bill paid as ₹180 plus 20 points earns 5, not 4.
  The rounding line is not earned on.
- **Gold members earn at the same rate by default.** The outlet may set a
  multiplier for them, 1× or more: 1.2×, 1.5×, 2× (owner, 2026-09-29).
- **Using points.** A customer may use some or all of their balance. At most
  **10%** of the bill after other discounts, or **50%** for a gold member; the
  gold cap is never below everybody's. Points combine with menu and biller
  discounts.
- **Points never expire** for now. Expiry can be added later; the ledger keeps
  the date of every earn, so it can be added without a backfill.
- **A voided bill takes back what it earned and returns what it used.** A
  balance may go **negative** when the earned points were already spent. The next
  purchase fills the hole, and nothing is used while the balance is not positive.
- **Everybody starts at zero** on the day an outlet switches points on. No points
  for bills rung before.
- **Using points needs the server.** Earning works offline, because the server
  works out the points when the bill arrives. Using points is offered only when
  the tablet has just read the balance from the server.

### Gold, now per outlet

- **Gold belongs to one outlet**, like points. The owner offered it, and it
  removes more than it adds: the spend rule, the duration and the caps are each
  that outlet's own, and a franchisee never honours a gold they did not grant.
  This reverses #57's business-wide choice, and `design.md` argues the reversal
  rather than ignoring #57's reasons.
- **Earned by spending here.** A customer who has paid **at least ₹2,000 at this
  outlet in the last 30 days** is **eligible**. The window rolls, so a bill counts
  for 30 days and then stops. The amount is a setting; **the 30 days is not**
  (owner, 2026-09-29): it is always a monthly spend. A bill counts from the moment the server has it.
  Exactly ₹2,000 qualifies (owner, 2026-09-28).
- **Upgraded to Gold at the counter, with the customer's agreement.** The biller
  sees *Eligible for gold*, and never the amount behind it. They tell the
  customer what gold gets them, and tap **Upgrade to Gold** once the customer agrees.
  The owner's reason: the conversation happens at the counter, and gold may
  later carry a price in money or points, which only works with the customer
  standing there.
- **Gold ends.** Every grant stores its own end date, **six months** after it
  was granted by default. Granted by the owner or a manager by hand, or by a
  biller at the counter, the rule is the same. When it lapses and the customer
  still qualifies, the counter offers it again.
- **The owner sees the end date** on the gold list and the customer's card. The
  gold list can be sorted by recent visits, which is how the owner expects to
  spot one number sitting on top suspiciously often.

### Where it is set

A new **Loyalty** section on the outlet's own page, next to #60's **Orders**,
and settled the same way: a switch per idea, options opening inside their tile,
and one **Save**. As the owner reworked it on 2026-09-29, with small boxes sized to
the words around them, and settled at the checkpoint that day:

```
LOYALTY
┌ Points                                              [ off ] ┐
│ ┌ Earn            [5] points for every ₹ [200]             ┐│
│ ┌ Max points discount                            [10] %    ┐│
│ ┌ Max for gold members  (at least the above)     [50] %    ┐│  gold on
│ ┌ Gold members points multiplier  (1× = same)  [1.5] ×   ┐│  gold on
└─────────────────────────────────────────────────────────────┘
┌ Gold members                                        [ off ] ┐
│ ┌ Valid for                                   [6] months   ┐│
│ ┌ Allow billers to upgrade to Gold                  [ off ] ┐│
│ │ ┌ Gold eligibility  (min monthly spend)  ₹ [2000]        ┐│
└─────────────────────────────────────────────────────────────┘
```

**Gold is a switch of its own** (owner, 2026-09-29): not every outlet needs gold
members. While it is off, nothing about gold appears anywhere for that outlet —
not the gold rows above, not Orders' *Free for gold members*, not the Gold tab or
the gold row on the Customers page, and nobody is gold at its counter.

**Every gold-only setting is shown twice** (owner, 2026-09-29): in its own place
and again under Gold members, as one value, so turning gold on shows everything
it changes. Today that is the gold points cap and multiplier (above) and Orders'
*Free for gold members*, which Loyalty's Save also saves. The rule is written into
`docs/DESIGN_SYSTEM.md` for every later gold setting.

The owner sets it for any outlet, and **a Franchise Admin for the outlets they
manage** (owner, 2026-09-28). Points are per outlet, so a manager's rules cost
only their own outlet.

## What changes, for each person

### The customer

- Earns points on every bill at an outlet with points on, once they have given
  their number.
- Until receipts are texted (#59), they learn their balance from the biller, who reads it off the
  screen (owner, 2026-09-28).
- Their **receipt** says what this bill earned, what it used, and what they now
  hold. A later change that texts the receipt (`bill-receipt-delivery`, #59)
  will carry the same three figures in the message. That is its work, not this
  change's.

### The biller

- Identifying a customer shows their **points balance at this outlet**, large on
  the right of their card in the customer dialog (owner, 2026-09-29). The
  composer's customer row carries no balance.
- **Use N points**, beside **Add discount**, says how many points this bill can
  take (the balance, unless the cap is lower). It opens a pad pre-filled with
  that number, showing *Balance* and *Max this bill* (with its share of the bill,
  e.g. *10% off*) as plain figures, and **Back** / **Use points**. The biller
  types any other number; more than the max says so inside the readout. The
  points land on the bill as their own discount row, *Points (20)*. It is
  disabled, and says why, when the tablet has no fresh balance from the server.
- An **eligible** customer's card says *Eligible for gold* with an **Upgrade to
  Gold** button. Its confirmation reads *"Check with the customer first. Once
  upgraded, their Gold is valid until **30 Mar 2027**."* with **Upgrade**. There
  is no revoke at the counter.
- **Never shown**: how much the customer has spent, how many times they came,
  when their gold started, or who granted it.

### The owner and the outlet's managers

- The **Loyalty** settings above.
- The **Customers** page becomes outlet-scoped, with the same remembered outlet
  chips every outlet-scoped screen uses (owner, 2026-09-28). Everything on it now
  belongs to an outlet: the regulars list, the gold list with each member's end
  date, the card's gold state and end date, the points balance, and the 30-day
  visits and spend. Search finds the customers the chosen outlet has served.
- A manager grants and revokes gold **for any customer their outlet has served**.
  #57's "only a customer no other outlet has served" rule existed because gold
  was business-wide. It stays for **renaming**, because the name still belongs to
  the one person.

## What this reverses, deliberately

Each of these is amended in the living spec **with its reason**, not deleted:

- **#57: "Membership is business-wide, and it is a label."** Now per outlet, and
  it carries benefits.
- **#57: "a Biller … SHALL be refused" any grant.** A biller may now grant, at
  their own outlet, only to an eligible customer, and may never revoke.
- **#57's accepted cost, "what did gold cost us is unanswerable."** Points are
  their own discount source from their first day, so *"what did points cost us
  this month"* is a sum over stored rows.
- **#32/#57: the till's lookup response.** It grows from *"membership, yes or
  no"* to *gold here, yes or no; points balance here; eligible for gold here, yes
  or no*. Its one cross-outlet leak narrows instead: gold is now this outlet's,
  so a biller no longer learns anything about gold granted at another outlet.

## Non-goals

- **No point expiry.** The owner chose to let points accumulate for now.
- **No points or gold across outlets.** A balance earned at one outlet is used
  only there. No transfer, no merge, no business-wide balance.
- **No charge for gold.** Planned; the counter grant is shaped for it (see
  `design.md`), but nothing here takes money or points for gold.
- **No tiers beyond gold**, and no rate beyond one gold rate.
- **No configurable point value.** One point is ₹1. `design.md` says why.
- **No SMS.** #59's work.
- **No verification that a number belongs to the person giving it.** The owner is
  not concerned yet (2026-09-28); every row is attributable instead.
- **No revoking at the counter**, and no gold granted to anybody the rule does not
  make eligible.
- **No points for bills rung before an outlet switches points on.**
- **No change to who may rename a customer.**
- **Nothing on the receipt about who the customer is.** That is #58, which adds
  the last four digits and a gold mark and never a name; the points figures here
  name nobody.

## One release, before the trial

The owner has promised customers all of it from the Cafe's first bill on
2026-10-01 (owner, 2026-09-28). **Everything ships before the trial on
2026-09-30**; the trial exercises it on the real tablet, its edges are fixed the
same day, and the fixes are deployed before the Cafe opens on 2026-10-01.

An earlier draft split gold into a second release the following week. The owner
refused it: the promise is points **and** gold from day one.

**Why the window before opening is the safe one.** No outlet is trading between
Kalyani's last bill (2026-09-27) and the Cafe's first. A release to the money path
is least risky now, and most risky in the Cafe's first week.

**UI first, as in #56, #57 and #60, with one checkpoint for all of it**: the whole
of the demo (the Loyalty settings, the counter's balance, **Use points** and
**Upgrade to Gold**, the receipt, the outlet-scoped Customers page), then **🧍 the owner's
checkpoint**, then the database. **Settled 2026-09-29.**

**Build the database in the order that keeps a working state.** Points first (they
read #57's tier unchanged), then gold per outlet, which only widens the tier
function points already call (`design.md` D0). If the day runs short, the tree
still holds a shippable points build rather than half of both.

## This is a two-repository change, and one part must land before opening

The receipt page, its PDF and the published privacy page live in the landing
repository (`shawarmania/`), not here. Found while checking #58 and #59 against
this proposal (2026-09-28).

**The published privacy page contradicts points, and it must be amended before
2026-10-01.** `shawarmania.in/privacy/` was submitted with the RCS registration
(#59) and says, of the mobile number:

- *"Nothing on the menu costs more or less depending on whether you do"* (give
  it). With points, giving it is exactly what makes the next bill cheaper.
- *"What we use it for"* lists sending the bill, recognising a returning
  customer and running the business, then *"That is the whole list."* Points and
  gold are not on it.
- *"we do not score you"*. Gold eligibility is a spend threshold, a plain rule
  rather than a score, but the page should say what it is rather than leave a
  reader to decide.
- On removal: the number *"stops being connected to you"*. With points, removal
  also forfeits the balance and gold at every outlet, and the page should say so.

#59's own rule applies: **the page changes first, and the system follows.** On
2026-10-01 the counter starts asking for numbers to earn points, so the amended
page must be live before the first real bill. **Done 2026-09-29**: the owner left
the wording to the agent, and it was published from the landing repository
(`6a4729d`, with its legal-pages spec delta), including a short *Points and gold*
section.

**The receipt renders points in the landing Worker.** Here, the public reader
(`bill_public_receipt`, `bill_public_discount_rows`) returns the points figures and
a `points` discount source. There, a sibling landing change renders them. Until
it does, the Worker's `source: 'menu' | 'bill'` typing sends a points row down
the bill branch as *Discount (₹20) · On this bill*: the right amount in the wrong
words. That is harmless but wrong, so both land before the trial. Ops ships
first, because an added field the page does not yet render breaks nothing,
while a page expecting a field the reader does not return would.

## How to run the gate

- At `/demo`, then for real: switch points and counter gold on for one outlet.
  Ring a bill for an identified customer and confirm the points on the receipt.
  Ring a second bill using points up to the cap, then a gold member's bill up to
  theirs. Void one and confirm the balance moves back.
- Make a customer eligible by spending the threshold, see *Eligible for gold* and
  **Upgrade to Gold** at the counter with no figure beside it, grant it, and
  confirm the owner's gold list shows the end date and who gave it. Move the clock past it and confirm the star goes and the
  offer returns.
- Offline: ring bills for an identified customer, confirm **Use points** is
  refused offline, reconnect, and confirm every bill settles once and earns once.
- Confirm the other outlet's biller, device and manager read no balance, no gold
  and no ledger row of this outlet, **by hand-crafted request with a valid
  session**. Confirm a biller cannot revoke gold or grant it to a customer who is
  not eligible.
- Light and dark; the settings and Customers pages at phone width, the counter
  at tablet width.

## User-only gate steps

- 🧍 The owner walks the demo at the checkpoint on 2026-09-29 and settles the UI
  before any database work begins.
- 🧍 Before the 2026-09-30 trial, the owner reloads the Cafe tablet and switches
  points and counter gold on at Kalyani Cafe; the trial's bills earn, use, void and
  make a customer gold correctly, and every edge it finds is fixed and deployed
  before 2026-10-01.
- 🧍 The amended privacy page is live on `shawarmania.in` before the Cafe's first
  real bill. *(Done 2026-09-29: the owner left the wording to the agent.)*
- 🧍 The owner switches it on at Kalyani Cafe, and a real customer earns and uses
  real points and is upgraded to Gold at the counter. Tasks complete is not the archive
  trigger; real use is.

## Docs to update before archiving

- `docs/BUSINESS_CONTEXT.md`: points and earned gold as how the counter treats
  regulars.
- `docs/DESIGN_SYSTEM.md`: every gold-only setting shown twice, in its own section and
  under Gold members, as one value (owner, 2026-09-29). *(Written 2026-09-29.)*
- `docs/GLOSSARY.md`: *points*, *balance*, *eligible*, and *gold* as an outlet's.
- `docs/DATA_MODEL.md`: the points ledger, per-outlet membership with its end
  date, the settings columns, and the `points` discount source.
- `docs/ROLES_AND_PERMISSIONS.md`: the biller's counter grant, the manager's
  wider gold authority, and who sets the rules.
- `docs/SECURITY_AND_PRIVACY.md`: the lookup response's new fields and what they
  disclose, and the narrowed cross-outlet leak.
- `docs/SCREENS.md`: the Loyalty section, the customer card's balance, *Eligible
  for gold* and Upgrade to Gold, the Use points button and pad, the outlet-scoped
  Customers page, and the receipt's figures.
- `docs/OFFLINE_AND_SYNC.md`: earning offline, using points only online, and the
  negative balance a race can leave.
- `docs/LIMITATIONS.md`: rewrite *"One customer identity, a gold label, and
  deliberately little else"*; the unverified phone; a settings change racing an
  offline bill.
- `docs/DEMO_MODE.md`: the loyalty fixtures and the walkthrough steps.
- In the landing repository: `privacy/` before 2026-10-01. *(Done 2026-09-29,
  `6a4729d`.)* `messages/`' wording on STOP is #59's to correct.
- `openspec/todos/customer-loyalty-and-cross-outlet-insights.md`: narrow it to
  what remains (cross-outlet insight, expiry, consent language, merge and split).
