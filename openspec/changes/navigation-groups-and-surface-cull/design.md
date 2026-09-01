## Context

Sixteen flat navigation entries, on a phone. The todo that recorded this gap
([`navigation-outgrows-a-flat-list.md`](../../todos/navigation-outgrows-a-flat-list.md))
named three things that make it harder than "add a menu", and all three still
hold:

- **The list is not one role's.** A person sees every surface the roles they can
  reach declare. A manager who also grills at the other outlet gets both sets;
  the owner reaches the outlet-level surfaces holding no assignment anywhere. Any
  grouping has to survive one person seeing two roles' worth of entries and must
  not imply they have become somebody else.
- **The order is meaningful and hand-set.** `nav.order` exists because how often
  a tab is reached for is a real fact about this business. Grouping must not
  quietly become alphabetical, and the ordering argument has to survive inside a
  group as well as between groups.
- **One entry already sits inside another.** Expenses and Delivery live under the
  Ledger's path, and the shell indents them and lights only the most specific
  entry. Whatever lands here should generalise that rather than introduce a
  second mechanism beside it.

**A working sketch of this design was built and reviewed by the owner on
2026-08-31**, on the demo tree at both phone and desktop widths. It went through
three visual iterations before approval; the rejected two are recorded below
because a fresh session would otherwise rediscover them.

**The sketch was deleted rather than committed**, on the owner's instruction, so
this folder is the specification and the implementation is a rebuild from it, not
a tidy-up of leftover code. Six reference screenshots and their geometry notes
were captured immediately before deletion and live **outside the repository, and
outside git**, at `C:/Users/iamro/Code/shawarmania-ops-nav-sketch/`. They are a
convenience, not a dependency: every measurement in them is repeated under
"Geometry" below, so the change is buildable if that folder is gone.

## Goals / Non-Goals

**Goals:**

- Four top-level entries on the owner's phone, reachable without scrolling.
- No surface changes address, so every existing link keeps resolving.
- Waiting work stays visible when the group holding it is shut.
- A Franchise Admin can administer the tablet at an outlet they manage.
- The codebase stops carrying seven screens the business will not build.

**Non-Goals:**

- Dropping tables, policies or migrations.
- Reimplementing outlet alerts as a new feature.
- Letting a Franchise Admin write to an outlet record.
- Remembering which group was open across a reload.

## Decisions

### A group is metadata on a surface, not a path

`nav` gains `group?: NavGroupId`, and a `NAV_GROUPS` record supplies each
group's label, icon and order. `navTree(items)` folds the flat list from
`visibleSurfaces` into top-level nodes that are either a surface or a group with
children.

**Re-pathing to `/owner/finances/*` was rejected.** Neither Finances nor Setup is
a place anybody can stand — there is no page there and there should not be one.
Inventing addresses for them would mean re-homing eight live routes the owner has
on their phone, plus their redirects, to buy an address nobody would open. Paths
stay exactly where they are; only where an entry is *drawn* changes.

**Deriving groups from path prefixes was also rejected**, even though the shell
already does that for `ledger/expenses` under `ledger`. It can only express a
group that is itself a surface, which is the thing being ruled out above. Path
nesting is deliberately **not applied inside a group**: Expenses lives under the
Ledger's path but is drawn as its sibling in Finances, because two levels of
structure over four entries is one more than the reader needs.

### The groups are Finances and Setup, and Delivery is in Setup

**Finances** — Billing, Drawer, Expenses, Ledger. Named Finances rather than
Sales: it holds Expenses, which is money out, so Sales was the wrong word for the
drawer it labels. Its icon is `Coins` (owner decision, 2026-09-01) — `Wallet` is
Expenses's and `Banknote` is the Drawer's, so the group cannot take either
without reading as one of its own children.

**Setup** — Outlets, People, Delivery, Menu, Tablets. Things you change when
something changes, rather than things you read every evening.

**Delivery is in Setup, not Finances**, and the owner's reason is worth keeping
verbatim: *that page is not much about revenue and more about checking if the
Zomato/Swiggy sync setup is working as intended, and if not, setting it up again
with OTP*. The figures it produces are read in the Ledger; the page itself is
about whether the machinery is running.

This is the one placement most likely to be revisited, because Delivery is the
only entry in Setup that carries live waiting work. The group-sum badge below is
what makes it safe.

### A collapsed group sums its children; an open one shows the parts

`attention-badges` already states that a reader must not have to change a
selection to discover work exists behind it — that rule governs the channel
switch and the outlet switch. A navigation group is the same problem one level
up, so it gets the same answer rather than a new one.

A collapsed group therefore badges the **sum** across its children. Opening it
removes the sum and each child carries its own count, so no number is ever
counted twice on screen. Without this, folding Delivery into Setup would put
decisions that are waiting right now behind a heading with nothing on it.

Implementation note: `ATTENTION_SOURCES` maps an id to a hook, and a hook cannot
be called from a loop, which is why `NavAttentionBadge` is a component per
source. The sum needs the same trick one level deeper — a probe component per
source that reports its count upward and renders nothing. This is worth pausing
on rather than copying: **the rail and the phone bar are both in the DOM at once**
with one hidden by CSS, so every badged surface already runs its count twice
today, and group sums add up to two more. The spec says counts are read on render
and on return to the foreground and never polled, so this is extra reads on
mount rather than a subscription leak — but this change is the moment to decide
whether attention should be hoisted into one shared read per source instead of
one hook instance per badge.

### On a phone: a card anchored to its tab

Four tabs along the bottom. Tapping a group opens a rounded card just above the
bar, inside the bar's own block, with a tail pointing down at the tab that opened
it. The card's tabs are built like bar tabs — icon over label, same lit colour,
same words — one size smaller, and that size difference is the whole of how the
two rows are ranked.

**Two full-width rows butted together was built first and rejected on sight.**
Two bars of equal weight, squared off against each other, with nothing saying
which was in charge. A variant that suppressed the rule above the open tab so its
column ran into the row above was closer but read as a rendering artefact.

**A pill or segmented control for the second row was also rejected.** The owner's
instruction was that it must read like the navigation bar, not like a filter.

The tail is positioned by index — the tabs share the bar's width equally, so the
centre of the *n*th is a fraction and needs no measuring. Only two of the rotated
square's four borders are drawn; the card covers the other two, which is what
makes it read as a tail rather than a diamond. It survives the card being
scrolled sideways, which a notch cut into the bar does not.

The card's scrollbar is hidden: it drew a grey line across the bottom edge and
undid the corners. In production neither group overflows a phone anyway.

### Geometry

Enough to rebuild the phone bar without the reference images.

- **Card** — `rounded-2xl`, a one-pixel border, `bg-surface-raised`, a soft drop
  shadow, inset from the viewport edges, and drawn **inside the bar's own
  block**. It floated free at first and the sliver of page showing between it and
  the bar read as a mistake — half a line of somebody's name, scrolling behind
  the navigation. The bar owns that gap.
- **Tail** — a 12px square rotated 45°, `bg-surface-raised`, with only its bottom
  and right borders drawn; the card covers the other two, which is what makes it
  read as a tail rather than a diamond under a card. Positioned at
  `((index + 0.5) / count) * 100%` of the bar's width. The tabs are equal-width,
  so this needs no measurement and it survives the card being scrolled sideways.
- **Bar tab** — 64px tall, icon 20px over an `xs` label.
  **Card tab** — 56px tall, icon 18px over an 11px label. That single step is the
  whole of how the two rows are ranked; making them identical was tried and read
  as two bars fighting.
- **Card scrollbar hidden** — it drew a grey line across the bottom edge and
  undid the corners. Neither production group overflows a phone anyway.
- **Badges** — on a bar or card tab, the badge sits on the **corner of the
  icon**, not after the label, so a number never makes one tab wider than its
  neighbours. On a rail row it sits at the end.

Both themes must work. The owner reviewed in dark; the reference images are
light, because that is what a default headless browser renders.

### On a rail: groups are ordinary rows

Same height, same weight, same casing, same lit colour as Overview and
Attendance, with a chevron as the only difference — because the difference is
only that this row opens rather than goes. Children indent under a hairline.

**Uppercase small-caps section headings were rejected.** They made Finances and
Setup read as a different *kind* of thing from the entries beside them, which
they are not: a group is a peer of Overview, not a heading above it.

Sections are open by default and collapsible. There is vertical room on a rail,
so hiding things behind a click there buys nothing.

### A group cannot be closed from inside it

Tapping the group tab you are standing in would leave the reader on a Finances
page with no sibling row and no way back to one except by tapping again. The
group tab toggles only when the reader is elsewhere.

Which group is open is seeded from the address and re-seeded whenever the reader
crosses into or out of a group, so arriving on the Ledger opens Finances and
going to Overview closes it. It is deliberately *not* re-seeded while moving
between siblings, which is what leaves a group the reader opened by hand open
under them. It is not persisted: the address re-opens the right group on arrival,
which is the only case that matters.

The taller bottom padding is reserved whether or not a group is open, so opening
one does not shift the page under the reader's thumb.

### A closed group drops its children from the page

On a phone, a shut group's children are not in the DOM. This is a real
disclosure rather than a CSS trick: a screen reader reaches Delivery by opening
Setup, the same as everybody else. The rail is unaffected because its sections
are open by default.

This has a testing consequence, recorded under Risks.

### `nav.order` becomes unique per sibling set

It was unique per role. It now sorts an entry against the things it is drawn
beside — the other top-level entries and the groups when ungrouped, the rest of
its group when grouped — so Billing and Outlets are both `1` in different
drawers. The registry doc comment and the uniqueness test both have to say this,
or the next person will read a collision as a bug.

A group's own order lives in `NAV_GROUPS` and is therefore the same for every
role. If a manager ever needs Setup ahead of Attendance while the owner does not,
this is what will have to give.

### Same label, same group

`visibleSurfaces` dedupes by label and the senior role's entry wins. Nothing
currently stops `owner-people` sitting in Setup while `admin-people` sits in
Finances — the owner's would silently win and the manager's mental model would
diverge from the code. This wants a test asserting that entries sharing a label
agree on their group.

### Franchise Admins get a read-only Outlets surface

They have none today. Their surfaces are dashboard, menu, inventory, attendance,
billing-history, drawer, ledger, ledger/expenses, pnl, alerts, devices and
people — verified against the registry, not assumed.

That matters because **Tablets stops being a top-level entry**, and
`admin-devices` is the only place a tablet setup code is generated. Without an
Outlets surface, a manager whose tablet dies has no door to the only screen that
can replace it.

Rejected: keeping Tablets as an entry for managers only. Label dedup means the
owner would see the manager's entry, which is exactly how it works today, so
"remove for the owner, keep for the manager" is not expressible. Also rejected:
putting the Tablets door on the manager's Today home, which buries an
outlet-scoped action on a cross-cutting summary.

The surface reads. Create, edit, close and delete stay the Super Admin's, and the
database is what enforces that — as always, not the UI.

### The outlet card is where an outlet is read

Each card carries what that outlet is raising, the state of the tablet standing
at its counter, and the way in to administer that tablet.

**Two things have to be resolved during implementation:**

1. `src/features/outlet-scope.tsx` cannot be seeded from the URL. The Tablets
   surface picks its outlet from an on-screen scope picker, so "click into *this*
   outlet's tablets" does not exist. The sketch linked to the shared Tablets page
   with its picker still on it, which is not what was asked for. Either add
   scope-from-URL — the general fix, and the one `inventory/:itemId` would have
   wanted — or give Tablets a per-outlet address.
2. **The Alerts surface is being deleted in this same change**, so "alerts stay
   visible on the outlet card" cannot mean a link to it. The card shows what the
   outlet is raising as text on the card, with nothing to click through to. This
   needs settling before the card is built, not after.

### Deleting is deleting; the database is not touched

Gate, route, component and tests go for: `owner-comparison`, `owner-pnl`,
`admin-pnl`, `owner-reports`, `owner-alerts`, `admin-alerts`, `admin-inventory`
and the `inventory/:itemId` movement ledger.

`owner-outlet-view` at `outlet/:outletId` **stays** — it is the `Open` button on
every outlet card and the owner kept it explicitly.

`src/features/insights/` loses comparison, pnl and reports but **keeps
`outlet-day-view.tsx`**, and `period.ts` / `profit-figure.tsx` go only if nothing
the day view uses is left behind.

The registry's convention for a retired surface is `hidden`, not deletion, and
this change departs from it deliberately: `hidden` is for a surface whose route
still resolves and whose return is plausible. These are not coming back, and
carrying seven dead screens through every future refactor costs more than the
one-line reversal is worth. **The tables stay**, so the decision is reversible in
the way that actually matters — the data was never there to lose, and the schema
that would hold it is untouched.

## Risks / Trade-offs

- **The phone bar would ship untested.** Both Playwright projects run at tablet
  and desktop width, so every e2e spec exercises the rail, whose sections are
  open by default — the existing nav specs should largely survive untouched. The
  consequence is that the two-level phone behaviour, the thing that was actually
  asked for, has no browser coverage. Either add a phone project to
  `playwright.config.ts` or accept unit coverage and say so in `docs/TESTING.md`.
- **Tables with no reader.** `outlet_alerts`, `alert_responses` and
  `inventory_movements` keep their policies and their isolation tests while
  nothing in the app reads them. That is the price of not dropping live tables in
  a UI change, and it belongs in `docs/LIMITATIONS.md` so the next person does
  not read it as an oversight.
- **`counter-shell.tsx` calls `visibleSurfaces` but not `navTree`.** Harmless
  today — the Biller has no navigation entries at all — but it would silently
  swallow a grouped Biller entry later. Either route it through `navTree` or
  assert in the registry that a Biller entry never carries a group.
- **Delivery in Setup may not survive contact.** It is the only Setup entry with
  live waiting work. The group sum is what makes it safe; if the owner finds
  themselves opening Setup to check the sync rather than to change something, it
  belongs in Finances after all.
- **Roadmap #14 loses its dependency.** `outlet-onboarding` depends on `#13`,
  which is being withdrawn. It has to be rewired, and the natural answer is this
  change — creating a third outlet through the UI is exactly what the Outlets
  surface work touches.

### "My attendance" is not a fifth tab for the owner or a manager

This was raised as an open question and **closed as a non-issue on 2026-09-01**,
because the premise was wrong and the correction is worth recording so it is not
raised again.

`reachableRoles` adds `franchise_admin` for a Super Admin and `employee` for a
Biller, and nothing else. **A Super Admin therefore never reaches the Employee
surfaces, and neither does a Franchise Admin** unless they hold a staff
assignment in their own right. So the owner sees four entries and a manager sees
four; `staff-attendance` appears only for somebody who genuinely works a shift.

Such a person is on the Employee shell, which carries three flat entries — Home,
My attendance, Expenses — no groups and no ceiling problem. The one case that
produces five is a manager who also works at another outlet under
`multi-outlet-people`, which is within the five the `app-shell` requirement
allows. It stays a tab.

## Open Questions

- **Whether attention reads are hoisted** into one shared read per source as part
  of this change or noted as a todo.

## Decisions taken during implementation

Two questions the folder deliberately left open, answered here so the reasoning
survives the session that made it.

### Attention reads were already hoisted; nothing to do (task 4.4)

**Decision: leave one hook instance per badge, and seed no todo, because the
duplication the open question worried about is not there.**

The concern was that the rail and the phone bar are both in the DOM with one
hidden by CSS, so every badged surface runs its count twice, and group sums
would add two more. That is true of the *hook instances* and false of the
*reads*: `useSharedRead` in `src/features/attention/attention.ts` already keys a
single store and a single in-flight request off the **adapter object**, and
every source hook goes through it — `useWaitingAttention`,
`useCounterRequestAttention` and the three delivery hooks without exception. Its
own doc comment names this case: *"the phone shell renders its navigation twice
… left alone that is three requests for one answer."*

So a group's probe component costs a `useSyncExternalStore` subscription and a
render, not a second network read. The sum across Setup makes **zero** further
requests, because Delivery's own badge is reading the same store. Hoisting would
buy nothing and would mean moving state out of the components that consume it.

The spec's timing property is unchanged and was checked rather than assumed:
counts are read on mount, re-read on `visibilitychange` when the app returns to
the foreground, and re-read on `attentionChanged()` after a surface does some of
the work. **There is no timer anywhere in the path.**

*(The one thing this leaves standing: two hook instances per source do
subscribe. That is a component tree fact, not a data-access one, and it costs a
Set entry.)*

### The Tablets button gives Tablets a per-outlet address (task 5.5)

**Decision: give Tablets a per-outlet address — `devices/:outletId` — rather
than seeding `outlet-scope.tsx` from the URL.**

The requirement is that tablet administration opened from an outlet card
*"opens on that outlet's tablets"*, and the sketch's link to the shared page
with its picker still on it is explicitly not the answer.

Scope-from-URL was the tempting option, because `outlet-scope.tsx` is shared by
several surfaces and one general fix would serve them all. It was rejected for
this change on two grounds. It changes behaviour for **every** surface that uses
the scope picker, including ones this change has no business touching and no
gate to verify — the Drawer, the Ledger, Delivery and Expenses all pick their
outlet the same way, and a general seeding rule would have to answer what
happens when a remembered outlet and a URL disagree, on four surfaces, in one
navigation change. And the address it produces would be a query parameter on a
shared path, which is a weaker thing to hold than a route: it does not survive
being tidied out of a copied link, and nothing in the router asserts it.

A per-outlet route is smaller and stronger. `devices/:outletId` resolves against
the `devices` gate the way `ledger/delivery/:channel` resolves against
`ledger/delivery` — the precedent is already in `surfaces.tsx`, so this is the
existing pattern rather than a new one. The bare `devices` path keeps working
exactly as it does today, picker and all, so no link anybody holds changes
meaning and the owner's own Tablets entry is untouched.

**What this deliberately does not do** is make the address the authority on
scope. The parameter seeds the picker; the picker still shows what the reader
may reach, and an outlet the caller cannot read is refused by the database as it
always was. The route is a starting position, not a grant.

The general scope-from-URL fix stays worth doing and is recorded as a todo, with
the four surfaces it would touch named.

### A closed outlet's card offers no Tablets button

Found by driving it rather than by reading it, and worth recording because the
reasoning is not obvious from either half on its own.

`devices/:outletId` seeds the scope picker, and the picker validates what it is
given against the outlets the reader can actually see — which is
`listOutlets()`, active only. A closed outlet is therefore dropped on arrival
and the surface falls back to its default, so the button said *this shop's
tablets* and delivered a different shop's, silently.

**The fix is to not offer it.** A shop that is not trading has no counter to
administer, and a control that goes somewhere other than where it says is worse
than no control. Widening the picker to accept closed outlets was rejected: the
picker's exclusion is right everywhere else it is used, and loosening a shared
rule to rescue one button is the wrong direction.

The card still says what a closed outlet is raising, because that is text rather
than a promise about where a tap goes.

### The "five tabs" count above was wrong, and one session gets six

The section *"'My attendance' is not a fifth tab"* closes by saying the one
case producing five is a manager who also works at another outlet. **It is six**,
and the miss is worth recording because the correction was found by measuring
rather than by reading.

That person holds a Franchise Admin assignment and an Employee one, so they hold
*two homes* — and a home belongs to a role you hold. Their bar is Home · Today ·
Finances · Attendance · Setup · My attendance. The reasoning above counted the
manager's Today and forgot the Employee's Home.

Nothing else exceeds four: the owner sees Overview, Finances, Attendance, Setup;
a manager sees Today and the same three; an Employee sees three. An owner who
also runs a shop sees five, for the same two-homes reason.

**What was fixed** is the harm the requirement is about. At the bar's previous
per-tab minimum of `4.5rem`, six tabs overflowed a 375px phone by three pixels —
so the one session shape with the most to reach was the one that had to scroll
to reach it. The tabs now share the bar's width equally with a floor of one
phone touch target, which clears the narrowest phone anybody uses and changes
nothing for four tabs, where the minimum never binds.

**What was not fixed** is the count, because every way to reduce it is a product
decision the owner has not been asked. The Employee home cannot go — it holds
the check-in button, the one action their manager role cannot do for them — and
the alternatives change what every reader sees to fix what one reader sees. It
is recorded in `openspec/todos/six-tabs-for-one-person.md`, and
`registry.test.ts` now pins every shape's count and asserts the width property
for all of them, so neither can drift further in silence.
