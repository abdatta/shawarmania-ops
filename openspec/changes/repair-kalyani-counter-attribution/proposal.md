# Proposal: Repair Kalyani Counter Attribution

> **Model:** current Codex model; no roadmap model prescribed. **Roadmap:**
> intentionally unlisted one-off production repair. **Gate:** after a verified
> production backup, restore rehearsal, dry run and atomic repair, the trading
> recorded on business date **2026-09-16** by the Kanchrapara-enrolled tablet
> that was physically used at Kalyani reads wholly as Kalyani trade with the
> same 37 settled bills, ₹9,060 total, ₹2,130 cash, ₹6,930 UPI, customer facts,
> timestamps, tenders and public receipt tokens; Kanchrapara retains none of
> that date's mistaken trade and never reuses bill numbers 742–778; all prior
> genuine Kanchrapara history remains there; the existing tablet session opens
> its next shift at Kalyani without setup; a Super Admin can thereafter edit a
> tablet's name and outlet from Tablets while a Franchise Admin can edit the
> name at their own outlet; a transferred tablet cannot read its former outlet
> through a direct request; and immediate, independent,
> first-use and next-day checks all agree before the rollback artifacts are
> retired.

## Why

On **2026-09-16**, the tablet enrolled as Kanchrapara's counter was taken to and
used at the Kalyani counter. The people, food, cash and UPI payments were all at
Kalyani. The database nevertheless did exactly what it was configured to do:
it attributed the shift, orders, bills, payment receipts and counter commands
to Kanchrapara and offered the Kanchrapara menu.

This is not a disputed sale or an accounting reinterpretation. It is one real
trading day stored under the wrong outlet because the hardware carried the old
outlet assignment. Leaving it there makes both outlets' revenue, tender,
expenses, receipt headings, bill sequences and future operational reporting
wrong. Voiding and re-ringing every sale would create a second fictional trading
history, change customer-facing bill identities and imply that the original
sales happened at Kanchrapara and were later cancelled. They did not.

The owner therefore chose a narrow restoration: preserve each commercial fact
and stable row identity, but correct the outlet context and outlet-local numbers
so the database describes where the trading physically happened. No general
"edit a settled bill" product path is being introduced. The ordinary billing
contract remains append-only for every application role and every future sale;
this change documents one owner-authorised, privileged production repair.

The same incident exposed a second operational need. The tablet is no longer
needed at Kanchrapara and must continue at Kalyani without anybody setting it up
again. Reusing its existing machine identity is operationally sound, but the
current model describes a tablet as bound to one outlet for life and several
device-scoped read policies assume that remains true. This change makes a
carefully gated maintenance transfer a real contract and keeps historical
outlet isolation true after the transfer.

## What Changes

### The incident is repaired once, under an exact fingerprint

- Add an incident-specific operator tool with separate `plan`, `apply`,
  `verify` and `rollback` modes. It contains no production identifiers,
  credentials, customer data or employee data in source control.
- Refuse to apply unless a fresh production read matches the reviewed incident
  fingerprint: source and target outlets, business date, one device, one shift,
  one operator, row counts, money totals, bill range, target counters, menu
  mapping, zero unresolved device work and the expected absence of corrections,
  discounts, attribution reviews, end-of-day confirmations, drawer events and
  inventory movements.
- Repair the same rows in one locked transaction. Preserve UUIDs, commercial
  timestamps, business date, quantities, integer-paise amounts, tender methods,
  customer snapshots and public receipt tokens.
- Renumber the 37 bills in their existing chronological order after Kalyani's
  high-water mark. The reviewed baseline is Kalyani bill 989, so the expected
  mapping is 742–778 to 990–1026. A changed target high-water mark is drift and
  aborts; it is not silently recalculated.
- Move the complete order/command context, the five same-shift expenses and the
  incident shift with the bills. Keep the source bill and order counters at
  their old high-water marks so no number is ever reused.
- Map every sold row to an active Kalyani menu row at the same price. Eleven
  products match exactly. The owner confirmed the two same-price aliases:
  `Classic Chicken Shawarma [S]` to `Classic Chicken Shawarma [SAAJ]`, and
  `Chicken Shawarma Salad` to `Shawarma Salad`.

### Backup and reversal are deliverables, not preliminaries

- Take a full logical production snapshot, including schema, public data and
  Auth data, outside the repository. Restore it into an isolated scratch
  database and prove the incident rows and device session are usable there.
- Take a second, targeted before-image immediately before the live transaction,
  including every affected row, relevant counters, assignments, device and
  shift state, trigger/constraint definitions and a manifest of row-set hashes.
- Generate and rehearse the compensating reversal from that before-image. An
  in-transaction failure restores everything automatically. A post-commit
  reversal restores row attribution but does **not** lower either outlet's
  issued-number high-water mark; numbers observed once remain unavailable.
- Keep sensitive recovery artifacts outside the repository under restrictive
  access, with checksums and a stated retention/destruction point.

### The closed-counter window contains only the live cutover

- Finish implementation, review, full local/CI verification, deployment, the
  full production snapshot and its scratch restore, rehearsal, rollback proof
  and failure injection before the production window begins. None of those is
  night-of work.
- Assume every outlet tablet, printer and outlet network is unavailable. The
  live operation depends only on the operator's connected laptop, its production
  credentials, Supabase/database services and the external backup destination.
  GitHub and the hosted frontend may be used if available, but neither is on the
  critical mutation path after the reviewed release has been deployed.
- Begin the live run only after both counters have stopped accepting work, in a
  window beginning around **03:00–04:00 Asia/Kolkata** and ending before either
  counter reopens. The live steps are: freeze, fresh plan, targeted before-image,
  one atomic historical-and-device apply, and independent database postflights.
- Every command pins `business_date = 2026-09-16`; no command derives scope from
  “today,” the host timezone or the wall clock. Crossing the **04:00 IST**
  business-day cutover during execution neither changes the selected rows nor
  recalculates the reviewed number mapping.
- Do not ring a synthetic sale during the closed window. The first genuine bill
  at the next opening is the first-use verification and is expected to be
  Kalyani bill 1027. The next-day reconciliation remains a later acceptance
  checkpoint before targeted recovery artifacts are retired.
- The incident tablet is not contacted or inspected overnight. Its first online
  refresh, Kalyani-menu check and same-session proof happen at the next real
  opening before a shift starts.

### The tablet moves without being set up again

- The operator tool closes the incident shift, repairs the historical graph and
  atomically changes the existing device row to expected name **Kalyani Counter
  2** (after a fresh uniqueness check) and outlet **Kalyani**. It does this from
  the connected maintenance laptop; the tablet remains powered off.
- The incident fingerprint requires the tablet's stored last report to be zero,
  the last report to postdate its latest accepted command, no pending request,
  and no server-side device work after that report. A production recheck at
  02:49 IST found the tablet last reported zero at 21:24 IST, after its latest
  accepted command at 21:17 IST. This is stale evidence, so the owner-confirmed
  closed/offline counter is also an explicit incident assumption; it is not
  generalized into the normal transfer UI.
- Retain the tablet's Auth/device UUID, proven session and browser credentials.
  The before-image and rollback cover its device row in the same transaction as
  the historical repair.
- Verify the operator already holds active Biller assignments at both outlets;
  the 2026-09-17 production refresh found both assignments present, so the
  repair must not create a duplicate.
- Require the tablet to reconnect online before its next shift so the Kalyani
  menu replaces cached Kanchrapara state. The next interaction is the ordinary
  shift-opening handshake, not tablet setup.

### Tablets gains one Edit action

- Add **Edit** to each tablet card. The sheet is prefilled with the two
  properties chosen during setup: **Name** and **Outlet**.
- A Super Admin may change either field. A Franchise Admin may rename a tablet
  at an outlet they manage but may not move hardware between outlets; the outlet
  is shown as fixed rather than offering an action the database will refuse.
- A name-only edit may occur while a shift is open. An outlet change is an
  atomic transfer and uses the normal product preconditions:
  no live shift, no pending request, a sufficiently fresh heartbeat reporting
  zero unresolved work, an active target outlet and a unique target label.
- Changing the outlet asks for confirmation naming the tablet, source outlet and
  destination. A refusal changes neither field. Success refreshes the cards so
  the tablet moves between outlet groups immediately and keeps its existing
  session.
- Editing changes the tablet's current/future assignment only. It never rewrites
  historical bills, orders, shifts or commands and must not be used as a
  substitute for this incident's operator repair. The Edit flow is rehearsed and
  tested against restored/local environments, but is not exercised against the
  powered-off production tablet during the overnight repair.

### A small policy migration makes transfer safe

The owner explicitly did not want hand-crafted-request risk to block the
operational repair. That priority does not waive this repository's database
tenancy rule. Today several policies admit rows by `device_id = auth.uid()` even
when the row belongs to the device's former outlet. That is harmless only while
a device can never move.

A normal, separately reviewed migration therefore tightens device reads so a
row must also belong to the tablet's **current** outlet and, where the existing
contract requires it, its current live shift. It adds no UI, no new application
write path and no broader RLS redesign. The migration may be deployed before the
repair; deploying it never moves data, and running the repair is always a
separate explicit act.

## Capabilities

### Modified Capabilities

- `counter-device-sessions` — a proven, non-removed tablet may normally be
  transferred between active outlets by an authorised admin without changing its machine
  identity or requiring setup, but only with no live shift, no pending request
  and recent evidence of zero unresolved local work. Historical rows remain
  scoped to the outlet recorded on them, future shifts use the new outlet, and
  the transferred device cannot read its former outlet. The Tablets surface
  exposes the same atomic edit to a Super Admin; a Franchise Admin retains
  name-only administration at their own outlet.

The one-time bill/order repair is deliberately not added to `counter-billing` as
a reusable capability. Application bills remain append-only; the incident,
authority, exact fingerprint and exception live in this change record and its
operator evidence.

## Impact

**Repository changes:** one migration containing the atomic tablet-edit RPC and
the narrowly scoped RLS correction, with database/isolation tests; one new Edge
action; typed live and demo adapters; the Tablets edit sheet, confirmation and
loading-state parity; an incident-specific operator tool and local rehearsal
tests; this change's evidence templates; generated schema types; and durable
screen/operations/security documentation for transferring a tablet safely.

**Production data:** 37 bills, 43 bill items, 41 original payment allocations,
39 orders, 45 order items, 115 billing command receipts, five expenses, one
counter shift, outlet counters and any surviving incident shift request are
handled by the operator tool together with the current device name/outlet.
Thirty-seven public-link rows keep the same bill IDs and tokens and require no
mutation. The tool discovers and reports every dependent table before applying
rather than relying only on this list.

**Unaffected history:** the same tablet has 741 earlier Kanchrapara bills and 33
earlier shifts. Those records remain Kanchrapara history. Attendance already
places the operator at Kalyani on the incident date and is not rewritten.

**No ordinary deployment may execute the data repair.** A SQL migration is the
wrong vehicle: it would run automatically in every environment, mix backup and
operator approval with deployment, and make an incident-specific mutation look
like a reusable schema transition. Only the RLS correction is a migration.

## Non-goals

- A general settled-bill editor, self-service bill repair or reusable way to
  bypass immutable billing triggers.
- Letting a Franchise Admin move a tablet to another outlet, transferring a
  tablet with unresolved work, or editing setup attribution/device identity.
- Using the Edit sheet to reclassify historical trade; it moves the device from
  that point forward and deliberately leaves history alone.
- Voids, replacement bills, adjustment rows, duplicate receipts or an
  application-visible audit trail for this incident.
- Changing totals, tender, timestamps, customer snapshots, discounts, tax,
  rounding, business date or product prices.
- Moving the tablet's genuine pre-incident Kanchrapara bills, orders, shifts or
  commands.
- Reusing Kanchrapara numbers 742–778, or lowering a number counter after a
  committed repair or reversal.
- Treating the tablet's cached state as authoritative. The first post-transfer
  opening must be online.
- A broad audit of every device policy or a redesign of device authentication.
  Only policies made unsafe by an outlet transfer are in scope.
- Committing production dumps, before-images, credentials, public receipt
  tokens, customer facts or employee identity to the repository.

## Docs to update before archive

`docs/DATA_MODEL.md` — distinguish a device's current outlet from historical
row attribution and replace the absolute “bound for life” statement.
`docs/OPERATIONS.md` — the reviewed tablet-transfer and incident-repair runbook,
backup/restore proof, drift refusal, rollback window and recovery-artifact
cleanup. `docs/SECURITY_AND_PRIVACY.md` — transferred-device isolation and the
current-outlet intersection. `docs/OFFLINE_AND_SYNC.md` — distinguish the normal
fresh-zero transfer rule from this exact-fingerprint offline incident exception
and require an online first reopening. `docs/TESTING.md` — restored-snapshot
rehearsal, policy isolation coverage and the multi-pass production verification
record. `docs/SCREENS.md` — the Tablets
Edit sheet, permissions, refusals and confirmation. `docs/ROLES_AND_PERMISSIONS.md`
— name-only Franchise Admin authority and cross-outlet Super Admin authority.
`docs/DEMO_MODE.md` — edit/transfer behavior in the four-role walkthrough.
