# Owner Feedback — Kalyani Counter, 12 Aug 2026

This is the complete record of the seven things the owner noticed while setting
up billing at Kalyani. It stays separate from the main backlog so the feedback
can be tracked together, including what has since been built or formally
planned.

## The list

Items remain ranked roughly smallest-to-largest by original scope, not by
priority. **Graduated** means the standalone todo was removed only after its
work was captured in a change or completed; it remains listed here for history.

| # | Item | Area | Size | Status |
| --- | --- | --- | --- | --- |
| 1 | The "Awaiting Activation" Label Lies | Staff / Roles | S | **Active — [#40](../changes/account-lifecycle-truth-and-safe-transitions/proposal.md)** |
| 2 | You Can't Click Your Way to the Counter Setup Page | Navigation | S | **Complete — [counter-access-and-workspace-layout](../changes/counter-access-and-workspace-layout/proposal.md), awaiting roadmap reconciliation/archive** |
| 3 | Let Me Drag to Resize the Last Two Counter Columns | Counter / Design | S | **Complete — [counter-access-and-workspace-layout](../changes/counter-access-and-workspace-layout/proposal.md), awaiting roadmap reconciliation/archive** |
| 4 | Promoting a Staff Member Can Accidentally Lock Them Out | Staff / Roles | M | **Active — [#40](../changes/account-lifecycle-truth-and-safe-transitions/proposal.md)** |
| 5 | [The App Asks for a Code Before Checking If the Person Is Even Allowed](./code-request-before-eligibility-check.md) | Counter / Billing | L | Open |
| 6 | [Marking a Bill "Paid" Removes It From the Kitchen List Too Soon](./paid-removes-order-from-kitchen-too-soon.md) | Billing | XL | Open |
| 7 | The Owner Can't See the Real Billing Counter From Home | Owner console / Demo | XL | **Seeded — [#39](../changes/counter-seen-and-practised/proposal.md); reporting delivered in #10** |

## Graduated

### 1. The "Awaiting Activation" Label Lies

Arpita's visible state can say "Awaiting activation" after she is already
working because it reflects an unused invite code rather than the account's
real lifecycle. [#40](../changes/account-lifecycle-truth-and-safe-transitions/proposal.md)
is active and makes that state truthful, including the reset-link path.

### 2. You Can't Click Your Way to the Counter Setup Page

The completed `counter-access-and-workspace-layout` change adds a reachable
setup path and clear handover guidance. It deliberately leaves the Shift tab
hidden: the live counter already exposes shift activity in its workspace.
The change is complete, but has not yet been reconciled into the roadmap or
archived.

### 3. Let Me Drag to Resize the Last Two Counter Columns

The same completed `counter-access-and-workspace-layout` change provides
independent, persisted resizing for the counter panels while preserving safe
layout limits. It is likewise awaiting roadmap reconciliation and archive.

### 4. Promoting a Staff Member Can Accidentally Lock Them Out

[#40](../changes/account-lifecycle-truth-and-safe-transitions/proposal.md) is
active. It replaces separate assignment operations with an atomic assignment
set update, so a role transition cannot temporarily remove a person's access.

### 7. The Owner Can't See the Real Billing Counter From Home

The live-shift visibility portion shipped in `billing-live` (#10). Opening and
practising on a copy of the biller workspace is
[#39 `counter-seen-and-practised`](../changes/counter-seen-and-practised/proposal.md),
seeded in Wave E. That proposal records the owner's decisions that practice is
Super Admin only and uses real data already visible to that role.

## Remaining items

### 5. The App Asks for a Code Before Checking If the Person Is Even Allowed

The tablet requests a four-digit code before it verifies that the named person
may bill at that outlet. This remains open: a future change must preserve
non-enumeration for outsiders while giving authorised administrators useful
setup feedback earlier.

### 6. Marking a Bill "Paid" Removes It From the Kitchen List Too Soon

Payment and kitchen completion are currently one state transition. This remains
open and needs a separate order-preparation model from payment state, making it
a core billing and money design change rather than a quick fix.
