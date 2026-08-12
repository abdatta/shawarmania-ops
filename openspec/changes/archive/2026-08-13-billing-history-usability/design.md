## Context

`ManagerBillingHistory` currently renders every bill as one button, stores the selected `BillingBill`, and renders one dialog-shaped block after the complete `<ul>`. Selection therefore has no spatial relationship to the tapped row. The same detail mixes item, payment, timing and correction concerns, and always mounts the void-reason field. The adapter already carries item snapshots, customer snapshots, tenders and clocks; the stored bill also has `biller_profile_id`, but `BillingBill` does not yet expose its resolved name.

This is a live owner/Franchise Admin surface and a coherent demo surface. The redesign must preserve the adapter boundary, immutable bill semantics, outlet-local time, integer paise, PII restrictions, both themes and the existing no-manager-side-re-ring rule.

## Goals / Non-Goals

**Goals:**

- Keep the summary list dense enough for a phone while making its hierarchy scannable.
- Put selected detail immediately after its summary and keep at most one disclosure open.
- Make the full captured sale readable by grouping items, customer, biller, payment and timing/reference facts.
- Hide exceptional cancellation input until the manager deliberately opens that action.
- Use plain-facing Paid/Cancelled language without changing stored enum values or command semantics.
- Use the full phone width for two filter controls per row, without sacrificing the individual labelled controls.

**Non-Goals:**

- No database, policy, money, outbox, command or gate change.
- No refund, replacement, deletion, automatic re-ring or correction handoff.
- No expansion of who may read a bill or customer phone.
- No redesign outside manager Billing history, including its Open orders and Sync status views.

## Decisions

### Detail is an inline, single-open disclosure

Each summary remains a real button with `aria-expanded` and `aria-controls`. Its detail is rendered as the next element inside the same list item, and selection is keyed by bill id so a refresh cannot retain a stale bill object. Selecting another row closes the previous row; selecting the open row collapses it.

Expanded state uses the ordinary surface border rather than an accent outline. Detail height and opacity transition briefly on open and close, including when one selection replaces another. When a manager selects a lower row while an earlier bill is closing, the page holds the tapped summary at its current viewport position for the short transition. This makes the prior detail's departure legible without making the newly selected row appear to jump away from the tap.

A modal or bottom sheet was rejected: either would keep detail visually near the tap, but both remove the bill from its list context and make comparison harder. Rendering every card permanently expanded was rejected because it recreates the current scanning problem.

### Summary and detail answer different questions

The collapsed row answers: which bill, what state, how much, how paid, when, and who billed it. It uses `formatDayTime` for Today/Yesterday plus absolute time and falls back to the full outlet-local date/time for older bills. Biller attribution follows the time as `by <name>`, keeping the operator visible without opening customer or audit detail. The expanded content groups:

- captured item name, quantity, unit price and line total;
- payment allocations and total;
- customer name and phone, explicitly saying Not provided for absent optional facts;
- order reference, ordered/paid moments, revenue business date and a differing payment business date.

Order items and Payment remain distinct always-visible cards because they are the commercial
facts a manager opened the bill to read. Customer details and Bill timeline are separate
nested disclosures, closed by default; opening either reveals its short facts in two columns.
This preserves the stronger card hierarchy while preventing optional customer and audit facts
from consuming the phone viewport during ordinary review.

Business dates continue to use their explicit stored columns and are formatted as calendar labels; no timestamp is used to derive them.

### Existing attribution crosses the adapter seam as display data

`BillingBill` gains a required `billerName`. The Supabase read joins the existing `biller_profile_id` foreign key to the readable profile name; the mock resolves the existing fixture id through the same actor-name helper. The name appears in the collapsed summary subheader. Any genuinely unavailable name becomes `Counter operator`, not a fabricated person. No migration or access policy changes.

Deriving the biller from the current session was rejected because a manager is reading somebody else's historical work. A screen-level Supabase join was rejected because screens depend only on adapters.

### Cancellation is progressive disclosure and plain language

Settled detail initially shows one secondary-danger action, `Cancel this bill`. Opening it reveals the reason input, the immutable-history/manual-re-ring consequence, `Keep bill`, and `Confirm cancellation`. A voided record reads `Cancelled`, with its stored reason and time; the adapter and database continue to use `void`/`voidBill` internally.

Renaming the stored enum or command was rejected because the usability defect is vocabulary at the display edge, not billing semantics. Showing a trash icon or Delete label was rejected because the record is never deleted.

### Open orders are work to inspect before they are work to cancel

The manager Open orders view shows each order's captured item rows, total, customer facts,
creator and ordered time before any cancellation control. The normal state has a single
secondary-danger `Cancel this order` action. Only after that deliberate choice does an
inline confirmation area show the cancellation reason, the consequence that nothing is
transferred, `Keep order`, and the disabled-until-reason confirmation. The existing
reasoned `managerCancelOrder` command remains unchanged.

### Filters use the available phone width

The outlet, date, status and payment controls form a two-column grid at phone widths,
which reduces four tall rows to two while preserving native controls and their accessible
labels. Wide screens retain one row of four. Hiding filters behind a sheet was rejected:
the controls are routinely combined and the summary needs to stay immediately visible.

### The history date is a chosen business day, not an empty browser field

Billing history defaults to the selected outlet's current business date, resolved through its
cutover, and queries that date rather than treating an unset string as all history. The visible
control is a button labelled `Today` for that date or the shared formatted business date for a
past choice. Its hidden native date input owns the platform calendar and refuses future business
dates. An all-history default was rejected because it makes the normal daily review vague and
turns `dd-mm-yyyy` into an unexplained, consequential empty state.

### The shimmer reserves the new list shape

Loading renders multiple summary-card skeletons with the same two-level left hierarchy and right-aligned amount footprint. No expanded skeleton is shown because detail is closed by default.

### Delivery diagnostics become a manager-facing Sync status summary

The existing Delivery tab is a capped read of billing-command receipts. Its purpose is to answer whether tablet work reached the server, but listing every accepted command promotes transport implementation details over the only managerial question: does anything need attention?

The tab is renamed `Sync status`. A summary separates problem results from successful results. Problems are shown first as human-readable exception cards because they may require checking the originating tablet. Successful results collapse into totals by familiar action (orders created, orders paid, orders cancelled, bills paid, other activity). A `Show technical details` disclosure exposes the existing short references, result categories and receipt times only when troubleshooting requires them. Payloads, command contents and customer facts remain unavailable.

Removing the tab was rejected because read-only evidence helps a manager distinguish a sync problem from missing business activity. Keeping a chronological success feed was rejected because accepted receipts are routine evidence, not individual work items. Changing the adapter to return aggregates was rejected for this correction: the existing capped receipt read can be grouped at the display edge without changing backend scope or transport semantics.

## Risks / Trade-offs

- **Customer PII becomes more visible in detail** → keep it inside an intentional disclosure, never place the phone in summaries, diagnostics, logs or test names, and preserve existing outlet-scoped reads.
- **A long detail pushes later rows down** → allow only one bill open, keep optional customer and timeline cards closed by default, and place their short facts in two columns when opened.
- **Switching between open bills can move a selected lower row** → synchronise the old close and new open transition, and temporarily anchor the tapped summary in the viewport; respect reduced-motion preferences by removing the visual transition while retaining the stable selection.
- **An open order may be cancelled before a manager has inspected it** → make captured order detail the default content and reveal the cancellation form only after an explicit action.
- **Paid/Cancelled differs from internal enum vocabulary** → centralise display labels in the surface and keep adapter/write names unchanged.
- **Profile joins can return no readable row** → render `Counter operator` rather than blocking the bill history response.
- **The capped receipt read is not a lifetime audit** → label it recent sync activity and avoid claiming the grouped counts represent all historical commands.

## Migration Plan

Land the adapter display field and mappings, then the inline surface, tests, shimmer and `docs/SCREENS.md`. Deployment needs no data migration. Rollback removes the display field and restores the former surface; stored bills and commands are unaffected.

## Open Questions

None.
