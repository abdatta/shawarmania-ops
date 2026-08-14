# Owner Feedback — Kalyani Counter, 12 Aug 2026

This is the complete record of the seven things the owner noticed while setting
up billing at Kalyani. It stays separate from the main backlog so the feedback
can be tracked together, including what has since been built or formally
planned.

## The list

Items remain ranked roughly smallest-to-largest by original scope, not by
priority. **Graduated** means the standalone todo was removed only after its
work was captured in a change, completed, or deliberately dropped; it remains
listed here for history either way.

| # | Item | Area | Size | Status |
| --- | --- | --- | --- | --- |
| 1 | The "Awaiting Activation" Label Lies | Staff / Roles | S | **Implemented — [#40](../changes/account-lifecycle-truth-and-safe-transitions/proposal.md), awaiting archive** |
| 2 | You Can't Click Your Way to the Counter Setup Page | Navigation | S | **Complete — [counter-access-and-workspace-layout](../changes/counter-access-and-workspace-layout/proposal.md), awaiting roadmap reconciliation/archive** |
| 3 | Let Me Drag to Resize the Last Two Counter Columns | Counter / Design | S | **Complete — [counter-access-and-workspace-layout](../changes/counter-access-and-workspace-layout/proposal.md), awaiting roadmap reconciliation/archive** |
| 4 | Promoting a Staff Member Can Accidentally Lock Them Out | Staff / Roles | M | **Implemented — [#40](../changes/account-lifecycle-truth-and-safe-transitions/proposal.md), awaiting archive** |
| 5 | [The App Asks for a Code Before Checking If the Person Is Even Allowed](./code-request-before-eligibility-check.md) | Counter / Billing | L | Open |
| 6 | [Marking a Bill "Paid" Removes It From the Kitchen List Too Soon](./paid-removes-order-from-kitchen-too-soon.md) | Billing | XL | Open |
| 7 | The Owner Can't See the Real Billing Counter From Home | Owner console / Demo | XL | **Reporting delivered in #10; the rest dropped on 14 Aug 2026** |

## Graduated

### 1. The "Awaiting Activation" Label Lies

Arpita's visible state can say "Awaiting activation" after she is already
working because it reflects an unused invite code rather than the account's
real lifecycle. [#40](../changes/account-lifecycle-truth-and-safe-transitions/proposal.md)
implements that truthful state, including the reset-link path, and is awaiting
archive.

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

[#40](../changes/account-lifecycle-truth-and-safe-transitions/proposal.md)
replaces separate assignment operations with an atomic assignment-set update,
so a role transition cannot temporarily remove a person's access. The
implementation is complete and awaiting archive.

### 7. The Owner Can't See the Real Billing Counter From Home

The live-shift visibility portion shipped in `billing-live` (#10): the Tablets
card reports the shift, who holds it and that shift's figures, scoped by the
reader's own outlets. That is the half the owner actually asked for, and it is
done.

The other half — mounting the biller's own workspace somewhere else to look at,
and a Super Admin practice copy of it — was seeded as `counter-seen-and-practised`
and **dropped on 14 Aug 2026 by owner decision**. Its change folder and roadmap
row are deleted. Nothing about it is planned, and it should not be reseeded
without a fresh reason: it was a refactor of the counter under a counter that is
now taking real money, for a want the shift figures largely answer.

One thing it noticed stays true and stays unfixed: the demo's billing shell and
the tablet's are two compositions of the same columns, which is why one has
Finish day and the other never did.

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
