# Navigation Outgrows A Flat List

**Type**: Design gap · **Status**: Promoted — `#51 navigation-groups-and-surface-cull`, 31 Aug 2026 · **Area**: Shell

## What the owner sees

Sixteen entries in one flat list, on the device they actually use.

On a wide screen this is a long left rail that runs past the fold. On a phone it
is worse: the entries live in a horizontally scrolling bottom bar, so roughly
half of them are off the right edge at any moment, with nothing indicating they
are there. A tab you have to remember exists and scroll sideways to find is not
navigation.

The count as of 2026-08-17, for the Super Admin, in the order they appear:

> Overview · Outlets · Ledger · Zomato · People · Compare · Alerts · Billing ·
> Today · Menu · Stock · Expenses · Cash · Attendance · P&L · Tablets

It grows every time a surface is promoted, and the roadmap has more coming.

## Why it is not simply "add a menu"

Three things make this less trivial than it looks.

**The list is not one role's.** A person sees every surface the roles they can
reach declare, so a manager who also grills at the other outlet gets both sets,
and the owner reaches the outlet-level surfaces holding no assignment anywhere.
Any grouping has to survive one person seeing two roles' worth of entries at
once, and must not imply the reader has become somebody else.

**The order is meaningful and hand-set.** Entries carry an explicit `order`
because how often a tab is reached for is a real fact about this business: the
ledger is opened nightly and People is opened when somebody joins. Grouping must
not quietly become alphabetical, and the ordering argument has to survive inside
a group as well as between groups.

**One entry already sits inside another.** Zomato lives under the Ledger, and the
shell now indents it and lights only the most specific entry. That is the
primitive a grouped navigation would build on rather than replace, and whatever
lands here should generalise it rather than introduce a second mechanism beside
it.

**A bottom bar has a hard ceiling.** Four or five tabs is what a phone holds
without scrolling. Whatever the answer is, it almost certainly means most
surfaces stop being top-level tabs, which is a bigger decision than it sounds:
every one of them is somebody's daily route to something.

## The constraint that makes it worth doing properly

The counter is the thing that must never stall, and the owner's phone is the
thing that must answer questions quickly. A navigation restructure touches every
role's shell and every surface's address, so it wants its own change with its own
gate rather than being folded into whichever feature happens to notice it. The
`e2e/shell.spec.ts` suite and the four-role demo walkthrough are both inside its
blast radius.

## Trigger to promote

The next surface promoted into navigation, or the first time somebody cannot find
a tab they know exists.

## How it was answered

Promoted as `#51 navigation-groups-and-surface-cull` on 31 Aug 2026, by both
halves at once: sixteen entries became **nine surfaces under four top-level
entries**, because seven of the sixteen were demonstration screens the business
decided not to build.

Each of the four difficulties above was answered rather than dodged. **The list
is not one role's** — entries sharing a label must declare the same group, so
a senior role's placement cannot silently override a junior's. **The order is
meaningful** — `nav.order` survives, its uniqueness rule narrowed from
per-role to per-sibling-set. **One entry already sits inside another** — path
nesting stays for ungrouped entries and is deliberately not applied inside a
group, so Expenses is drawn as the Ledger's sibling in Finances rather than
indented under it twice. **A bottom bar has a hard ceiling** — that ceiling is
now stated in `app-shell` as five entries with no horizontal scrolling.

Grouping is metadata, not addresses: no surface moved, so no link the owner
already held stopped working.
