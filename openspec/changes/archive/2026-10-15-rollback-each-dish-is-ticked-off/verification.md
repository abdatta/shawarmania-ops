# Emergency rollback evidence

The owner authorized production rollback and CI bypass on 2026-10-12, then
authorized dropping unfinished orders created after #74. Existing payments and
immutable sales remain preserved. The helper derives the identified owner's
current authority through the assignment functions before cancelling any order.

The corrective migration restored ten pre-#74 function definitions verbatim from
`014f5693`. Its rehearsal ran in a transaction ending in ROLLBACK. The production
application ran atomically at 12:05:33 UTC and registered migration
`20261017000000` in the same transaction. Neither operation changed financial
rows: 2,967 bills, total 85,874,600 paise, identical ordered bill fingerprint
`abe9bbfdffebab41482cef8cc21cbee5`. Billing envelope/line validators and additive
RPCs remain compatible with already queued #74 work; original receipt identities
and hashes survive. All released migration files remain intact.

The owner-authorized cancellation transaction used manager_cancel_billing_order
with current owner assignment checks. Zero open post-release orders remained,
and the financial fingerprint stayed identical. Paid orders and bills were not
deleted, voided or automatically marked prepared.

TypeScript passed after restoring pre-#74 source and retaining null label/note
fields in schema-typed demo fixtures. Full CI was deliberately bypassed for the
emergency release, not reported as having passed. Production publication and
postflight checks are recorded below.

## Publication and postflight

Rollback commit `6a9184a3795c79f32decbcf2b68de43421e15a6d` is on main. Emergency
workflow run `38247088368` succeeded; Pages publication completed at 12:08:44 UTC
(17:38:44 IST). Its exact build/typecheck ran before publishing. The origin
responds 200 and serves `/assets/index-DxxJT2kt.js`, containing Build `6a9184a`
and build time `2026-10-12T12:08:33.481Z`. Its service worker precaches that same
main bundle. The previous release SHA is absent from it.

At 12:09:19 UTC, the production order rail is empty. The operator-authorized
cancellations are skcafe orders #22 and #24; other rail orders resolved before
or during the incident. The counter and kitchen report zero unsent writes.
These are recent server-side heartbeat reports, not direct browser-storage
inspections or proof of the build running on a remote tablet. Closing/reopening
the app twice is the operational override; browser storage must be preserved.

The production financial fingerprint remains
`abe9bbfdffebab41482cef8cc21cbee5`, with 2,967 bills and 85,874,600 paise.
Restored RPCs retain their existing grants, SECURITY DEFINER setting and empty
search_path. No RLS policies, bills, payments or customer facts were modified.

Local unit/component verification passed: 191 files, 2,436 tests. The normal
verification/deploy workflow was dispatched separately as run `38247320140`
against the same rollback commit. Full browser, database, RLS, auth and generated
type parity gates were still running when this evidence was recorded; they
were not prerequisites for the explicitly authorized emergency release.
